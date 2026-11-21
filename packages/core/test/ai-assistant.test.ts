import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiArgError,
  AiToolsUnsupportedError,
  ASSISTANT_MAX_STEPS,
  ASSISTANT_RESULT_LIMIT,
  actionTools,
  chatReplyOf,
  clearableString,
  createOpenAiCompatibleClient,
  defineAction,
  executePlan,
  findAction,
  objectSchema,
  optBool,
  optDate,
  optEnum,
  optInt,
  optInts,
  optString,
  optTime,
  reqDate,
  reqEnum,
  reqInt,
  reqString,
  runAssistantTurn,
  schema,
  wireMessages,
  type AiAction,
  type AiChatMessage,
  type AiChatReply,
  type AiChatRequest,
  type AiClient,
  type AiConfig,
  type AiFetch,
  type AiPlanStep,
  type AiRequest,
  type AiToolCall,
} from '../src/ai/index.ts';
import * as core from '../src/index.ts';

const CONFIG: AiConfig = { baseUrl: 'https://api.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' };

interface FetchCall {
  url: string;
  init: Parameters<AiFetch>[1];
}

function fakeFetch(status: number, body: string): { fetch: AiFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: AiFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetch, calls };
}

function chatBody(message: Record<string, unknown>): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', ...message } }] });
}

// ---- 假动作与假客户端 ----

interface Ctx {
  log: string[];
  courses: string[];
}

function newCtx(): Ctx {
  return { log: [], courses: ['高数', '英语'] };
}

const listCourses = defineAction<Ctx, { keyword: string | undefined }>({
  name: 'list_courses',
  description: '列出课程',
  parameters: objectSchema({ keyword: schema.string('关键词') }),
  risk: 'query',
  parse: (args) => ({ keyword: optString(args, 'keyword') }),
  preview: () => '',
  run: async (params, context) => {
    context.log.push(`list:${params.keyword ?? ''}`);
    return context.courses.filter((name) => params.keyword === undefined || name.includes(params.keyword));
  },
});

const bigQuery = defineAction<Ctx, null>({
  name: 'big_query',
  description: '返回很长的结果',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  run: async () => 'x'.repeat(ASSISTANT_RESULT_LIMIT * 2),
});

const brokenQuery = defineAction<Ctx, null>({
  name: 'broken_query',
  description: '执行时出错',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  run: async () => {
    throw new Error('数据库忙');
  },
});

let addParseCount = 0;
const addCourse = defineAction<Ctx, { name: string; weekday: number }>({
  name: 'add_course',
  description: '添加课程',
  parameters: objectSchema({ name: schema.string('课程名'), weekday: schema.integer('星期', 1, 7) }, ['name', 'weekday']),
  risk: 'write',
  parse: (args) => {
    addParseCount += 1;
    return { name: reqString(args, 'name'), weekday: reqInt(args, 'weekday', 1, 7) };
  },
  preview: (params) => `添加「${params.name}」，周${params.weekday}`,
  run: async (params, context) => {
    context.log.push(`add:${params.name}`);
    context.courses.push(params.name);
    return `已添加 ${params.name}`;
  },
});

const clearAll = defineAction<Ctx, null>({
  name: 'clear_all',
  description: '清空课程',
  parameters: objectSchema({}),
  risk: 'danger',
  parse: () => null,
  preview: () => '清空全部课程',
  run: async (_params, context) => {
    context.log.push('clear');
    context.courses.length = 0;
    return undefined;
  },
});

const failingWrite = defineAction<Ctx, null>({
  name: 'failing_write',
  description: '执行必失败',
  parameters: objectSchema({}),
  risk: 'write',
  parse: () => null,
  preview: () => '会失败的一步',
  run: async () => {
    throw new Error('磁盘已满');
  },
});

const ACTIONS: AiAction<Ctx>[] = [listCourses, bigQuery, brokenQuery, addCourse, clearAll, failingWrite];

function call(id: string, name: string, args: unknown): AiToolCall {
  return { id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) };
}

type ChatScript = Array<AiChatReply | Error>;

/** 按脚本依次应答的客户端；记下每次请求的快照。 */
function scriptedClient(options: { chat?: ChatScript; complete?: Array<string | Error> }): {
  client: AiClient;
  chatRequests: AiChatRequest[];
  completeRequests: AiRequest[];
} {
  const chatRequests: AiChatRequest[] = [];
  const completeRequests: AiRequest[] = [];
  const chatQueue = [...(options.chat ?? [])];
  const completeQueue = [...(options.complete ?? [])];
  const client: AiClient = {
    async complete(request) {
      completeRequests.push(structuredClone({ messages: request.messages }));
      const next = completeQueue.shift();
      if (next === undefined) throw new Error('complete 脚本已用完');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  if (options.chat !== undefined) {
    client.chat = async (request) => {
      chatRequests.push(structuredClone({ messages: request.messages, tools: request.tools }));
      const next = chatQueue.shift();
      if (next === undefined) throw new Error('chat 脚本已用完');
      if (next instanceof Error) throw next;
      return next;
    };
  }
  return { client, chatRequests, completeRequests };
}

function baseInput(client: AiClient, context: Ctx = newCtx()) {
  return { client, actions: ACTIONS, context, history: [] as AiChatMessage[], userText: '帮我看看课表', contextNote: '今天 2026-11-21' };
}

function toolMessages(history: readonly AiChatMessage[]): Array<{ toolCallId: string; body: Record<string, unknown> }> {
  return history.flatMap((message) =>
    message.role === 'tool' ? [{ toolCallId: message.toolCallId, body: JSON.parse(message.content) as Record<string, unknown> }] : [],
  );
}

// ---- 入口 ----

test('core 入口导出 AI 助手相关接口', () => {
  assert.equal(typeof core.runAssistantTurn, 'function');
  assert.equal(typeof core.executePlan, 'function');
  assert.equal(typeof core.defineAction, 'function');
  assert.equal(typeof core.actionTools, 'function');
  assert.equal(typeof core.findAction, 'function');
  assert.equal(typeof core.optInts, 'function');
  assert.equal(typeof core.wireMessages, 'function');
  assert.equal(typeof core.chatReplyOf, 'function');
  assert.equal(core.AiArgError, AiArgError);
  assert.equal(core.AiToolsUnsupportedError, AiToolsUnsupportedError);
  assert.equal(core.ASSISTANT_MAX_STEPS, 8);
  assert.equal(typeof core.ASSISTANT_RESULT_LIMIT, 'number');
});

// ---- 客户端：函数调用 ----

test('wireMessages：tool 与带调用的 assistant 转成 OpenAI 格式，其余原样', () => {
  const wired = wireMessages([
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
    { role: 'assistant', content: '', toolCalls: [call('c1', 'list_courses', { keyword: '数' })] },
    { role: 'assistant', content: '想一想', toolCalls: [call('c2', 'clear_all', {})] },
    { role: 'tool', toolCallId: 'c1', content: '{"result":[]}' },
    { role: 'assistant', content: '完成', toolCalls: [] },
    { role: 'assistant', content: '结束' },
  ]);
  assert.deepEqual(wired, [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_courses', arguments: '{"keyword":"数"}' } }],
    },
    {
      role: 'assistant',
      content: '想一想',
      tool_calls: [{ id: 'c2', type: 'function', function: { name: 'clear_all', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: '{"result":[]}' },
    { role: 'assistant', content: '完成' },
    { role: 'assistant', content: '结束' },
  ]);
});

test('chatReplyOf：取文本与函数调用，缺 id 补序号，对象参数转成文本', () => {
  const parsed = chatReplyOf(
    chatBody({
      content: null,
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'list_courses', arguments: '{"keyword":"数"}' } },
        { type: 'function', function: { name: 'clear_all', arguments: { all: true } } },
        { id: '', function: { name: 'add_course' } },
        { id: 'skip', function: { name: '' } },
        { id: 'skip2', function: {} },
      ],
    }),
  );
  assert.equal(parsed.content, '');
  assert.deepEqual(parsed.toolCalls, [
    { id: 'a', name: 'list_courses', arguments: '{"keyword":"数"}' },
    { id: 'call_1', name: 'clear_all', arguments: '{"all":true}' },
    { id: 'call_2', name: 'add_course', arguments: '{}' },
  ]);
  assert.deepEqual(chatReplyOf(chatBody({ content: '你好' })), { content: '你好', toolCalls: [] });
});

test('chatReplyOf：非 JSON、无选项、既无文本又无调用时报可读错误', () => {
  assert.throws(() => chatReplyOf('<html>'), /不是 JSON/);
  assert.throws(() => chatReplyOf(JSON.stringify({ choices: [] })), /没有返回内容/);
  assert.throws(() => chatReplyOf(JSON.stringify({})), /没有返回内容/);
  assert.throws(() => chatReplyOf(chatBody({ content: '  ' })), /没有返回内容/);
  assert.throws(() => chatReplyOf(chatBody({ content: '', tool_calls: [{ function: { name: '' } }] })), /没有返回内容/);
  assert.throws(() => chatReplyOf(JSON.stringify({ choices: [{}] })), /没有返回内容/);
});

test('客户端 chat：带 tools 时按 function 格式发送，消息转成线上格式', async () => {
  const { fetch, calls } = fakeFetch(200, chatBody({ content: '好的' }));
  const client = createOpenAiCompatibleClient({ ...CONFIG, model: ' m1 ' }, fetch);
  const controller = new AbortController();
  const messages: AiChatMessage[] = [
    { role: 'user', content: 'u' },
    { role: 'assistant', content: '', toolCalls: [call('c1', 'list_courses', {})] },
    { role: 'tool', toolCallId: 'c1', content: '{"result":1}' },
  ];
  const tools = [{ name: 'list_courses', description: '列出课程', parameters: objectSchema({}) }];
  assert.deepEqual(await client.chat!({ messages, tools, signal: controller.signal }), { content: '好的', toolCalls: [] });
  assert.equal(calls.length, 1);
  const sent = calls[0]!;
  assert.equal(sent.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.headers['Authorization'], 'Bearer sk-test');
  assert.equal(sent.init.signal, controller.signal);
  assert.deepEqual(JSON.parse(sent.init.body), {
    model: 'm1',
    temperature: 0,
    messages: wireMessages(messages),
    tools: [{ type: 'function', function: { name: 'list_courses', description: '列出课程', parameters: objectSchema({}) } }],
  });
});

test('客户端 chat：tools 为空时不带 tools 字段，也不带 signal', async () => {
  const { fetch, calls } = fakeFetch(200, chatBody({ content: '好的' }));
  await createOpenAiCompatibleClient(CONFIG, fetch).chat!({ messages: [{ role: 'user', content: 'u' }], tools: [] });
  const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
  assert.equal('tools' in body, false);
  assert.equal('signal' in calls[0]!.init, false);
});

test('客户端 chat：带 tools 时 400/422 且错误提到 tool / function，抛 AiToolsUnsupportedError', async () => {
  const tools = [{ name: 'x', description: 'd', parameters: objectSchema({}) }];
  const cases: Array<[number, string, string]> = [
    [400, '{"error":{"message":"tools not supported"}}', 'tools not supported'],
    [422, '{"error":{"message":"Unknown field: Function_call"}}', 'Unknown field: Function_call'],
    [400, '{"error":"this model does not support TOOL use"}', 'this model does not support TOOL use'],
  ];
  for (const [status, body, detail] of cases) {
    const { fetch } = fakeFetch(status, body);
    await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).chat!({ messages: [], tools }), (error: unknown) => {
      assert.ok(error instanceof AiToolsUnsupportedError, body);
      assert.equal(error.name, 'AiToolsUnsupportedError');
      assert.equal(error.message, `AI 服务返回错误（${status}）：${detail}`);
      return true;
    });
  }
});

test('客户端 chat：400/422 不提 tool / function 时照常报错，不当作不支持函数调用', async () => {
  const tools = [{ name: 'x', description: 'd', parameters: objectSchema({}) }];
  const cases: Array<[number, string, string]> = [
    [400, '{"error":{"message":"maximum context length exceeded"}}', 'AI 服务返回错误（400）：maximum context length exceeded'],
    [422, '{"error":"invalid temperature"}', 'AI 服务返回错误（422）：invalid temperature'],
    [400, '<html>bad request</html>', 'AI 服务返回错误（400）'],
  ];
  for (const [status, body, message] of cases) {
    const { fetch } = fakeFetch(status, body);
    await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).chat!({ messages: [], tools }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof AiToolsUnsupportedError), body);
      assert.equal(error.message, message);
      return true;
    });
  }
});

test('客户端 chat：超长错误里提到 functions 也照常报错，助手不退回 JSON', async () => {
  const detail =
    "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens (8000 in the messages, 1000 in the functions).";
  const tools = [{ name: 'x', description: 'd', parameters: objectSchema({}) }];
  for (const status of [400, 422]) {
    const { fetch } = fakeFetch(status, JSON.stringify({ error: { message: detail } }));
    await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).chat!({ messages: [], tools }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof AiToolsUnsupportedError), `${status}`);
      assert.equal(error.message, `AI 服务返回错误（${status}）：${detail.slice(0, 200)}`);
      return true;
    });
  }

  const { fetch, calls } = fakeFetch(400, JSON.stringify({ error: { message: detail } }));
  const http = createOpenAiCompatibleClient(CONFIG, fetch);
  let completed = 0;
  const client: AiClient = {
    complete: async (request) => {
      completed += 1;
      return http.complete(request);
    },
    chat: (request) => http.chat!(request),
  };
  await assert.rejects(runAssistantTurn(baseInput(client)), (error: unknown) => {
    assert.ok(!(error instanceof AiToolsUnsupportedError));
    assert.match((error as Error).message, /maximum context length/);
    return true;
  });
  assert.equal(completed, 0, '不退回 JSON');
  assert.equal(calls.length, 1);
  assert.ok('tools' in (JSON.parse(calls[0]!.init.body) as object));
});

test('客户端 chat：不带 tools 时即使错误提到 tools 也照常报错', async () => {
  const { fetch } = fakeFetch(400, '{"error":"tools not supported"}');
  await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).chat!({ messages: [], tools: [] }), (error: unknown) => {
    assert.ok(!(error instanceof AiToolsUnsupportedError));
    assert.equal((error as Error).message, 'AI 服务返回错误（400）：tools not supported');
    return true;
  });
});

test('客户端 chat：不带 tools 的 400 与其他错误照常报可读说明', async () => {
  const cases: Array<[number, boolean, RegExp]> = [
    [400, false, /^AI 服务返回错误（400）：bad$/],
    [401, true, /拒绝访问（401），检查 API 密钥/],
    [404, true, /找不到接口（404）/],
    [429, true, /请求过多或额度不足（429）/],
    [500, true, /^AI 服务返回错误（500）：bad$/],
  ];
  for (const [status, withTools, expected] of cases) {
    const { fetch } = fakeFetch(status, '{"error":"bad"}');
    const tools = withTools ? [{ name: 'x', description: 'd', parameters: objectSchema({}) }] : [];
    await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).chat!({ messages: [], tools }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof AiToolsUnsupportedError), `${status}`);
      assert.match(error.message, expected);
      return true;
    });
  }
});

test('客户端 chat：配置不全时不发请求', async () => {
  const { fetch, calls } = fakeFetch(200, chatBody({ content: 'x' }));
  await assert.rejects(createOpenAiCompatibleClient({ ...CONFIG, model: '' }, fetch).chat!({ messages: [], tools: [] }), /未填写模型名称/);
  assert.equal(calls.length, 0);
});

test('客户端 complete：请求体仍不带 tools', async () => {
  const { fetch, calls } = fakeFetch(200, chatBody({ content: '好' }));
  assert.equal(await createOpenAiCompatibleClient(CONFIG, fetch).complete({ messages: [{ role: 'user', content: 'u' }] }), '好');
  assert.deepEqual(Object.keys(JSON.parse(calls[0]!.init.body) as object).sort(), ['messages', 'model', 'temperature']);
});

// ---- 动作登记 ----

test('actionTools：写入与高危的说明带计划后缀，查询原样', () => {
  const tools = actionTools(ACTIONS);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ACTIONS.map((action) => action.name),
  );
  assert.equal(tools[0]!.description, '列出课程');
  assert.equal(tools[3]!.description, '添加课程（写入：进入待执行计划，用户确认后执行）');
  assert.equal(tools[4]!.description, '清空课程（写入：进入待执行计划，用户确认后执行）');
  assert.equal(tools[3]!.parameters, addCourse.parameters);
});

test('findAction：按名字找，找不到返回 undefined', () => {
  assert.equal(findAction(ACTIONS, 'add_course'), addCourse);
  assert.equal(findAction(ACTIONS, 'nope'), undefined);
});

test('objectSchema 与 schema 片段', () => {
  assert.deepEqual(objectSchema({ a: schema.string('甲') }, ['a']), {
    type: 'object',
    properties: { a: { type: 'string', description: '甲' } },
    required: ['a'],
    additionalProperties: false,
  });
  assert.deepEqual(objectSchema({}), { type: 'object', properties: {}, required: [], additionalProperties: false });
  assert.deepEqual(schema.integer('周', 1, 20), { type: 'integer', description: '周', minimum: 1, maximum: 20 });
  assert.deepEqual(schema.integer('数'), { type: 'integer', description: '数' });
  assert.deepEqual(schema.integer('数', 0), { type: 'integer', description: '数', minimum: 0 });
  assert.deepEqual(schema.boolean('开关'), { type: 'boolean', description: '开关' });
  assert.deepEqual(schema.enumOf('类型', ['a', 'b']), { type: 'string', enum: ['a', 'b'], description: '类型' });
  assert.deepEqual(schema.date('开始'), { type: 'string', description: '开始，YYYY-MM-DD' });
  assert.deepEqual(schema.time('上课'), { type: 'string', description: '上课，HH:MM（24 小时）' });
  assert.deepEqual(schema.integers('周次'), { type: 'array', items: { type: 'integer' }, description: '周次' });
});

// ---- 参数读取 ----

function argError(fn: () => unknown, message: string | RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof AiArgError);
    assert.equal(error.name, 'AiArgError');
    if (typeof message === 'string') assert.equal(error.message, message);
    else assert.match(error.message, message);
    return true;
  });
}

test('optString / reqString：去空白，null 与缺省视为未传，类型不对报错', () => {
  assert.equal(optString({ a: '  高数 ' }, 'a'), '高数');
  assert.equal(optString({}, 'a'), undefined);
  assert.equal(optString({ a: null }, 'a'), undefined);
  assert.equal(optString({ a: undefined }, 'a'), undefined);
  assert.equal(optString({ a: '' }, 'a'), '');
  argError(() => optString({ a: 1 }, 'a'), '参数 a 应为文本');
  assert.equal(reqString({ a: ' x ' }, 'a'), 'x');
  argError(() => reqString({}, 'a'), '缺少参数 a');
  argError(() => reqString({ a: '   ' }, 'a'), '缺少参数 a');
  argError(() => reqString({ a: null }, 'a'), '缺少参数 a');
});

test('clearableString：未传为 undefined，null 与空串为 null，其余去空白', () => {
  assert.equal(clearableString({}, 'a'), undefined);
  assert.equal(clearableString({ a: undefined }, 'a'), undefined, '显式 undefined 也算未传');
  assert.equal(clearableString({ a: null }, 'a'), null);
  assert.equal(clearableString({ a: '' }, 'a'), null);
  assert.equal(clearableString({ a: '  ' }, 'a'), null);
  assert.equal(clearableString({ a: ' 备注 ' }, 'a'), '备注');
  argError(() => clearableString({ a: 3 }, 'a'), '参数 a 应为文本');
});

test('optInt / reqInt：接受数字文本，非整数与越界报错', () => {
  assert.equal(optInt({ a: 3 }, 'a'), 3);
  assert.equal(optInt({ a: ' 5 ' }, 'a'), 5);
  assert.equal(optInt({ a: null }, 'a'), undefined);
  assert.equal(optInt({}, 'a'), undefined);
  assert.equal(optInt({ a: 1 }, 'a', 1, 7), 1);
  assert.equal(optInt({ a: 7 }, 'a', 1, 7), 7);
  argError(() => optInt({ a: 1.5 }, 'a'), '参数 a 应为整数');
  argError(() => optInt({ a: 'abc' }, 'a'), '参数 a 应为整数');
  argError(() => optInt({ a: '' }, 'a'), '参数 a 应为整数');
  argError(() => optInt({ a: true }, 'a'), '参数 a 应为整数');
  argError(() => optInt({ a: 0 }, 'a', 1, 7), '参数 a 不能小于 1');
  argError(() => optInt({ a: 8 }, 'a', 1, 7), '参数 a 不能大于 7');
  assert.equal(reqInt({ a: '2' }, 'a', 1), 2);
  argError(() => reqInt({}, 'a'), '缺少参数 a');
});

test('optBool：只认布尔值', () => {
  assert.equal(optBool({ a: true }, 'a'), true);
  assert.equal(optBool({ a: false }, 'a'), false);
  assert.equal(optBool({ a: null }, 'a'), undefined);
  assert.equal(optBool({}, 'a'), undefined);
  argError(() => optBool({ a: 'true' }, 'a'), '参数 a 应为 true 或 false');
  argError(() => optBool({ a: 1 }, 'a'), '参数 a 应为 true 或 false');
});

test('optDate / reqDate：只认真实存在的日历日', () => {
  assert.equal(optDate({ a: ' 2026-11-21 ' }, 'a'), '2026-11-21');
  assert.equal(optDate({ a: '2024-02-29' }, 'a'), '2024-02-29');
  assert.equal(optDate({ a: '' }, 'a'), undefined);
  assert.equal(optDate({ a: null }, 'a'), undefined);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-00-10', '2026-1-5', '2026/11/21', '明天']) {
    argError(() => optDate({ a: bad }, 'a'), '参数 a 应为有效日期 YYYY-MM-DD');
  }
  argError(() => optDate({ a: 20261121 }, 'a'), '参数 a 应为文本');
  assert.equal(reqDate({ d: '2026-01-01' }, 'd'), '2026-01-01');
  argError(() => reqDate({ d: '' }, 'd'), '缺少参数 d');
  argError(() => reqDate({}, 'd'), '缺少参数 d');
});

test('optTime：一位小时补零，非法时刻报错', () => {
  assert.equal(optTime({ t: '8:05' }, 't'), '08:05');
  assert.equal(optTime({ t: '08:05' }, 't'), '08:05');
  assert.equal(optTime({ t: '23:59' }, 't'), '23:59');
  assert.equal(optTime({ t: '0:00' }, 't'), '00:00');
  assert.equal(optTime({ t: '' }, 't'), undefined);
  assert.equal(optTime({}, 't'), undefined);
  for (const bad of ['24:00', '8:5', '12:60', '0805', '8点', '08:05:00']) {
    argError(() => optTime({ t: bad }, 't'), '参数 t 应为 HH:MM');
  }
});

test('optEnum / reqEnum：只接受给定取值', () => {
  const kinds = ['exam', 'todo'] as const;
  assert.equal(optEnum({ k: ' exam ' }, 'k', kinds), 'exam');
  assert.equal(optEnum({ k: '' }, 'k', kinds), undefined);
  assert.equal(optEnum({}, 'k', kinds), undefined);
  argError(() => optEnum({ k: 'EXAM' }, 'k', kinds), '参数 k 只能是 exam / todo');
  assert.equal(reqEnum({ k: 'todo' }, 'k', kinds), 'todo');
  argError(() => reqEnum({}, 'k', kinds), '缺少参数 k');
});

test('optInts：去重排序，越界、非整数与非数组报错', () => {
  assert.deepEqual(optInts({ w: [3, 1, 3, 2] }, 'w', 1, 20), [1, 2, 3]);
  assert.deepEqual(optInts({ w: [] }, 'w', 1, 20), []);
  assert.deepEqual(optInts({ w: [10, 2] }, 'w', 1, 20), [2, 10], '按数值而非字典序');
  assert.equal(optInts({}, 'w', 1, 20), undefined);
  assert.equal(optInts({ w: null }, 'w', 1, 20), undefined);
  argError(() => optInts({ w: '1,2' }, 'w', 1, 20), '参数 w 应为整数数组');
  argError(() => optInts({ w: [0] }, 'w', 1, 20), '参数 w 里的值应为 1-20 的整数');
  argError(() => optInts({ w: [21] }, 'w', 1, 20), '参数 w 里的值应为 1-20 的整数');
  argError(() => optInts({ w: [1.5] }, 'w', 1, 20), '参数 w 里的值应为 1-20 的整数');
  argError(() => optInts({ w: ['2'] }, 'w', 1, 20), '参数 w 里的值应为 1-20 的整数');
});

// ---- 对话循环：函数调用 ----

test('函数调用：查询当场执行，结果以 tool 消息回给模型，最终回复去空白', async () => {
  const { client, chatRequests } = scriptedClient({
    chat: [
      { content: '', toolCalls: [call('c1', 'list_courses', { keyword: '数' })] },
      { content: '  你有高数。 \n', toolCalls: [] },
    ],
  });
  const context = newCtx();
  const queried: string[] = [];
  const result = await runAssistantTurn({ ...baseInput(client, context), onQuery: (name) => queried.push(name) });
  assert.equal(result.mode, 'tools');
  assert.equal(result.reply, '你有高数。');
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.plan, []);
  assert.deepEqual(context.log, ['list:数']);
  assert.deepEqual(queried, ['list_courses']);
  assert.deepEqual(toolMessages(result.history), [{ toolCallId: 'c1', body: { result: ['高数'] } }]);
  assert.equal(chatRequests.length, 2);
  // 每次请求都以 system 开头，带上下文说明与全部函数
  for (const request of chatRequests) {
    assert.equal(request.messages[0]!.role, 'system');
    assert.match(request.messages[0]!.content, /今天 2026-11-21/);
    assert.deepEqual(request.tools, actionTools(ACTIONS));
  }
  assert.deepEqual(chatRequests[0]!.messages.slice(1), [{ role: 'user', content: '帮我看看课表' }]);
  assert.deepEqual(
    chatRequests[1]!.messages.slice(1).map((message) => message.role),
    ['user', 'assistant', 'tool'],
  );
});

test('函数调用：返回的对话含用户、带调用的助手、tool 与最终回复，可接着下一轮', async () => {
  const first = scriptedClient({
    chat: [
      { content: '我查一下', toolCalls: [call('c1', 'list_courses', {})] },
      { content: '有高数和英语', toolCalls: [] },
    ],
  });
  const turn1 = await runAssistantTurn(baseInput(first.client));
  assert.deepEqual(turn1.history, [
    { role: 'user', content: '帮我看看课表' },
    { role: 'assistant', content: '我查一下', toolCalls: [call('c1', 'list_courses', {})] },
    { role: 'tool', toolCallId: 'c1', content: '{"result":["高数","英语"]}' },
    { role: 'assistant', content: '有高数和英语' },
  ]);
  assert.ok(!turn1.history.some((message) => message.role === 'system'), '对话不含 system');

  const second = scriptedClient({ chat: [{ content: '好的', toolCalls: [] }] });
  const turn2 = await runAssistantTurn({ ...baseInput(second.client), history: turn1.history, userText: '谢谢' });
  assert.deepEqual(second.chatRequests[0]!.messages.slice(1), [...turn1.history, { role: 'user', content: '谢谢' }]);
  assert.deepEqual(turn2.history, [...turn1.history, { role: 'user', content: '谢谢' }, { role: 'assistant', content: '好的' }]);
  assert.equal(turn1.history.length, 4, '不改动传入的对话');
});

test('函数调用：查询结果超长时截断，仍是合法 JSON 并带截断说明', async () => {
  const { client } = scriptedClient({
    chat: [{ content: '', toolCalls: [call('c1', 'big_query', {})] }, { content: '完', toolCalls: [] }],
  });
  const result = await runAssistantTurn(baseInput(client));
  const [tool] = toolMessages(result.history);
  const serialized = JSON.stringify('x'.repeat(ASSISTANT_RESULT_LIMIT * 2));
  assert.deepEqual(tool!.body, {
    result: `${serialized.slice(0, ASSISTANT_RESULT_LIMIT)}…`,
    truncated: '结果过长已截断，缩小查询范围再试',
  });
});

test('函数调用：查询结果恰在上限内时原样回传，不带截断说明', async () => {
  // {"result":...} 里的结果文本按序列化后的长度计
  const exact = defineAction<Ctx, null>({
    name: 'exact',
    description: '刚好到上限',
    parameters: objectSchema({}),
    risk: 'query',
    parse: () => null,
    preview: () => '',
    run: async () => 'y'.repeat(ASSISTANT_RESULT_LIMIT - 2),
  });
  const over = defineAction<Ctx, null>({
    name: 'over',
    description: '超一个字',
    parameters: objectSchema({}),
    risk: 'query',
    parse: () => null,
    preview: () => '',
    run: async () => 'z'.repeat(ASSISTANT_RESULT_LIMIT - 1),
  });
  const { client } = scriptedClient({
    chat: [{ content: '', toolCalls: [call('a', 'exact', {}), call('b', 'over', {})] }, { content: '完', toolCalls: [] }],
  });
  const result = await runAssistantTurn({ ...baseInput(client), actions: [exact, over] });
  const [first, second] = toolMessages(result.history);
  assert.deepEqual(first!.body, { result: 'y'.repeat(ASSISTANT_RESULT_LIMIT - 2) });
  assert.equal(second!.body.truncated, '结果过长已截断，缩小查询范围再试');
  assert.equal(second!.body.result, `"${'z'.repeat(ASSISTANT_RESULT_LIMIT - 1)}`.slice(0, ASSISTANT_RESULT_LIMIT) + '…');
});

test('函数调用：查询返回 undefined 时回 result null', async () => {
  const nothing = defineAction<Ctx, null>({
    name: 'nothing',
    description: '无结果',
    parameters: objectSchema({}),
    risk: 'query',
    parse: () => null,
    preview: () => '',
    run: async () => undefined,
  });
  const { client } = scriptedClient({
    chat: [{ content: '', toolCalls: [call('c1', 'nothing', {})] }, { content: '完', toolCalls: [] }],
  });
  const result = await runAssistantTurn({ ...baseInput(client), actions: [nothing] });
  assert.deepEqual(toolMessages(result.history), [{ toolCallId: 'c1', body: { result: null } }]);
});

test('函数调用：写入与高危只进计划不执行，tool 消息说明已加入计划', async () => {
  const { client } = scriptedClient({
    chat: [
      {
        content: '',
        toolCalls: [call('w1', 'add_course', { name: ' 物理 ', weekday: '3' }), call('w2', 'clear_all', {})],
      },
      { content: '计划里有两步待确认', toolCalls: [] },
    ],
  });
  const context = newCtx();
  const queried: string[] = [];
  const result = await runAssistantTurn({ ...baseInput(client, context), onQuery: (name) => queried.push(name) });
  assert.deepEqual(context.log, [], '写入未执行');
  assert.deepEqual(context.courses, ['高数', '英语']);
  assert.deepEqual(queried, [], '写入不算查询');
  assert.deepEqual(result.plan, [
    {
      id: 'step-1',
      action: 'add_course',
      args: { name: ' 物理 ', weekday: '3' },
      params: { name: '物理', weekday: 3 },
      preview: '添加「物理」，周3',
      risk: 'write',
    },
    { id: 'step-2', action: 'clear_all', args: {}, params: null, preview: '清空全部课程', risk: 'danger' },
  ]);
  assert.deepEqual(toolMessages(result.history), [
    { toolCallId: 'w1', body: { status: '已加入待执行计划，等用户确认', preview: '添加「物理」，周3' } },
    { toolCallId: 'w2', body: { status: '已加入待执行计划，等用户确认', preview: '清空全部课程' } },
  ]);
  assert.equal(result.reply, '计划里有两步待确认');
});

test('函数调用：stepIdPrefix 决定计划步骤的编号前缀', async () => {
  const script = (): AiChatReply[] => [
    { content: '', toolCalls: [call('w1', 'clear_all', {}), call('w2', 'add_course', { name: '物理', weekday: 1 })] },
    { content: '完', toolCalls: [] },
  ];
  const prefixed = await runAssistantTurn({ ...baseInput(scriptedClient({ chat: script() }).client), stepIdPrefix: 't3' });
  assert.deepEqual(
    prefixed.plan.map((step) => step.id),
    ['t3-1', 't3-2'],
  );
  const json = scriptedClient({
    complete: ['{"calls":[{"name":"clear_all","arguments":{}}]}', '{"reply":"好"}'],
  });
  const jsonTurn = await runAssistantTurn({ ...baseInput(json.client), stepIdPrefix: 'turn-2' });
  assert.deepEqual(
    jsonTurn.plan.map((step) => step.id),
    ['turn-2-1'],
  );
});

test('函数调用：未知函数、非对象参数、坏 JSON、参数错误都回 error，循环继续', async () => {
  const { client, chatRequests } = scriptedClient({
    chat: [
      {
        content: '',
        toolCalls: [
          call('e1', 'drop_table', {}),
          call('e2', 'list_courses', [1, 2]),
          call('e3', 'list_courses', '"文本"'),
          call('e4', 'list_courses', 'null'),
          call('e5', 'list_courses', '{keyword:'),
          call('e6', 'add_course', { name: '物理', weekday: 9 }),
          call('e7', 'add_course', { weekday: 1 }),
        ],
      },
      { content: '', toolCalls: [call('ok', 'add_course', { name: '物理', weekday: 2 })] },
      { content: '已改正', toolCalls: [] },
    ],
  });
  const context = newCtx();
  const result = await runAssistantTurn(baseInput(client, context));
  assert.deepEqual(toolMessages(result.history), [
    { toolCallId: 'e1', body: { error: '没有名为 drop_table 的函数' } },
    { toolCallId: 'e2', body: { error: '参数应为 JSON 对象' } },
    { toolCallId: 'e3', body: { error: '参数应为 JSON 对象' } },
    { toolCallId: 'e4', body: { error: '参数应为 JSON 对象' } },
    { toolCallId: 'e5', body: { error: '参数应为 JSON 对象' } },
    { toolCallId: 'e6', body: { error: '参数 weekday 不能大于 7' } },
    { toolCallId: 'e7', body: { error: '缺少参数 name' } },
    { toolCallId: 'ok', body: { status: '已加入待执行计划，等用户确认', preview: '添加「物理」，周2' } },
  ]);
  assert.equal(chatRequests.length, 3);
  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0]!.id, 'step-1', '出错的调用不占计划序号');
  assert.deepEqual(context.log, []);
  assert.equal(result.reply, '已改正');
});

test('函数调用：空参数文本按空对象处理', async () => {
  const { client } = scriptedClient({
    chat: [{ content: '', toolCalls: [{ id: 'c1', name: 'list_courses', arguments: '  ' }] }, { content: '完', toolCalls: [] }],
  });
  const result = await runAssistantTurn(baseInput(client));
  assert.deepEqual(toolMessages(result.history), [{ toolCallId: 'c1', body: { result: ['高数', '英语'] } }]);
});

test('函数调用：执行中的其他异常回「执行失败」，循环继续', async () => {
  const throwingPreview = defineAction<Ctx, null>({
    name: 'bad_preview',
    description: '预览出错',
    parameters: objectSchema({}),
    risk: 'write',
    parse: () => null,
    preview: () => {
      throw new Error('预览坏了');
    },
    run: async () => '',
  });
  const throwingParse = defineAction<Ctx, null>({
    name: 'bad_parse',
    description: '解析出错',
    parameters: objectSchema({}),
    risk: 'query',
    parse: () => {
      throw 'raw';
    },
    preview: () => '',
    run: async () => null,
  });
  const { client } = scriptedClient({
    chat: [
      {
        content: '',
        toolCalls: [call('b1', 'broken_query', {}), call('b2', 'bad_preview', {}), call('b3', 'bad_parse', {})],
      },
      { content: '出了点问题', toolCalls: [] },
    ],
  });
  const queried: string[] = [];
  const result = await runAssistantTurn({
    ...baseInput(client),
    actions: [...ACTIONS, throwingPreview, throwingParse],
    onQuery: (name) => queried.push(name),
  });
  assert.deepEqual(toolMessages(result.history), [
    { toolCallId: 'b1', body: { error: '执行失败：数据库忙' } },
    { toolCallId: 'b2', body: { error: '执行失败：预览坏了' } },
    { toolCallId: 'b3', body: { error: '执行失败：raw' } },
  ]);
  assert.deepEqual(result.plan, [], '预览失败的写入不进计划');
  assert.deepEqual(queried, ['broken_query'], 'onQuery 在执行前调用，解析失败不调用');
  assert.equal(result.reply, '出了点问题');
});

test('函数调用：onQuery 每个查询调用一次', async () => {
  const { client } = scriptedClient({
    chat: [
      { content: '', toolCalls: [call('a', 'list_courses', {}), call('b', 'list_courses', { keyword: '英' })] },
      { content: '', toolCalls: [call('c', 'big_query', {})] },
      { content: '完', toolCalls: [] },
    ],
  });
  const queried: string[] = [];
  await runAssistantTurn({ ...baseInput(client), onQuery: (name) => queried.push(name) });
  assert.deepEqual(queried, ['list_courses', 'list_courses', 'big_query']);
});

test('函数调用：用完步数仍在调用时 exhausted，回复为空，计划保留', async () => {
  const loop: AiChatReply = { content: '', toolCalls: [call('c', 'list_courses', {})] };
  const { client, chatRequests } = scriptedClient({
    chat: [
      { content: '', toolCalls: [call('w', 'add_course', { name: '物理', weekday: 1 })] },
      ...Array.from({ length: ASSISTANT_MAX_STEPS + 2 }, () => loop),
    ],
  });
  const result = await runAssistantTurn(baseInput(client));
  assert.equal(ASSISTANT_MAX_STEPS, 8);
  assert.equal(chatRequests.length, ASSISTANT_MAX_STEPS);
  assert.equal(result.exhausted, true);
  assert.equal(result.reply, '');
  assert.equal(result.mode, 'tools');
  assert.equal(result.plan.length, 1);

  const short = scriptedClient({ chat: [loop, loop, loop] });
  const limited = await runAssistantTurn({ ...baseInput(short.client), maxSteps: 2 });
  assert.equal(short.chatRequests.length, 2);
  assert.equal(limited.exhausted, true);
});

test('函数调用：转交取消信号', async () => {
  const controller = new AbortController();
  const signals: Array<AbortSignal | undefined> = [];
  const client: AiClient = {
    complete: async () => '',
    chat: async (request) => {
      signals.push(request.signal);
      return { content: '好', toolCalls: [] };
    },
  };
  await runAssistantTurn({ ...baseInput(client), signal: controller.signal });
  await runAssistantTurn(baseInput(client));
  assert.equal(signals[0], controller.signal);
  assert.equal(signals[1], undefined);
});

// ---- 对话循环：退回 JSON ----

test('退回：客户端没有 chat 时用 JSON 方式，system 带函数清单', async () => {
  const { client, completeRequests } = scriptedClient({ complete: ['{"calls": [], "reply": " 没什么要做的 "}'] });
  const result = await runAssistantTurn(baseInput(client));
  assert.equal(result.mode, 'json');
  assert.equal(result.reply, ' 没什么要做的 ', 'JSON 里的 reply 原样');
  assert.equal(result.exhausted, false);
  const system = completeRequests[0]!.messages[0]!;
  assert.equal(system.role, 'system');
  assert.match(system.content, /今天 2026-11-21/);
  assert.match(system.content, /不支持函数调用/);
  assert.match(system.content, /- list_courses：列出课程\n  参数：\{"type":"object"/);
  assert.match(system.content, /- add_course：添加课程（写入：进入待执行计划，用户确认后执行）/);
  assert.deepEqual(completeRequests[0]!.messages.slice(1), [{ role: 'user', content: '帮我看看课表' }]);
});

test('退回：查询结果以「函数结果：」用户消息回传，写入进计划', async () => {
  const first = JSON.stringify({
    calls: [
      { name: 'list_courses', arguments: { keyword: '英' } },
      { name: 'add_course', arguments: { name: '物理', weekday: 5 } },
      { name: 'list_courses' },
      { arguments: {} },
      { name: 'drop_table', arguments: {} },
    ],
  });
  const { client, completeRequests } = scriptedClient({
    complete: [`好的\n\`\`\`json\n${first}\n\`\`\``, '{"calls": [], "reply": "英语在周二；物理待确认"}'],
  });
  const context = newCtx();
  const queried: string[] = [];
  const result = await runAssistantTurn({ ...baseInput(client, context), onQuery: (name) => queried.push(name) });
  assert.equal(result.mode, 'json');
  assert.equal(result.reply, '英语在周二；物理待确认');
  assert.deepEqual(queried, ['list_courses', 'list_courses']);
  assert.deepEqual(context.log, ['list:英', 'list:']);
  assert.deepEqual(
    result.plan.map((step) => [step.id, step.action, step.params]),
    [['step-1', 'add_course', { name: '物理', weekday: 5 }]],
  );
  const second = completeRequests[1]!.messages;
  assert.deepEqual(
    second.map((message) => message.role),
    ['system', 'user', 'user', 'user'],
  );
  assert.ok(second[2]!.content.startsWith('（你上一次的输出）好的'));
  const feedback = second[3]!.content;
  assert.ok(feedback.startsWith('函数结果：\n'));
  assert.deepEqual(feedback.split('\n').slice(1), [
    'list_courses：{"result":["英语"]}',
    'add_course：{"status":"已加入待执行计划，等用户确认","preview":"添加「物理」，周5"}',
    'list_courses：{"result":["高数","英语"]}',
    'drop_table：{"error":"没有名为 drop_table 的函数"}',
  ]);
  assert.deepEqual(
    result.history.map((message) => message.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.ok(!result.history.some((message) => message.role === 'tool'));
});

test('退回：arguments 写成 JSON 字符串时照样解析；解析不了或不是对象时报参数错误', async () => {
  const first = JSON.stringify({
    calls: [
      { name: 'list_courses', arguments: '{"keyword":"英"}' },
      { name: 'add_course', arguments: '{"name":"物理","weekday":5}' },
      { name: 'list_courses', arguments: '' },
      { name: 'list_courses', arguments: '{keyword:' },
      { name: 'list_courses', arguments: '"文本"' },
      { name: 'list_courses', arguments: '[1,2]' },
      { name: 'add_course', arguments: '{"name":"化学","weekday":9}' },
    ],
  });
  const { client, completeRequests } = scriptedClient({ complete: [first, '{"calls":[],"reply":"好"}'] });
  const context = newCtx();
  const result = await runAssistantTurn({ ...baseInput(client, context), mode: 'json' });
  assert.equal(result.reply, '好');
  assert.deepEqual(context.log, ['list:英', 'list:']);
  assert.deepEqual(
    result.plan.map((planned) => [planned.id, planned.action, planned.args, planned.params]),
    [['step-1', 'add_course', { name: '物理', weekday: 5 }, { name: '物理', weekday: 5 }]],
  );
  assert.deepEqual(completeRequests[1]!.messages.at(-1)!.content.split('\n').slice(1), [
    'list_courses：{"result":["英语"]}',
    'add_course：{"status":"已加入待执行计划，等用户确认","preview":"添加「物理」，周5"}',
    'list_courses：{"result":["高数","英语"]}',
    'list_courses：{"error":"参数应为 JSON 对象"}',
    'list_courses：{"error":"参数应为 JSON 对象"}',
    'list_courses：{"error":"参数应为 JSON 对象"}',
    'add_course：{"error":"参数 weekday 不能大于 7"}',
  ]);
});

test('退回：模型没按格式输出时整段去空白当回复', async () => {
  const { client } = scriptedClient({ complete: ['  今天没有课。\n'] });
  const result = await runAssistantTurn(baseInput(client));
  assert.equal(result.reply, '今天没有课。');
  assert.deepEqual(result.plan, []);
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.history.at(-1), { role: 'assistant', content: '  今天没有课。\n' });
});

test('退回：输出里的 JSON 不是带 calls / reply 的对象时，整段当回复', async () => {
  const outputs = [
    '你在第 [1, 3] 周有课。',
    ' 结果：{"items":[1]} ',
    '[{"calls":[]}]',
    '{"name":"list_courses"}',
  ];
  for (const output of outputs) {
    const { client, completeRequests } = scriptedClient({ complete: [output] });
    const context = newCtx();
    const result = await runAssistantTurn(baseInput(client, context));
    assert.equal(result.reply, output.trim(), output);
    assert.equal(completeRequests.length, 1);
    assert.deepEqual(result.plan, []);
    assert.deepEqual(context.log, []);
  }
});

test('退回：只有 reply 或只有空 calls 的对象也算一轮', async () => {
  const onlyReply = scriptedClient({ complete: ['说明 {"reply":"今天没课"}'] });
  assert.equal((await runAssistantTurn(baseInput(onlyReply.client))).reply, '今天没课');
  const onlyCalls = scriptedClient({ complete: ['{"calls":[]}'] });
  const result = await runAssistantTurn(baseInput(onlyCalls.client));
  assert.equal(result.reply, '');
  assert.equal(result.exhausted, false);
});

test('退回：JSON 方式用完步数时 exhausted', async () => {
  const looping = '{"calls":[{"name":"list_courses","arguments":{}}]}';
  const { client, completeRequests } = scriptedClient({ complete: Array.from({ length: 5 }, () => looping) });
  const result = await runAssistantTurn({ ...baseInput(client), maxSteps: 3 });
  assert.equal(completeRequests.length, 3);
  assert.equal(result.exhausted, true);
  assert.equal(result.reply, '');
});

test('退回：第一次 chat 就抛 AiToolsUnsupportedError 时本轮改用 JSON', async () => {
  const history: AiChatMessage[] = [
    { role: 'user', content: '上一轮' },
    { role: 'assistant', content: '上一轮回复' },
  ];
  const { client, chatRequests, completeRequests } = scriptedClient({
    chat: [new AiToolsUnsupportedError('AI 服务返回错误（400）：tools not supported')],
    complete: ['{"calls":[{"name":"clear_all","arguments":{}}]}', '{"calls":[],"reply":"待确认清空"}'],
  });
  const result = await runAssistantTurn({ ...baseInput(client), history });
  assert.equal(chatRequests.length, 1);
  assert.equal(completeRequests.length, 2);
  assert.equal(result.mode, 'json');
  assert.equal(result.reply, '待确认清空');
  assert.deepEqual(
    result.plan.map((step) => [step.id, step.action]),
    [['step-1', 'clear_all']],
  );
  assert.deepEqual(completeRequests[0]!.messages.slice(1), [
    { role: 'user', content: '上一轮' },
    { role: 'user', content: '（你上一次的输出）上一轮回复' },
    { role: 'user', content: '帮我看看课表' },
  ]);
  assert.deepEqual(result.history.slice(0, 3), [...history, { role: 'user', content: '帮我看看课表' }]);
});

test('退回：本轮已有函数调用后再抛 AiToolsUnsupportedError 时原样抛出，不重跑', async () => {
  const context = newCtx();
  const queried: string[] = [];
  const { client, chatRequests, completeRequests } = scriptedClient({
    chat: [
      { content: '', toolCalls: [call('q', 'list_courses', {}), call('w', 'add_course', { name: '化学', weekday: 1 })] },
      new AiToolsUnsupportedError('AI 服务返回错误（400）：function error'),
    ],
    complete: ['{"calls":[],"reply":"不该用到"}'],
  });
  await assert.rejects(
    runAssistantTurn({ ...baseInput(client, context), onQuery: (name) => queried.push(name) }),
    (error: unknown) => error instanceof AiToolsUnsupportedError,
  );
  assert.equal(chatRequests.length, 2);
  assert.equal(completeRequests.length, 0, '不退回 JSON');
  assert.deepEqual(queried, ['list_courses'], '查询只执行一次');
  assert.deepEqual(context.log, ['list:']);
});

test('退回：用函数调用留下的对话在 JSON 方式里改写成纯文本', async () => {
  const history: AiChatMessage[] = [
    { role: 'user', content: '查课' },
    { role: 'assistant', content: '', toolCalls: [call('c1', 'list_courses', { keyword: '数' })] },
    { role: 'tool', toolCallId: 'c1', content: '{"result":["高数"]}' },
    {
      role: 'assistant',
      content: '  我再加一门 ',
      toolCalls: [call('c2', 'add_course', { name: '物理', weekday: 1 }), call('c3', 'clear_all', {})],
    },
    { role: 'tool', toolCallId: 'c2', content: '{"status":"已加入待执行计划，等用户确认"}' },
    { role: 'assistant', content: '有高数', toolCalls: [] },
    { role: 'assistant', content: '   ' },
  ];
  const { client, completeRequests } = scriptedClient({ complete: ['{"reply":"好"}'] });
  await runAssistantTurn({ ...baseInput(client), history, mode: 'json', userText: '继续' });
  assert.deepEqual(completeRequests[0]!.messages.slice(1), [
    { role: 'user', content: '查课' },
    { role: 'user', content: '（你上一次的输出）调用：list_courses({"keyword":"数"})' },
    { role: 'user', content: '函数结果：{"result":["高数"]}' },
    {
      role: 'user',
      content: '（你上一次的输出）我再加一门\n调用：add_course({"name":"物理","weekday":1})；clear_all({})',
    },
    { role: 'user', content: '函数结果：{"status":"已加入待执行计划，等用户确认"}' },
    { role: 'user', content: '（你上一次的输出）有高数' },
    { role: 'user', content: '（你上一次的输出）' },
    { role: 'user', content: '继续' },
  ]);
});

test('退回：mode 为 json 时完全不调 chat', async () => {
  const { client, chatRequests, completeRequests } = scriptedClient({
    chat: [{ content: '不该用到', toolCalls: [] }],
    complete: ['{"calls":[],"reply":"好"}'],
  });
  const result = await runAssistantTurn({ ...baseInput(client), mode: 'json' });
  assert.equal(chatRequests.length, 0);
  assert.equal(completeRequests.length, 1);
  assert.equal(result.mode, 'json');
  assert.equal(result.reply, '好');
});

test('退回：chat 的其他错误原样抛出，不退回 JSON', async () => {
  const { client, completeRequests } = scriptedClient({
    chat: [new Error('AI 服务拒绝访问（401），检查 API 密钥')],
    complete: ['{"calls":[],"reply":"不该用到"}'],
  });
  await assert.rejects(runAssistantTurn(baseInput(client)), /拒绝访问（401）/);
  assert.equal(completeRequests.length, 0);
});

test('退回：JSON 方式里 complete 出错原样抛出', async () => {
  const { client } = scriptedClient({ complete: [new Error('Failed to fetch')] });
  await assert.rejects(runAssistantTurn(baseInput(client)), /Failed to fetch/);
});

// ---- 执行计划 ----

/** 计划步骤：args 是执行时重新解析的原始参数；params 只给预览用，默认故意放一份过期值。 */
function step(id: string, action: string, args: Record<string, unknown>, preview: string, params: unknown = { stale: true }): AiPlanStep {
  return { id, action, args, params, preview, risk: 'write' };
}

test('executePlan：按顺序执行，每步按 args 重新解析、不用保存的 params；结果为文本时作摘要，否则用预览', async () => {
  const context = newCtx();
  const progress: number[] = [];
  const parsesBefore = addParseCount;
  const steps = [
    step('step-1', 'add_course', { name: '物理', weekday: 1 }, '添加「物理」', { name: '旧物理', weekday: 1 }),
    step('step-2', 'clear_all', {}, '清空全部课程'),
    step('step-3', 'add_course', { name: '化学', weekday: 2 }, '添加「化学」', { name: '旧化学', weekday: 2 }),
  ];
  const execution = await executePlan(steps, ACTIONS, context, (done) => progress.push(done));
  assert.equal(addParseCount - parsesBefore, 2, '两步 add_course 执行时各解析一次');
  assert.deepEqual(context.log, ['add:物理', 'clear', 'add:化学'], '用 args 重新解析的结果，不用 params');
  assert.deepEqual(context.courses, ['化学']);
  assert.deepEqual(
    execution.done.map((result) => [result.step.id, result.summary]),
    [
      ['step-1', '已添加 物理'],
      ['step-2', '清空全部课程'],
      ['step-3', '已添加 化学'],
    ],
  );
  assert.equal(execution.failed, null);
  assert.deepEqual(progress, [1, 2, 3]);
});

test('executePlan：解析在执行时进行，读到前面步骤写入后的数据', async () => {
  // 解析时记下当时的课程数；前一步加了课，后一步解析就该看到
  const seen: number[] = [];
  const countingAdd = defineAction<Ctx, { name: string; before: number }>({
    name: 'counting_add',
    description: '',
    parameters: objectSchema({ name: schema.string('课程名') }, ['name']),
    risk: 'write',
    parse: (args, context) => ({ name: reqString(args, 'name'), before: context.courses.length }),
    preview: (params) => `添加「${params.name}」`,
    run: async (params, context) => {
      seen.push(params.before);
      context.courses.push(params.name);
      return `已添加 ${params.name}`;
    },
  });
  const context = newCtx();
  // 生成计划时两步都解析在 2 门课的数据上
  const steps = [
    step('step-1', 'counting_add', { name: '物理' }, '添加「物理」', { name: '物理', before: 2 }),
    step('step-2', 'counting_add', { name: '化学' }, '添加「化学」', { name: '化学', before: 2 }),
  ];
  const execution = await executePlan(steps, [countingAdd], context);
  assert.equal(execution.failed, null);
  assert.deepEqual(seen, [2, 3]);
});

test('executePlan：执行时解析出错，那一步失败并报出解析的原因，之后不再执行', async () => {
  const context = newCtx();
  const progress: number[] = [];
  const steps = [
    step('step-1', 'add_course', { name: '物理', weekday: 1 }, '添加「物理」'),
    // 生成计划时的 params 是合法的，但 args 已经解析不过
    step('step-2', 'add_course', { name: '化学', weekday: 9 }, '添加「化学」', { name: '化学', weekday: 2 }),
    step('step-3', 'clear_all', {}, '清空全部课程'),
  ];
  const execution = await executePlan(steps, ACTIONS, context, (done) => progress.push(done));
  assert.deepEqual(execution.done.map((result) => result.step.id), ['step-1']);
  assert.deepEqual(execution.failed, { step: steps[1], message: '参数 weekday 不能大于 7' });
  assert.deepEqual(context.log, ['add:物理'], '解析失败的那步与之后的步骤都不执行');
  assert.deepEqual(context.courses, ['高数', '英语', '物理']);
  assert.deepEqual(progress, [1]);
});

test('executePlan：空串结果也用预览作摘要', async () => {
  const empty = defineAction<Ctx, null>({
    name: 'empty',
    description: '',
    parameters: objectSchema({}),
    risk: 'write',
    parse: () => null,
    preview: () => '',
    run: async () => '',
  });
  const execution = await executePlan([step('s', 'empty', {}, '预览文本')], [empty], newCtx());
  assert.equal(execution.done[0]!.summary, '预览文本');
});

test('executePlan：遇到失败即停，报出那一步与原因', async () => {
  const context = newCtx();
  const progress: number[] = [];
  const steps = [
    step('step-1', 'add_course', { name: '物理', weekday: 1 }, '添加「物理」'),
    step('step-2', 'failing_write', {}, '会失败的一步'),
    step('step-3', 'clear_all', {}, '清空全部课程'),
  ];
  const execution = await executePlan(steps, ACTIONS, context, (done) => progress.push(done));
  assert.deepEqual(execution.done.map((result) => result.step.id), ['step-1']);
  assert.deepEqual(execution.failed, { step: steps[1], message: '磁盘已满' });
  assert.deepEqual(context.log, ['add:物理'], '失败之后的步骤不执行');
  assert.deepEqual(progress, [1]);
});

test('executePlan：未知操作直接失败', async () => {
  const context = newCtx();
  const steps = [step('step-1', 'vanished', {}, '旧操作'), step('step-2', 'clear_all', {}, '清空')];
  const execution = await executePlan(steps, ACTIONS, context);
  assert.deepEqual(execution.done, []);
  assert.deepEqual(execution.failed, { step: steps[0], message: '没有名为 vanished 的操作' });
  assert.deepEqual(context.log, []);
});

test('executePlan：空计划什么也不做', async () => {
  assert.deepEqual(await executePlan([], ACTIONS, newCtx()), { done: [], failed: null });
});

test('计划由 runAssistantTurn 产出后可直接交给 executePlan', async () => {
  const { client } = scriptedClient({
    chat: [
      { content: '', toolCalls: [call('w', 'add_course', { name: '生物', weekday: 4 })] },
      { content: '待确认', toolCalls: [] },
    ],
  });
  const context = newCtx();
  const turn = await runAssistantTurn(baseInput(client, context));
  assert.deepEqual(turn.plan.map((planned) => [planned.args, planned.params]), [[{ name: '生物', weekday: 4 }, { name: '生物', weekday: 4 }]]);
  const parsesBefore = addParseCount;
  const execution = await executePlan(turn.plan, ACTIONS, context);
  assert.equal(addParseCount - parsesBefore, 1, '执行时按计划里的 args 再解析一次');
  assert.deepEqual(execution.done.map((result) => result.summary), ['已添加 生物']);
  assert.deepEqual(context.courses, ['高数', '英语', '生物']);
});
