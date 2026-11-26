import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAiCompatibleClient, type AiFetchResponse } from '@dawn-tick/core';
import { pluginStreamFetch } from '../src/lib/ai-stream.ts';
import type { AiStreamEvent, AiStreamPlugin } from '../src/lib/plugins.ts';

type StartOptions = Parameters<AiStreamPlugin['start']>[0];

/** 假插件：记下 start / cancel / addListener，测试里手动推事件。 */
function fakePlugin(options: { startError?: Error } = {}) {
  const listeners: Array<(event: AiStreamEvent) => void> = [];
  const starts: StartOptions[] = [];
  const cancels: string[] = [];
  const plugin: AiStreamPlugin = {
    async start(request) {
      starts.push(request);
      if (options.startError !== undefined) throw options.startError;
    },
    async cancel({ id }) {
      cancels.push(id);
    },
    async addListener(_name, listener) {
      listeners.push(listener);
      return { remove: async () => undefined };
    },
  };
  const emit = (event: AiStreamEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { plugin, listeners, starts, cancels, emit };
}

/** 让已排队的微任务与回调都跑完：fetch 内部要先等监听挂上再发请求。 */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function ids(...list: string[]): () => string {
  const queue = [...list];
  return () => queue.shift() ?? 'extra';
}

const INIT = { method: 'POST', headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' }, body: '{"stream":true}' };

async function readAll(response: AiFetchResponse): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    out += decoder.decode(value, { stream: true });
  }
}

test('请求经 start 发出，带地址、请求头与请求体；status 到达后返回响应', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  let settled = false;
  const pending = fetch('https://api.example.com/v1/chat/completions', INIT).then((response) => {
    settled = true;
    return response;
  });
  await flush();
  assert.deepEqual(fake.starts, [{ id: 'r1', url: 'https://api.example.com/v1/chat/completions', headers: INIT.headers, body: INIT.body }]);
  assert.equal(settled, false, 'status 之前不返回');
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
});

test('chunk 按顺序读出，end 后读到 done；status 之后、读取之前到的 chunk 不丢', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  fake.emit({ id: 'r1', type: 'chunk', text: 'data: 一' });
  const response = await pending;
  const reading = readAll(response);
  fake.emit({ id: 'r1', type: 'chunk', text: '' });
  fake.emit({ id: 'r1', type: 'chunk', text: '二\n' });
  await flush();
  fake.emit({ id: 'r1', type: 'chunk', text: '三' });
  fake.emit({ id: 'r1', type: 'end' });
  assert.equal(await reading, 'data: 一二\n三');
});

test('非 2xx 的 status：ok 为 false，text() 读出错误正文', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'status', status: 401 });
  fake.emit({ id: 'r1', type: 'chunk', text: '{"error":' });
  fake.emit({ id: 'r1', type: 'chunk', text: '"bad key"}' });
  fake.emit({ id: 'r1', type: 'end' });
  const response = await pending;
  assert.equal(response.ok, false);
  assert.equal(response.status, 401);
  assert.equal(await response.text(), '{"error":"bad key"}');
});

test('缺 status 字段时按 0 处理，ok 为 false', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'status' });
  const response = await pending;
  assert.equal(response.status, 0);
  assert.equal(response.ok, false);
});

test('响应体只能取一次：getReader 与 text() 二选一', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1', 'r2'));
  const first = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  fake.emit({ id: 'r1', type: 'end' });
  const a = await first;
  a.body!.getReader();
  assert.throws(() => a.body!.getReader(), TypeError);
  await assert.rejects(a.text(), TypeError);

  const second = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r2', type: 'status', status: 200 });
  fake.emit({ id: 'r2', type: 'end' });
  const b = await second;
  assert.equal(await b.text(), '');
  assert.throws(() => b.body!.getReader(), TypeError);
});

test('同一插件只挂一个监听；并发请求按 id 分发，互不串', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('a', 'b'));
  const pa = fetch('u', INIT);
  const pb = fetch('u', INIT);
  await flush();
  assert.equal(fake.listeners.length, 1);
  assert.deepEqual(fake.starts.map((start) => start.id), ['a', 'b']);
  fake.emit({ id: 'b', type: 'status', status: 500 });
  fake.emit({ id: 'a', type: 'status', status: 200 });
  fake.emit({ id: 'a', type: 'chunk', text: 'A1' });
  fake.emit({ id: 'b', type: 'chunk', text: 'B1' });
  fake.emit({ id: 'a', type: 'chunk', text: 'A2' });
  fake.emit({ id: 'b', type: 'end' });
  fake.emit({ id: 'a', type: 'end' });
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 500);
  assert.equal(await ra.text(), 'A1A2');
  assert.equal(await rb.text(), 'B1');
  // 之后的请求也不再挂监听
  const pc = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'extra', type: 'status', status: 200 });
  fake.emit({ id: 'extra', type: 'end' });
  await pc;
  assert.equal(fake.listeners.length, 1);
});

test('不传 idOf 时每个请求的 id 都不同', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin);
  void fetch('u', INIT);
  void fetch('u', INIT);
  await flush();
  assert.equal(fake.starts.length, 2);
  assert.notEqual(fake.starts[0]!.id, fake.starts[1]!.id);
});

test('未知 id、没有 id 的事件与结束后的事件都忽略', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'other', type: 'status', status: 500 });
  fake.emit({ type: 'status', status: 500 });
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  fake.emit({ id: 'r1', type: 'status', status: 404 });
  fake.emit({ id: 'r1', type: 'chunk', text: '有' });
  fake.emit({ id: 'r1', type: 'end' });
  fake.emit({ id: 'r1', type: 'chunk', text: '迟到' });
  fake.emit({ id: 'r1', type: 'error', message: '迟到的错误' });
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '有');
});

test('status 之前收到 error：请求以该说明失败', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'error', message: '无法连接服务器' });
  await assert.rejects(pending, /无法连接服务器/);
});

test('status 之前收到 end：请求失败', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'end' });
  await assert.rejects(pending, Error);
});

test('status 之后收到 error：已到的文字先读出，随后读取失败', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  fake.emit({ id: 'r1', type: 'chunk', text: '前半' });
  fake.emit({ id: 'r1', type: 'error', message: '连接中断' });
  const reader = (await pending).body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.equal(new TextDecoder().decode(first.value), '前半');
  await assert.rejects(reader.read(), /连接中断/);
});

test('status 之后出错时 text() 也失败', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const pending = fetch('u', INIT);
  await flush();
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  const response = await pending;
  const text = response.text();
  fake.emit({ id: 'r1', type: 'chunk', text: '半' });
  fake.emit({ id: 'r1', type: 'error', message: '断了' });
  await assert.rejects(text, /断了/);
});

test('start 本身失败：请求以该错误失败', async () => {
  const fake = fakePlugin({ startError: new Error('插件未实现') });
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  await assert.rejects(fetch('u', INIT), /插件未实现/);
});

test('发出前已取消：不调 start，直接以取消原因失败', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const controller = new AbortController();
  const reason = new Error('用户停止');
  controller.abort(reason);
  await assert.rejects(fetch('u', { ...INIT, signal: controller.signal }), (error) => error === reason);
  await flush();
  assert.deepEqual(fake.starts, []);
  assert.deepEqual(fake.cancels, []);
});

test('status 之前取消：调 cancel 并以取消原因失败，之后的事件忽略', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const controller = new AbortController();
  const pending = fetch('u', { ...INIT, signal: controller.signal });
  await flush();
  controller.abort();
  await assert.rejects(pending, (error: unknown) => (error as { name?: string }).name === 'AbortError');
  assert.deepEqual(fake.cancels, ['r1']);
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  fake.emit({ id: 'r1', type: 'end' });
});

test('读取中途取消：调 cancel，读取以取消原因失败', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const controller = new AbortController();
  const pending = fetch('u', { ...INIT, signal: controller.signal });
  await flush();
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  const reader = (await pending).body!.getReader();
  const read = reader.read();
  const reason = new Error('停止');
  controller.abort(reason);
  await assert.rejects(read, (error) => error === reason);
  assert.deepEqual(fake.cancels, ['r1']);
});

test('正常结束后再取消：不再调 cancel', async () => {
  const fake = fakePlugin();
  const fetch = pluginStreamFetch(fake.plugin, ids('r1'));
  const controller = new AbortController();
  const pending = fetch('u', { ...INIT, signal: controller.signal });
  await flush();
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  fake.emit({ id: 'r1', type: 'chunk', text: '完' });
  fake.emit({ id: 'r1', type: 'end' });
  const response = await pending;
  controller.abort();
  assert.deepEqual(fake.cancels, []);
  assert.equal(await response.text(), '完');
});

test('接到 core 的客户端：流式 chat 逐段回调，多字节文字不乱码', async () => {
  const fake = fakePlugin();
  const client = createOpenAiCompatibleClient(
    { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'sk' },
    pluginStreamFetch(fake.plugin, ids('r1')),
  );
  const texts: string[] = [];
  const pending = client.chat!({ messages: [{ role: 'user', content: '嗨' }], tools: [], onText: (text) => texts.push(text) });
  await flush();
  assert.equal(JSON.parse(fake.starts[0]!.body)['stream'], true);
  fake.emit({ id: 'r1', type: 'status', status: 200 });
  const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const all = event('你好') + event('，同学') + 'data: [DONE]\n\n';
  // 按字符切三段，跨过事件边界
  fake.emit({ id: 'r1', type: 'chunk', text: all.slice(0, 20) });
  await flush();
  fake.emit({ id: 'r1', type: 'chunk', text: all.slice(20, 60) });
  await flush();
  fake.emit({ id: 'r1', type: 'chunk', text: all.slice(60) });
  fake.emit({ id: 'r1', type: 'end' });
  assert.deepEqual(await pending, { content: '你好，同学', toolCalls: [] });
  assert.deepEqual(texts, ['你好', '你好，同学']);
});

test(
  '等监听挂上期间取消：不再发请求，以取消原因失败',
  async () => {
    let release!: () => void;
    const starts: string[] = [];
    const plugin: AiStreamPlugin = {
      async start({ id }) {
        starts.push(id);
      },
      async cancel() {},
      addListener: () =>
        new Promise((resolve) => {
          release = () => resolve({ remove: async () => undefined });
        }),
    };
    const fetch = pluginStreamFetch(plugin, ids('r1'));
    const controller = new AbortController();
    const pending = fetch('u', { ...INIT, signal: controller.signal });
    await flush();
    controller.abort();
    release();
    const outcome = await Promise.race([
      pending.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 100)),
    ]);
    assert.equal(outcome, 'rejected');
    assert.deepEqual(starts, []);
  },
);
