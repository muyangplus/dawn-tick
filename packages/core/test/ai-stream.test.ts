import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiToolsUnsupportedError,
  ChatStreamAccumulator,
  createOpenAiCompatibleClient,
  type AiByteReader,
  type AiConfig,
  type AiFetch,
  type AiFetchResponse,
} from '../src/ai/index.ts';
import * as core from '../src/index.ts';

const CONFIG: AiConfig = { baseUrl: 'https://api.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' };

const TOOLS = [{ name: 'list_courses', description: '列出课程', parameters: { type: 'object', properties: {} } }];

/** 一条 SSE 事件：`data: <json>` 加空行。 */
function sse(payload: unknown): string {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
}

function textDelta(content: string): string {
  return sse({ choices: [{ index: 0, delta: { content } }] });
}

function toolDelta(calls: unknown[]): string {
  return sse({ choices: [{ index: 0, delta: { tool_calls: calls } }] });
}

/** 把字节切成固定大小的块（可能切在多字节字符中间）。 */
function byteChunks(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) out.push(bytes.slice(offset, offset + size));
  return out;
}

interface StreamFetch {
  fetch: AiFetch;
  bodies: Array<Record<string, unknown>>;
  /** 每次读取前后的记录：reader 读了几次、是否被取消、text() 是否被调用 */
  stats: { reads: number; cancelled: unknown[]; textCalls: number; readerCalls: number };
}

/** 假 fetch：响应体按给定的字节块逐段吐出；`withBody: false` 时只能 text()。 */
function streamFetch(
  chunks: Uint8Array[],
  options: { status?: number; withBody?: boolean; failAt?: number } = {},
): StreamFetch {
  const status = options.status ?? 200;
  const bodies: Array<Record<string, unknown>> = [];
  const stats = { reads: 0, cancelled: [] as unknown[], textCalls: 0, readerCalls: 0 };
  const fetch: AiFetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    const queue = [...chunks];
    const response: AiFetchResponse = {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        stats.textCalls += 1;
        const decoder = new TextDecoder();
        return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
      },
    };
    if (options.withBody !== false) {
      response.body = {
        getReader(): AiByteReader {
          stats.readerCalls += 1;
          return {
            async read() {
              stats.reads += 1;
              if (options.failAt !== undefined && stats.reads === options.failAt) throw new Error('连接断开');
              const value = queue.shift();
              return value === undefined ? { done: true } : { done: false, value };
            },
            async cancel(reason) {
              stats.cancelled.push(reason);
            },
          };
        },
      };
    }
    return response;
  };
  return { fetch, bodies, stats };
}

// ---- 累加器 ----

test('core 入口导出流式累加器', () => {
  assert.equal(core.ChatStreamAccumulator, ChatStreamAccumulator);
});

test('累加器：逐段合并文字，每段回调目前为止的全文，[DONE] 后收尾', () => {
  const texts: string[] = [];
  const acc = new ChatStreamAccumulator((text) => texts.push(text));
  acc.push(textDelta('你好'));
  acc.push(textDelta('，'));
  acc.push(sse({ choices: [{ index: 0, delta: { role: 'assistant' } }] }));
  acc.push(textDelta('同学'));
  acc.push(sse('[DONE]'));
  assert.deepEqual(texts, ['你好', '你好，', '你好，同学']);
  assert.deepEqual(acc.finish(), { content: '你好，同学', toolCalls: [] });
});

test('累加器：一行被切在任意位置也能拼回，CRLF、注释行与 event 行忽略', () => {
  const body = `: keep-alive\r\nevent: message\r\n${textDelta('第一').replace(/\n/g, '\r\n')}${textDelta('第二')}${sse('[DONE]')}`;
  for (const size of [1, 2, 3, 7, 50]) {
    const texts: string[] = [];
    const acc = new ChatStreamAccumulator((text) => texts.push(text));
    for (let offset = 0; offset < body.length; offset += size) acc.push(body.slice(offset, offset + size));
    assert.deepEqual(acc.finish(), { content: '第一第二', toolCalls: [] }, `每段 ${size} 字`);
    assert.deepEqual(texts, ['第一', '第一第二'], `每段 ${size} 字`);
  }
});

test('累加器：最后一行没有换行时 finish 补上', () => {
  const acc = new ChatStreamAccumulator();
  acc.push(textDelta('前'));
  acc.push(`data: ${JSON.stringify({ choices: [{ delta: { content: '后' } }] })}`);
  assert.deepEqual(acc.finish(), { content: '前后', toolCalls: [] });
});

test('累加器：函数调用按 index 合并，名字与参数分段拼接，缺 id 补序号，没有名字的丢弃', () => {
  const acc = new ChatStreamAccumulator();
  acc.push(toolDelta([{ index: 0, id: 'call_a', type: 'function', function: { name: 'list_', arguments: '' } }]));
  acc.push(toolDelta([{ index: 1, type: 'function', function: { name: 'get_lessons', arguments: '{"da' } }]));
  acc.push(toolDelta([{ index: 0, function: { name: 'courses', arguments: '{"keyword"' } }]));
  acc.push(toolDelta([{ index: 1, function: { arguments: 'te":"2026-11-26"}' } }]));
  acc.push(toolDelta([{ index: 0, function: { arguments: ':"数"}' } }]));
  acc.push(toolDelta([{ index: 2, function: { arguments: '{}' } }]));
  acc.push(sse('[DONE]'));
  assert.deepEqual(acc.finish(), {
    content: '',
    toolCalls: [
      { id: 'call_a', name: 'list_courses', arguments: '{"keyword":"数"}' },
      { id: 'call_1', name: 'get_lessons', arguments: '{"date":"2026-11-26"}' },
    ],
  });
});

test('累加器：函数调用缺 index 时按在数组里的位置', () => {
  const acc = new ChatStreamAccumulator();
  acc.push(toolDelta([{ id: 'x', function: { name: 'a', arguments: '{}' } }, { id: 'y', function: { name: 'b', arguments: '{}' } }]));
  assert.deepEqual(
    acc.finish().toolCalls.map((call) => [call.id, call.name]),
    [['x', 'a'], ['y', 'b']],
  );
});

test('累加器：文字与函数调用可以同时出现', () => {
  const acc = new ChatStreamAccumulator();
  acc.push(textDelta('我查一下'));
  acc.push(toolDelta([{ index: 0, id: 'c1', function: { name: 'list_courses', arguments: '{}' } }]));
  assert.deepEqual(acc.finish(), { content: '我查一下', toolCalls: [{ id: 'c1', name: 'list_courses', arguments: '{}' }] });
});

test('累加器：error 事件抛出可读错误，带服务给的说明', () => {
  const acc = new ChatStreamAccumulator();
  acc.push(textDelta('半'));
  assert.throws(() => acc.push(sse({ error: { message: 'rate limited' } })), /AI 服务中途报错：rate limited/);
  assert.throws(() => new ChatStreamAccumulator().push(sse({ error: '服务过载' })), /AI 服务中途报错：服务过载/);
  assert.throws(() => new ChatStreamAccumulator().push(sse({ error: {} })), (error: Error) => error.message === 'AI 服务中途报错');
});

test('累加器：坏 JSON 的事件跳过，只有 [DONE] 时报没有内容', () => {
  const acc = new ChatStreamAccumulator();
  acc.push('data: {坏的\n\n');
  acc.push(textDelta('好'));
  assert.deepEqual(acc.finish(), { content: '好', toolCalls: [] });

  const empty = new ChatStreamAccumulator();
  empty.push(sse('[DONE]'));
  assert.throws(() => empty.finish(), /没有返回内容/);

  const blank = new ChatStreamAccumulator();
  blank.push(textDelta('  '));
  assert.throws(() => blank.finish(), /没有返回内容/);
});

test('累加器：一个 data 事件都没有时整段按普通响应解析，并回调一次全文', () => {
  const texts: string[] = [];
  const acc = new ChatStreamAccumulator((text) => texts.push(text));
  const body = JSON.stringify({
    choices: [{ message: { role: 'assistant', content: '整段回复', tool_calls: [{ id: 't', type: 'function', function: { name: 'f', arguments: '{}' } }] } }],
  });
  acc.push(body.slice(0, 10));
  acc.push(body.slice(10));
  assert.equal(acc.sawEvent, false);
  assert.deepEqual(acc.finish(), { content: '整段回复', toolCalls: [{ id: 't', name: 'f', arguments: '{}' }] });
  assert.deepEqual(texts, ['整段回复']);

  const toolsOnly = new ChatStreamAccumulator((text) => texts.push(`!${text}`));
  toolsOnly.push(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 't', function: { name: 'f', arguments: '{}' } }] } }] }));
  assert.equal(toolsOnly.finish().toolCalls.length, 1);
  assert.deepEqual(texts, ['整段回复'], '没有文字时不回调');

  assert.throws(() => {
    const broken = new ChatStreamAccumulator();
    broken.push('<html>bad gateway</html>');
    broken.finish();
  });
});

// ---- 客户端流式 chat ----

const STREAM_BODY =
  textDelta('第') +
  textDelta('一周有「高等数学」') +
  toolDelta([{ index: 0, id: 'c1', function: { name: 'list_courses', arguments: '{"keyword":' } }]) +
  toolDelta([{ index: 0, function: { arguments: '"数学"}' } }]) +
  sse('[DONE]');

test('客户端 chat：给出 onText 时请求带 stream: true，逐块读响应体，多字节字符切在块中间也不乱码', async () => {
  for (const size of [1, 2, 5, 64]) {
    const { fetch, bodies, stats } = streamFetch(byteChunks(STREAM_BODY, size));
    const client = createOpenAiCompatibleClient(CONFIG, fetch);
    const texts: string[] = [];
    const reply = await client.chat!({ messages: [{ role: 'user', content: '课' }], tools: TOOLS, onText: (text) => texts.push(text) });
    assert.deepEqual(reply, {
      content: '第一周有「高等数学」',
      toolCalls: [{ id: 'c1', name: 'list_courses', arguments: '{"keyword":"数学"}' }],
    });
    assert.equal(bodies[0]!['stream'], true);
    assert.ok(Array.isArray(bodies[0]!['tools']));
    assert.equal(texts.at(-1), '第一周有「高等数学」');
    assert.ok(texts.every((text) => !text.includes('�')), `每块 ${size} 字节时出现乱码：${texts.join('|')}`);
    assert.equal(stats.textCalls, 0, '有响应体流时不读 text()');
    assert.equal(stats.readerCalls, 1);
  }
});

test('客户端 chat：不给 onText 时不带 stream 字段，按整段响应解析', async () => {
  const body = JSON.stringify({ choices: [{ message: { role: 'assistant', content: '好' } }] });
  const { fetch, bodies, stats } = streamFetch([new TextEncoder().encode(body)]);
  const client = createOpenAiCompatibleClient(CONFIG, fetch);
  assert.deepEqual(await client.chat!({ messages: [{ role: 'user', content: '嗨' }], tools: [] }), { content: '好', toolCalls: [] });
  assert.equal('stream' in bodies[0]!, false);
  assert.equal(stats.readerCalls, 0);
  assert.equal(stats.textCalls, 1);
});

test('客户端 chat：响应没有 body 流时整段读 text() 再按 SSE 解析', async () => {
  const { fetch, stats } = streamFetch(byteChunks(STREAM_BODY, 3), { withBody: false });
  const client = createOpenAiCompatibleClient(CONFIG, fetch);
  const texts: string[] = [];
  const reply = await client.chat!({ messages: [{ role: 'user', content: '课' }], tools: TOOLS, onText: (text) => texts.push(text) });
  assert.equal(reply.content, '第一周有「高等数学」');
  assert.equal(reply.toolCalls.length, 1);
  assert.deepEqual(texts, ['第', '第一周有「高等数学」']);
  assert.equal(stats.textCalls, 1);
});

test('客户端 chat：body 为 null 时也走 text()', async () => {
  const fetch: AiFetch = async () => ({ ok: true, status: 200, body: null, text: async () => textDelta('好') });
  const client = createOpenAiCompatibleClient(CONFIG, fetch);
  assert.deepEqual(await client.chat!({ messages: [], tools: [], onText: () => undefined }), { content: '好', toolCalls: [] });
});

test('客户端 chat：服务不按流式返回时退回整段解析', async () => {
  const body = JSON.stringify({ choices: [{ message: { role: 'assistant', content: '整段的回复' } }] });
  const { fetch } = streamFetch(byteChunks(body, 4));
  const client = createOpenAiCompatibleClient(CONFIG, fetch);
  const texts: string[] = [];
  const reply = await client.chat!({ messages: [], tools: [], onText: (text) => texts.push(text) });
  assert.deepEqual(reply, { content: '整段的回复', toolCalls: [] });
  assert.deepEqual(texts, ['整段的回复']);
});

test('客户端 chat：流中途收到 error 事件时抛错并取消读取', async () => {
  const body = textDelta('半句') + sse({ error: { message: 'upstream timeout' } }) + textDelta('不该读到');
  const { fetch, stats } = streamFetch([new TextEncoder().encode(body)]);
  const client = createOpenAiCompatibleClient(CONFIG, fetch);
  const texts: string[] = [];
  await assert.rejects(
    client.chat!({ messages: [], tools: [], onText: (text) => texts.push(text) }),
    /AI 服务中途报错：upstream timeout/,
  );
  assert.deepEqual(texts, ['半句']);
  assert.equal(stats.cancelled.length, 1);
});

test('客户端 chat：读取中途断开时原样抛出并取消读取', async () => {
  const { fetch, stats } = streamFetch(byteChunks(STREAM_BODY, 8), { failAt: 3 });
  const client = createOpenAiCompatibleClient(CONFIG, fetch);
  await assert.rejects(client.chat!({ messages: [], tools: TOOLS, onText: () => undefined }), /连接断开/);
  assert.equal(stats.cancelled.length, 1);
});

test('客户端 chat：流式请求的 HTTP 错误照常映射，不读响应体流', async () => {
  const unsupported = streamFetch([new TextEncoder().encode('{"error":{"message":"tools is not supported"}}')], { status: 400 });
  const client = createOpenAiCompatibleClient(CONFIG, unsupported.fetch);
  await assert.rejects(client.chat!({ messages: [], tools: TOOLS, onText: () => undefined }), AiToolsUnsupportedError);
  assert.equal(unsupported.stats.readerCalls, 0);

  const auth = streamFetch([new TextEncoder().encode('{"error":{"message":"bad key"}}')], { status: 401 });
  const authClient = createOpenAiCompatibleClient(CONFIG, auth.fetch);
  await assert.rejects(
    authClient.chat!({ messages: [], tools: TOOLS, onText: () => undefined }),
    (error: Error) => !(error instanceof AiToolsUnsupportedError) && error.message.length > 0,
  );

  const long = streamFetch([new TextEncoder().encode('{"error":{"message":"context_length exceeded; functions too long"}}')], {
    status: 400,
  });
  await assert.rejects(
    createOpenAiCompatibleClient(CONFIG, long.fetch).chat!({ messages: [], tools: TOOLS, onText: () => undefined }),
    (error: Error) => !(error instanceof AiToolsUnsupportedError),
  );
});
