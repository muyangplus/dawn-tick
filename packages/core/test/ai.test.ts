import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_INPUT_LIMIT,
  aiConfigProblem,
  chatCompletionsUrl,
  completionText,
  createOpenAiCompatibleClient,
  eventPromptMessages,
  extractJson,
  parseEventDrafts,
  parseScheduleDrafts,
  schedulePromptMessages,
  type AiConfig,
  type AiFetch,
} from '../src/ai/index.ts';
import * as core from '../src/index.ts';

const CONFIG: AiConfig = { baseUrl: 'https://api.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' };

interface Call {
  url: string;
  init: Parameters<AiFetch>[1];
}

/** 假 fetch：记下请求，按给定状态码与正文应答。 */
function fakeFetch(status: number, body: string): { fetch: AiFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: AiFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetch, calls };
}

function reply(content: unknown): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
}

test('core 入口导出 AI 模块', () => {
  assert.equal(typeof core.createOpenAiCompatibleClient, 'function');
  assert.equal(typeof core.parseScheduleDrafts, 'function');
  assert.equal(typeof core.eventPromptMessages, 'function');
});

test('aiConfigProblem：逐项指出缺什么，齐全返回 null', () => {
  assert.equal(aiConfigProblem(CONFIG), null);
  assert.equal(aiConfigProblem({ ...CONFIG, baseUrl: '  ' }), '未填写 AI 接口地址');
  assert.match(aiConfigProblem({ ...CONFIG, baseUrl: 'api.example.com/v1' }) ?? '', /http:\/\/ 或 https:\/\//);
  assert.equal(aiConfigProblem({ ...CONFIG, baseUrl: 'HTTP://localhost:11434/v1' }), null, '协议大小写不敏感');
  assert.equal(aiConfigProblem({ ...CONFIG, model: ' ' }), '未填写模型名称');
  assert.equal(aiConfigProblem({ ...CONFIG, apiKey: '' }), '未填写 API 密钥');
});

test('chatCompletionsUrl：补全路径，去掉末尾斜杠，已带路径不重复', () => {
  assert.equal(chatCompletionsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl(' https://api.example.com/v1/// '), 'https://api.example.com/v1/chat/completions');
  assert.equal(
    chatCompletionsUrl('https://api.example.com/v1/chat/completions/'),
    'https://api.example.com/v1/chat/completions',
  );
  assert.equal(
    chatCompletionsUrl('https://api.example.com/v1/Chat/Completions'),
    'https://api.example.com/v1/Chat/Completions',
  );
});

test('completionText：取第一条消息，空内容与非 JSON 报可读错误', () => {
  assert.equal(completionText(reply('[1]')), '[1]');
  assert.throws(() => completionText('<html>bad gateway</html>'), /不是 JSON/);
  assert.throws(() => completionText(JSON.stringify({ choices: [] })), /没有返回内容/);
  assert.throws(() => completionText(JSON.stringify({})), /没有返回内容/);
  assert.throws(() => completionText(reply('   ')), /没有返回内容/);
  assert.throws(() => completionText(reply(null)), /没有返回内容/);
});

test('客户端：POST 到补全地址，带 Bearer 密钥与 temperature 0', async () => {
  const { fetch, calls } = fakeFetch(200, reply('好的'));
  const client = createOpenAiCompatibleClient({ ...CONFIG, baseUrl: 'https://api.example.com/v1/', model: ' m1 ' }, fetch);
  const messages = [
    { role: 'system' as const, content: 's' },
    { role: 'user' as const, content: 'u' },
  ];
  assert.equal(await client.complete({ messages }), '好的');
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Authorization'], 'Bearer sk-test');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), { model: 'm1', messages, temperature: 0 });
  assert.equal('signal' in call.init, false, '未给 signal 时不带该字段');
});

test('客户端：转交取消信号', async () => {
  const { fetch, calls } = fakeFetch(200, reply('x'));
  const controller = new AbortController();
  await createOpenAiCompatibleClient(CONFIG, fetch).complete({ messages: [], signal: controller.signal });
  assert.equal(calls[0]!.init.signal, controller.signal);
});

test('客户端：配置不全时不发请求', async () => {
  const { fetch, calls } = fakeFetch(200, reply('x'));
  await assert.rejects(
    createOpenAiCompatibleClient({ ...CONFIG, apiKey: '' }, fetch).complete({ messages: [] }),
    /未填写 API 密钥/,
  );
  assert.equal(calls.length, 0);
});

test('客户端：HTTP 错误映射成可读说明', async () => {
  const cases: Array<[number, string, RegExp]> = [
    [401, '{"error":{"message":"invalid key"}}', /拒绝访问（401），检查 API 密钥/],
    [403, '', /拒绝访问（403）/],
    [404, 'not found', /找不到接口（404），检查接口地址与模型名称/],
    [429, '{"error":"quota"}', /请求过多或额度不足（429）/],
    [500, '{"error":{"message":"upstream down"}}', /: AI 服务返回错误（500）：upstream down$/],
    [502, '{"error":"bad gateway"}', /: AI 服务返回错误（502）：bad gateway$/],
    [503, '<html>busy</html>', /: AI 服务返回错误（503）$/],
  ];
  for (const [status, body, expected] of cases) {
    const { fetch } = fakeFetch(status, body);
    await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).complete({ messages: [] }), expected, `${status}`);
  }
});

test('客户端：服务端错误详情截到 200 字', async () => {
  const { fetch } = fakeFetch(500, JSON.stringify({ error: { message: 'x'.repeat(500) } }));
  await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).complete({ messages: [] }), (error: Error) => {
    assert.equal(error.message, `AI 服务返回错误（500）：${'x'.repeat(200)}`);
    return true;
  });
});

test('客户端：网络异常原样抛出', async () => {
  const fetch: AiFetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(createOpenAiCompatibleClient(CONFIG, fetch).complete({ messages: [] }), /Failed to fetch/);
});

test('extractJson：容忍代码块与前后说明文字', () => {
  assert.deepEqual(extractJson('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(extractJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractJson('结果如下：\n```\n{"items":[]}\n```\n以上。'), { items: [] });
  assert.deepEqual(extractJson('结果如下：[1, 2] 完毕'), [1, 2]);
  assert.deepEqual(extractJson('说明 {"items":[{"a":[1]}]} 结束'), { items: [{ a: [1] }] });
  assert.throws(() => extractJson('没有识别到课程'), /没有 JSON/);
  assert.throws(() => extractJson('[{"a":1}'), /不完整/);
  assert.throws(() => extractJson('[a, b]'), /无法解析/);
});

const SEMESTER = { totalWeeks: 16, periodCount: 10 };
const ALL_WEEKS = Array.from({ length: 16 }, (_, index) => index + 1);

test('课表草稿：合法条目原样保留，周次缺省为全学期', () => {
  const output = JSON.stringify([
    { courseName: ' 高等数学 ', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: [1, 2, 3], room: '教三-201', teacher: '张老师' },
    { courseName: '大学英语', dayOfWeek: '3', periodStart: '5', room: '', teacher: null },
  ]);
  const result = parseScheduleDrafts(output, SEMESTER);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items, [
    { courseName: '高等数学', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: [1, 2, 3], room: '教三-201', teacher: '张老师' },
    { courseName: '大学英语', dayOfWeek: 3, periodStart: 5, periodEnd: 5, weeks: ALL_WEEKS, room: null, teacher: null },
  ]);
});

test('课表草稿：顶层可以是 { items }，也可以在代码块里', () => {
  const body = JSON.stringify({ items: [{ courseName: '线代', dayOfWeek: 2, periodStart: 3, periodEnd: 4, weeks: null }] });
  const result = parseScheduleDrafts(`\`\`\`json\n${body}\n\`\`\``, SEMESTER);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0]!.weeks, ALL_WEEKS, 'weeks 为 null 按全学期');
  assert.throws(() => parseScheduleDrafts('{"courses":[]}', SEMESTER), /不是条目列表/);
});

test('课表草稿：周次文本支持区间与列表，超出学期的去掉', () => {
  const weeksOf = (weeks: unknown): number[] | undefined =>
    parseScheduleDrafts(JSON.stringify([{ courseName: 'X', dayOfWeek: 1, periodStart: 1, weeks }]), SEMESTER).items[0]?.weeks;
  assert.deepEqual(weeksOf('1-8,10'), [1, 2, 3, 4, 5, 6, 7, 8, 10]);
  assert.deepEqual(weeksOf('1-4，6、8 9'), [1, 2, 3, 4, 6, 8, 9]);
  assert.deepEqual(weeksOf('3~1'), [1, 2, 3], '倒序区间按升序展开');
  assert.deepEqual(weeksOf('12-20'), [12, 13, 14, 15, 16]);
  assert.deepEqual(weeksOf([3, '2', 2, 0, 17, 1.5]), [2, 3], '去重、排序、丢掉学期外与非整数');
});

test('课表草稿：周次全在学期外时跳过并说明', () => {
  const result = parseScheduleDrafts(
    JSON.stringify([{ courseName: '暑期实践', dayOfWeek: 1, periodStart: 1, weeks: '17-18' }]),
    SEMESTER,
  );
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.warnings, ['「暑期实践」周次不在本学期内，已跳过']);
});

test('课表草稿：非法条目丢弃并逐条记说明', () => {
  const output = JSON.stringify([
    'not-object',
    null,
    { courseName: '  ', dayOfWeek: 1, periodStart: 1 },
    { courseName: '周八课', dayOfWeek: 8, periodStart: 1 },
    { courseName: '周零课', dayOfWeek: 0, periodStart: 1 },
    { courseName: '缺节次', dayOfWeek: 1 },
    { courseName: '节次倒置', dayOfWeek: 1, periodStart: 4, periodEnd: 3 },
    { courseName: '节次超出', dayOfWeek: 1, periodStart: 10, periodEnd: 11 },
    { courseName: '小数节次', dayOfWeek: 1, periodStart: 1.5 },
    { courseName: '合法', dayOfWeek: 7, periodStart: 10 },
  ]);
  const result = parseScheduleDrafts(output, SEMESTER);
  assert.deepEqual(
    result.items.map((item) => item.courseName),
    ['合法'],
  );
  assert.deepEqual(result.warnings, [
    '第 1 条不是对象，已跳过',
    '第 2 条不是对象，已跳过',
    '第 3 条缺少课程名，已跳过',
    '「周八课」星期不在 1–7，已跳过',
    '「周零课」星期不在 1–7，已跳过',
    '「缺节次」节次不在 1–10，已跳过',
    '「节次倒置」节次不在 1–10，已跳过',
    '「节次超出」节次不在 1–10，已跳过',
    '「小数节次」节次不在 1–10，已跳过',
  ]);
});

test('课表草稿：作息节数为 0 时至少允许第 1 节', () => {
  const output = JSON.stringify([
    { courseName: 'A', dayOfWeek: 1, periodStart: 1 },
    { courseName: 'B', dayOfWeek: 1, periodStart: 2 },
  ]);
  const result = parseScheduleDrafts(output, { totalWeeks: 2, periodCount: 0 });
  assert.deepEqual(
    result.items.map((item) => item.courseName),
    ['A'],
  );
  assert.deepEqual(result.warnings, ['「B」节次不在 1–1，已跳过']);
});

test('日程草稿：合法条目保留，未知类型按普通日程', () => {
  const output = JSON.stringify([
    { kind: 'homework', title: '数据结构作业', date: '2026-11-27', startTime: '15:00', endTime: null, location: null, note: '交到教学平台' },
    { kind: 'exam', title: '高数期中', date: '2026-12-01', startTime: '09:00', endTime: '11:00', location: 'A101', note: '' },
    { kind: 'meeting', title: '班会', date: '2026-11-21' },
  ]);
  const result = parseEventDrafts(`好的：\n${output}`);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items, [
    { kind: 'homework', title: '数据结构作业', date: '2026-11-27', startTime: '15:00', endTime: null, location: null, note: '交到教学平台' },
    { kind: 'exam', title: '高数期中', date: '2026-12-01', startTime: '09:00', endTime: '11:00', location: 'A101', note: null },
    { kind: 'todo', title: '班会', date: '2026-11-21', startTime: null, endTime: null, location: null, note: null },
  ]);
});

test('日程草稿：缺标题与非法日期整条丢弃', () => {
  const output = JSON.stringify([
    42,
    { title: '', date: '2026-11-21' },
    { title: '无日期' },
    { title: '格式不对', date: '2026/11/21' },
    { title: '二月三十', date: '2026-02-30' },
    { title: '十三月', date: '2026-13-01' },
    { title: '闰日', date: '2028-02-29' },
  ]);
  const result = parseEventDrafts(output);
  assert.deepEqual(
    result.items.map((item) => item.title),
    ['闰日'],
  );
  assert.deepEqual(result.warnings, [
    '第 1 条不是对象，已跳过',
    '第 2 条缺少标题，已跳过',
    '「无日期」日期不是 YYYY-MM-DD，已跳过',
    '「格式不对」日期不是 YYYY-MM-DD，已跳过',
    '「二月三十」日期不是 YYYY-MM-DD，已跳过',
    '「十三月」日期不是 YYYY-MM-DD，已跳过',
  ]);
});

test('日程草稿：时刻非法置空并说明，结束不晚于开始时去掉结束', () => {
  const output = JSON.stringify([
    { title: '开始非法', date: '2026-11-21', startTime: '9:00', endTime: '10:00' },
    { title: '开始越界', date: '2026-11-21', startTime: '24:00' },
    { title: '结束非法', date: '2026-11-21', startTime: '09:00', endTime: '10:60' },
    { title: '结束相等', date: '2026-11-21', startTime: '09:00', endTime: '09:00' },
    { title: '结束更早', date: '2026-11-21', startTime: '10:00', endTime: '09:30' },
    { title: '只有结束', date: '2026-11-21', startTime: null, endTime: '10:00' },
    { title: '正常', date: '2026-11-21', startTime: '23:00', endTime: '23:59' },
  ]);
  const result = parseEventDrafts(output);
  assert.deepEqual(
    result.items.map((item) => [item.title, item.startTime, item.endTime]),
    [
      ['开始非法', null, null],
      ['开始越界', null, null],
      ['结束非法', '09:00', null],
      ['结束相等', '09:00', null],
      ['结束更早', '10:00', null],
      ['只有结束', null, null],
      ['正常', '23:00', '23:59'],
    ],
  );
  assert.deepEqual(result.warnings, [
    '「开始非法」开始时刻无法识别，按无时刻处理',
    '「开始非法」结束时刻无法识别，已去掉',
    '「开始越界」开始时刻无法识别，按无时刻处理',
    '「结束非法」结束时刻无法识别，已去掉',
    '「结束相等」结束时刻无法识别，已去掉',
    '「结束更早」结束时刻无法识别，已去掉',
    '「只有结束」结束时刻无法识别，已去掉',
  ]);
});

test('日程草稿：没有 JSON 时抛可读错误', () => {
  assert.throws(() => parseEventDrafts('抱歉，我无法理解'), /没有 JSON/);
  assert.deepEqual(parseEventDrafts('[]'), { items: [], warnings: [] });
});

test('课表提示词：带学期周数与节次对照，用户内容单独一条', () => {
  const messages = schedulePromptMessages('周一 1-2 节 高数', {
    totalWeeks: 18,
    periods: ['1 08:00-08:45', '2 08:55-09:40'],
  });
  assert.deepEqual(
    messages.map((message) => message.role),
    ['system', 'user'],
  );
  assert.match(messages[0]!.content, /本学期共 18 周/);
  assert.match(messages[0]!.content, /1 08:00-08:45；2 08:55-09:40/);
  assert.match(messages[0]!.content, /courseName/);
  assert.equal(messages[1]!.content, '周一 1-2 节 高数');

  const empty = schedulePromptMessages('x', { totalWeeks: 16, periods: [] });
  assert.match(empty[0]!.content, /节次对照：（未提供）/);
});

test('日程提示词：带今天、星期与时区', () => {
  const messages = eventPromptMessages('明天下午三点交作业', {
    today: '2026-11-20',
    weekday: 5,
    timeZone: 'Asia/Shanghai',
  });
  assert.deepEqual(
    messages.map((message) => message.role),
    ['system', 'user'],
  );
  assert.match(messages[0]!.content, /今天是 2026-11-20，星期 5，时区 Asia\/Shanghai/);
  assert.match(messages[0]!.content, /"kind": "todo" \| "homework" \| "exam"/);
  assert.equal(messages[1]!.content, '明天下午三点交作业');
});

test('提示词：用户内容超过上限时截断，未超不动', () => {
  const long = 'a'.repeat(AI_INPUT_LIMIT + 123);
  assert.equal(schedulePromptMessages(long, { totalWeeks: 16, periods: [] })[1]!.content.length, AI_INPUT_LIMIT);
  const event = eventPromptMessages(long, { today: '2026-11-20', weekday: 5, timeZone: 'UTC' });
  assert.equal(event[1]!.content, 'a'.repeat(AI_INPUT_LIMIT));
  const exact = 'b'.repeat(AI_INPUT_LIMIT);
  assert.equal(eventPromptMessages(exact, { today: '2026-11-20', weekday: 5, timeZone: 'UTC' })[1]!.content, exact);
});
