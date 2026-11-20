import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, createSemester, type AiClient, type AiRequest, type Storage } from '@dawn-tick/core';
import { aiInputOf, recognizeWithAi } from '../src/screens/import/ai-recognize.ts';

/** 假客户端：记下请求，回固定输出。 */
function fakeClient(output: string): { client: AiClient; requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    requests,
    client: {
      complete: async (request) => {
        requests.push(request);
        return output;
      },
    },
  };
}

async function seed(options: { withDefaultTimeSlots?: boolean } = {}): Promise<{ storage: Storage; semesterId: string }> {
  const storage = new MemoryStorage();
  const semester = await createSemester(storage, {
    userId: 'u1',
    name: '测试学期',
    startDate: '2026-09-07',
    totalWeeks: 16,
    timeZone: 'Asia/Shanghai',
    ...(options.withDefaultTimeSlots === undefined ? {} : { withDefaultTimeSlots: options.withDefaultTimeSlots }),
  });
  return { storage, semesterId: String(semester['id']) };
}

test('aiInputOf：纯文本只去首尾空白', () => {
  assert.equal(aiInputOf('  周一 1-2 节 高数\n周三 3-4 节 英语  '), '周一 1-2 节 高数\n周三 3-4 节 英语');
  assert.equal(aiInputOf('a < b 且 c > d'), 'a < b 且 c > d', '不像标签的尖括号不当 HTML');
});

test('aiInputOf：去掉标签、脚本与样式，单元格用竖线分隔，行换行', () => {
  const html = [
    '<html><head><style>td { color: red }</style><script>var secret = "<td>x</td>";</script></head>',
    '<body><table>',
    '<tr><th>节次</th><th>星期一</th></tr>',
    '<tr><td>1-2</td><td>高等数学<br/>教三-201&nbsp;张老师</td></tr>',
    '</table><p>备注</p></body></html>',
  ].join('\n');
  const text = aiInputOf(html);
  assert.doesNotMatch(text, /<|>/, '不留标签');
  assert.doesNotMatch(text, /secret|color/, '脚本与样式整段去掉');
  assert.doesNotMatch(text, /&nbsp;/);
  assert.match(text, /节次 \| 星期一 \|/);
  assert.match(text, /1-2 \| 高等数学\n教三-201 张老师 \|/);
  assert.match(text, /备注$/);
  assert.doesNotMatch(text, /\n\s*\n/, '不留空行');
});

test('aiInputOf：去掉书签粘贴的页面标记', () => {
  const pasted = '前缀<<<DAWNTICK>>>{"url":"https://jw.example.edu"}<<<FRAME>>><table><tr><td>高数</td></tr></table><<<END>>>尾巴';
  const text = aiInputOf(pasted);
  assert.equal(text, '高数 |');
});

test('recognizeWithAi：提示词带学期周数与节次，结果经校验返回', async () => {
  const { storage, semesterId } = await seed();
  const output = JSON.stringify([
    { courseName: '高等数学', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: '1-8', room: '教三-201', teacher: null },
    { courseName: '晚课', dayOfWeek: 2, periodStart: 11, periodEnd: 12 },
  ]);
  const { client, requests } = fakeClient(`\`\`\`json\n${output}\n\`\`\``);
  const result = await recognizeWithAi(client, storage, semesterId, '<table><tr><td>高等数学</td></tr></table>');

  assert.equal(requests.length, 1);
  const [system, user] = requests[0]!.messages;
  assert.match(system!.content, /本学期共 16 周/);
  assert.match(system!.content, /1 08:00-08:45；2 08:55-09:40/, '节次对照来自学期作息');
  assert.match(system!.content, /10 19:55-20:40/);
  assert.equal(user!.content, '高等数学 |', '发给模型的是去掉标签后的文本');

  assert.deepEqual(result.schedules, [
    {
      courseName: '高等数学',
      dayOfWeek: 1,
      periodStart: 1,
      periodEnd: 2,
      weeks: [1, 2, 3, 4, 5, 6, 7, 8],
      room: '教三-201',
      teacher: null,
    },
  ]);
  assert.deepEqual(result.warnings, ['「晚课」节次不在 1–10，已跳过'], '超出作息节数的条目丢弃');
});

test('recognizeWithAi：学期没有作息时节次上限按 20', async () => {
  const { storage, semesterId } = await seed({ withDefaultTimeSlots: false });
  const { client, requests } = fakeClient(
    JSON.stringify([
      { courseName: '晚课', dayOfWeek: 2, periodStart: 11, periodEnd: 12 },
      { courseName: '太晚', dayOfWeek: 2, periodStart: 21 },
    ]),
  );
  const result = await recognizeWithAi(client, storage, semesterId, '晚课');
  assert.match(requests[0]!.messages[0]!.content, /节次对照：（未提供）/);
  assert.deepEqual(
    result.schedules.map((item) => item.courseName),
    ['晚课'],
  );
  assert.deepEqual(result.warnings, ['「太晚」节次不在 1–20，已跳过']);
});

test('recognizeWithAi：学期不存在时不调用 AI', async () => {
  const { client, requests } = fakeClient('[]');
  await assert.rejects(recognizeWithAi(client, new MemoryStorage(), 'missing', 'x'), /学期不存在/);
  assert.equal(requests.length, 0);
});

test('recognizeWithAi：模型输出不是 JSON 时抛可读错误', async () => {
  const { storage, semesterId } = await seed();
  const { client } = fakeClient('抱歉，没看懂');
  await assert.rejects(recognizeWithAi(client, storage, semesterId, 'x'), /没有 JSON/);
});

test('recognizeWithAi：客户端错误原样抛出', async () => {
  const { storage, semesterId } = await seed();
  const client: AiClient = {
    complete: async () => {
      throw new Error('AI 服务拒绝访问（401），检查 API 密钥');
    },
  };
  await assert.rejects(recognizeWithAi(client, storage, semesterId, 'x'), /401/);
});
