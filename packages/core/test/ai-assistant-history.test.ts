import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_HISTORY_CHARS,
  ASSISTANT_KEEP_TURNS,
  AiToolsUnsupportedError,
  JSON_RESULT_PREFIX,
  compactHistory,
  defineAction,
  objectSchema,
  runAssistantTurn,
  type AiAction,
  type AiActionRisk,
  type AiChatMessage,
  type AiChatReply,
  type AiChatRequest,
  type AiClient,
  type AiToolCall,
} from '../src/ai/index.ts';
import * as core from '../src/index.ts';

// ---- 假动作与假客户端 ----

function action(name: string, risk: AiActionRisk): AiAction<null> {
  return defineAction<null, null>({
    name,
    description: name,
    parameters: objectSchema({}),
    risk,
    parse: () => null,
    preview: () => `预览 ${name}`,
    run: async () => 'ok',
  });
}

const ACTIONS: AiAction<null>[] = [action('look', 'query'), action('add', 'write'), action('wipe', 'danger')];

function call(id: string, name: string, args: unknown = {}): AiToolCall {
  return { id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) };
}

/** 按脚本应答；每一步先把 `stream` 里的文字逐段喂给 onText，模拟流式。 */
function streamingClient(script: Array<AiChatReply & { stream?: string[] }>): { client: AiClient; requests: AiChatRequest[] } {
  const requests: AiChatRequest[] = [];
  const queue = [...script];
  const client: AiClient = {
    complete: async () => {
      throw new Error('不该走 JSON 方式');
    },
    chat: async (request) => {
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const next = queue.shift();
      if (next === undefined) throw new Error('脚本已用完');
      let text = '';
      for (const piece of next.stream ?? []) {
        text += piece;
        request.onText?.(text);
      }
      return { content: next.content, toolCalls: next.toolCalls };
    },
  };
  return { client, requests };
}

function input(client: AiClient, history: AiChatMessage[] = []) {
  return { client, actions: ACTIONS, context: null, history, userText: '帮我安排一下', contextNote: '今天 2026-11-26' };
}

test('core 入口导出历史裁剪与常量', () => {
  assert.equal(core.compactHistory, compactHistory);
  assert.equal(ASSISTANT_KEEP_TURNS, 2);
  assert.equal(ASSISTANT_HISTORY_CHARS, 24_000);
  assert.equal(JSON_RESULT_PREFIX, '函数结果：');
});

// ---- onCall / onText ----

test('onCall：查询、写入、高危与未知函数都在处理前回调，未知函数的风险为 null', async () => {
  const { client } = streamingClient([
    { content: '', toolCalls: [call('1', 'look'), call('2', 'add'), call('3', 'wipe'), call('4', 'nope')] },
    { content: '好了', toolCalls: [] },
  ]);
  const calls: Array<[string, AiActionRisk | null]> = [];
  const queried: string[] = [];
  const result = await runAssistantTurn({
    ...input(client),
    onCall: (name, risk) => calls.push([name, risk]),
    onQuery: (name) => queried.push(name),
  });
  assert.deepEqual(calls, [
    ['look', 'query'],
    ['add', 'write'],
    ['wipe', 'danger'],
    ['nope', null],
  ]);
  assert.deepEqual(queried, ['look']);
  assert.deepEqual(result.plan.map((step) => step.action), ['add', 'wipe']);
});

test('onCall：参数不合法的调用也回调（处理前）', async () => {
  const { client } = streamingClient([
    { content: '', toolCalls: [call('1', 'add', '[1]'), call('2', 'look', '{坏')] },
    { content: '完', toolCalls: [] },
  ]);
  const calls: string[] = [];
  await runAssistantTurn({ ...input(client), onCall: (name) => calls.push(name) });
  assert.deepEqual(calls, ['add', 'look']);
});

test('onCall：JSON 退回方式下同样回调', async () => {
  const outputs = ['{"calls":[{"name":"look"},{"name":"add"}]}', '{"calls":[],"reply":"好"}'];
  const client: AiClient = { complete: async () => outputs.shift() ?? '' };
  const calls: Array<[string, AiActionRisk | null]> = [];
  const texts: string[] = [];
  const result = await runAssistantTurn({ ...input(client), onCall: (name, risk) => calls.push([name, risk]), onText: (text) => texts.push(text) });
  assert.equal(result.mode, 'json');
  assert.deepEqual(calls, [
    ['look', 'query'],
    ['add', 'write'],
  ]);
  assert.deepEqual(texts, [], 'JSON 方式不流式');
});

test('onText：每一步开始先回调空串，随后是流式全文；请求里转交 onText', async () => {
  const { client, requests } = streamingClient([
    { content: '我查', toolCalls: [call('1', 'look')], stream: ['我', '查'] },
    { content: '有两节课', toolCalls: [], stream: ['有两', '节课'] },
  ]);
  const texts: string[] = [];
  const onText = (text: string) => texts.push(text);
  const result = await runAssistantTurn({ ...input(client), onText });
  assert.deepEqual(texts, ['', '我', '我查', '', '有两', '有两节课']);
  assert.equal(result.reply, '有两节课');
  assert.equal(requests.length, 2);
  for (const request of requests) assert.equal(request.onText, onText);
});

test('onText：不给时请求里也不带 onText', async () => {
  const { client, requests } = streamingClient([{ content: '好', toolCalls: [] }]);
  await runAssistantTurn(input(client));
  assert.equal('onText' in requests[0]!, false);
});

test('onText：不支持函数调用退回 JSON 时，已回调的空串之后不再回调', async () => {
  let chatCalls = 0;
  const client: AiClient = {
    complete: async () => '{"calls":[],"reply":"退回后的回复"}',
    chat: async () => {
      chatCalls += 1;
      throw new AiToolsUnsupportedError('不支持');
    },
  };
  const texts: string[] = [];
  const result = await runAssistantTurn({ ...input(client), onText: (text) => texts.push(text) });
  assert.equal(chatCalls, 1);
  assert.equal(result.mode, 'json');
  assert.equal(result.reply, '退回后的回复');
  assert.deepEqual(texts, ['']);
});

// ---- 历史裁剪 ----

const user = (content: string): AiChatMessage => ({ role: 'user', content });
const assistant = (content: string, toolCalls?: AiToolCall[]): AiChatMessage =>
  toolCalls === undefined ? { role: 'assistant', content } : { role: 'assistant', content, toolCalls };
const tool = (toolCallId: string, content: string): AiChatMessage => ({ role: 'tool', toolCallId, content });

/** 函数调用方式的一轮：问、带调用的回复、结果、结论。 */
function toolsRound(n: number): AiChatMessage[] {
  return [user(`问${n}`), assistant(`查${n}`, [call(`c${n}`, 'look')]), tool(`c${n}`, `{"result":${n}}`), assistant(`答${n}`)];
}

test('裁剪：轮数不超过 keepTurns 时原样返回', () => {
  const history = [...toolsRound(1), ...toolsRound(2)];
  assert.deepEqual(compactHistory(history), history);
  assert.deepEqual(compactHistory([]), []);
});

test('裁剪：更早的轮次去掉函数调用与结果，只留问与结论；最近 keepTurns 轮原样', () => {
  const history = [...toolsRound(1), ...toolsRound(2), ...toolsRound(3), ...toolsRound(4)];
  const compacted = compactHistory(history);
  assert.deepEqual(compacted, [user('问1'), assistant('答1'), user('问2'), assistant('答2'), ...toolsRound(3), ...toolsRound(4)]);
  assert.equal(history.length, 16, '不改动传入的数组');

  assert.deepEqual(compactHistory(history, { keepTurns: 1 }).slice(0, 6), [
    user('问1'),
    assistant('答1'),
    user('问2'),
    assistant('答2'),
    user('问3'),
    assistant('答3'),
  ]);
  assert.deepEqual(compactHistory(history, { keepTurns: 0 }), [1, 2, 3, 4].flatMap((n) => [user(`问${n}`), assistant(`答${n}`)]));
});

test('裁剪：留下的序列里每个 tool 消息前都有对应的调用', () => {
  const history = [...toolsRound(1), ...toolsRound(2), ...toolsRound(3)];
  const compacted = compactHistory(history);
  const open = new Set<string>();
  for (const message of compacted) {
    if (message.role === 'assistant') for (const item of message.toolCalls ?? []) open.add(item.id);
    if (message.role === 'tool') assert.ok(open.has(message.toolCallId), `孤立的结果 ${message.toolCallId}`);
  }
});

test('裁剪：没收尾的旧轮次（用完步数）只留用户的话', () => {
  const history = [user('问1'), assistant('', [call('c1', 'look')]), tool('c1', '{}'), ...toolsRound(2), ...toolsRound(3)];
  assert.deepEqual(compactHistory(history).slice(0, 1), [user('问1')]);
  assert.deepEqual(compactHistory(history)[1], user('问2'));
});

test('裁剪：JSON 方式的旧轮次，函数结果消息不算新一轮，输出换成其中的 reply', () => {
  const history: AiChatMessage[] = [
    user('问1'),
    assistant('好的\n```json\n{"calls":[{"name":"look"}]}\n```'),
    user(`${JSON_RESULT_PREFIX}\nlook：{"result":"ok"}`),
    assistant('{"calls":[],"reply":"查到了"}'),
    user('问2'),
    assistant('随便聊聊，不是 JSON'),
    user('问3'),
    assistant('{"calls":[],"reply":""}'),
    ...toolsRound(4),
    ...toolsRound(5),
  ];
  assert.deepEqual(compactHistory(history).slice(0, 5), [
    user('问1'),
    assistant('查到了'),
    user('问2'),
    assistant('随便聊聊，不是 JSON'),
    user('问3'),
  ]);
  // 最近两轮原样保留
  assert.deepEqual(compactHistory(history).slice(5), [...toolsRound(4), ...toolsRound(5)]);
});

test('裁剪：JSON 方式最近的轮次原样保留，函数结果消息留在本轮里', () => {
  const history: AiChatMessage[] = [
    user('问1'),
    assistant('{"calls":[{"name":"look"}]}'),
    user(`${JSON_RESULT_PREFIX}\nlook：{}`),
    assistant('{"calls":[],"reply":"好"}'),
  ];
  assert.deepEqual(compactHistory(history), history);
});

test('裁剪：仍超过字符上限时从最早的轮次整轮丢弃，最近一轮总是保留', () => {
  const long = (n: number) => [user(`问${n}`), assistant('长'.repeat(100))];
  const history = [...long(1), ...long(2), ...long(3)];
  // 每轮 2 + 100 = 102 字
  assert.deepEqual(compactHistory(history, { maxChars: 306 }), history);
  assert.deepEqual(compactHistory(history, { maxChars: 305 }), [...long(2), ...long(3)]);
  assert.deepEqual(compactHistory(history, { maxChars: 204 }), [...long(2), ...long(3)]);
  assert.deepEqual(compactHistory(history, { maxChars: 203 }), long(3));
  assert.deepEqual(compactHistory(history, { maxChars: 10 }), long(3), '最后一轮超长也保留');
});

test('裁剪：字符数计入函数调用的名字与参数', () => {
  const round = (n: number) => [user(`问${n}`), assistant('', [call(`c${n}`, 'look', { pad: 'x'.repeat(40) })]), tool(`c${n}`, '{}'), assistant('答')];
  const history = [...round(1), ...round(2)];
  const size = (messages: AiChatMessage[]) =>
    messages.reduce(
      (sum, message) =>
        sum + message.content.length + (message.role === 'assistant' ? (message.toolCalls ?? []).reduce((acc, item) => acc + item.name.length + item.arguments.length, 0) : 0),
      0,
    );
  const total = size(history);
  assert.deepEqual(compactHistory(history, { maxChars: total }), history);
  assert.deepEqual(compactHistory(history, { maxChars: total - 1 }), round(2));
});

test('裁剪：开头不是用户消息时也算作一轮', () => {
  const history = [assistant('欢迎'), ...toolsRound(1), ...toolsRound(2)];
  assert.deepEqual(compactHistory(history, { keepTurns: 3 }), history);
  assert.deepEqual(compactHistory(history, { keepTurns: 1 }).slice(0, 3), [assistant('欢迎'), user('问1'), assistant('答1')]);
});

test('runAssistantTurn：发给模型的历史按默认参数裁剪，返回的对话从裁剪后的历史接着', async () => {
  const history = [...toolsRound(1), ...toolsRound(2), ...toolsRound(3)];
  const { client, requests } = streamingClient([{ content: '好', toolCalls: [] }]);
  const result = await runAssistantTurn(input(client, history));
  const expected = [user('问1'), assistant('答1'), ...toolsRound(2), ...toolsRound(3), user('帮我安排一下')];
  assert.deepEqual(requests[0]!.messages.slice(1), expected);
  assert.deepEqual(result.history, [...expected, assistant('好')]);
});

test('runAssistantTurn：很长的历史裁到字符上限以内', async () => {
  const history = Array.from({ length: 10 }, (_, n) => [user(`问${n}`), assistant('字'.repeat(5_000))]).flat();
  const { client, requests } = streamingClient([{ content: '好', toolCalls: [] }]);
  await runAssistantTurn(input(client, history));
  const sent = requests[0]!.messages.slice(1, -1);
  const chars = sent.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(chars <= ASSISTANT_HISTORY_CHARS, `裁剪后仍有 ${chars} 字`);
  assert.equal(sent.at(-1)?.content, '字'.repeat(5_000), '最近的回复保留');
  assert.equal(sent[0]?.role, 'user', '从整轮开始');
});
