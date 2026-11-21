import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithSignal } from '../src/lib/abortable-fetch.ts';

interface Call {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

function recordingFetch(): { base: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response('ok');
  }) as typeof fetch;
  return { base, calls };
}

test('fetchWithSignal：请求没带 signal 时用取消信号，其余参数原样透传', async () => {
  const { base, calls } = recordingFetch();
  const controller = new AbortController();
  const wrapped = fetchWithSignal(base, controller.signal);

  const response = await wrapped('https://example.test/a', { method: 'POST', headers: { 'x-a': '1' }, body: 'b' });
  assert.equal(await response.text(), 'ok', '返回值原样透出');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, 'https://example.test/a');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.deepEqual(calls[0]?.init?.headers, { 'x-a': '1' });
  assert.equal(calls[0]?.init?.body, 'b');
  assert.equal(calls[0]?.init?.signal, controller.signal);
});

test('fetchWithSignal：不传 init 也带上取消信号', async () => {
  const { base, calls } = recordingFetch();
  const controller = new AbortController();
  const url = new URL('https://example.test/b');
  await fetchWithSignal(base, controller.signal)(url);
  assert.equal(calls[0]?.input, url);
  assert.equal(calls[0]?.init?.signal, controller.signal);
});

test('fetchWithSignal：请求自带 signal 时两个都生效（取消信号中止）', async () => {
  const { base, calls } = recordingFetch();
  const cancel = new AbortController();
  const own = new AbortController();
  await fetchWithSignal(base, cancel.signal)('https://example.test/c', { signal: own.signal });
  const merged = calls[0]?.init?.signal;
  assert.ok(merged instanceof AbortSignal);
  assert.notEqual(merged, cancel.signal);
  assert.notEqual(merged, own.signal);
  assert.equal(merged.aborted, false);
  cancel.abort();
  assert.equal(merged.aborted, true, '用户取消也中止请求');
});

test('fetchWithSignal：请求自带 signal 时两个都生效（自带的超时中止）', async () => {
  const { base, calls } = recordingFetch();
  const cancel = new AbortController();
  const own = new AbortController();
  await fetchWithSignal(base, cancel.signal)('https://example.test/d', { signal: own.signal });
  const merged = calls[0]?.init?.signal;
  assert.ok(merged instanceof AbortSignal);
  own.abort(new Error('timeout'));
  assert.equal(merged.aborted, true, '原有的超时信号仍然生效');
  assert.equal(cancel.signal.aborted, false, '不反向中止取消信号');
});

test('fetchWithSignal：init.signal 为 null 视同没带', async () => {
  const { base, calls } = recordingFetch();
  const cancel = new AbortController();
  await fetchWithSignal(base, cancel.signal)('https://example.test/e', { signal: null });
  assert.equal(calls[0]?.init?.signal, cancel.signal);
});

test('fetchWithSignal：没有 AbortSignal.any 的老 WebView 只用取消信号', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
  try {
    const { base, calls } = recordingFetch();
    const cancel = new AbortController();
    const own = new AbortController();
    await fetchWithSignal(base, cancel.signal)('https://example.test/f', { signal: own.signal });
    assert.equal(calls[0]?.init?.signal, cancel.signal);
  } finally {
    if (descriptor !== undefined) Object.defineProperty(AbortSignal, 'any', descriptor);
  }
});

test('fetchWithSignal：已中止的取消信号原样交给底层，由底层决定拒绝', async () => {
  const cancel = new AbortController();
  cancel.abort();
  let seen: AbortSignal | null | undefined;
  const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen = init?.signal;
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    return new Response('ok');
  }) as typeof fetch;
  await assert.rejects(fetchWithSignal(base, cancel.signal)('https://example.test/g'), { name: 'AbortError' });
  assert.equal(seen?.aborted, true);
});
