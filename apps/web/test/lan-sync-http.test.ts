import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_HTTP_TIMEOUT_MS,
  lanFetch,
  setLanCapacitorHttpForTests,
  setLanHttpInvokerForTests,
  toLanNativeArgs,
} from '../src/lan-sync-http.ts';

const URL = 'http://192.168.1.5:8765/pair';

function installTauriPlatform(): () => void {
  const scope = globalThis as { __TAURI_INTERNALS__?: unknown };
  const previous = scope.__TAURI_INTERNALS__;
  scope.__TAURI_INTERNALS__ = {};
  return () => {
    if (previous === undefined) delete scope.__TAURI_INTERNALS__;
    else scope.__TAURI_INTERNALS__ = previous;
  };
}

function installCapacitorPlatform(): () => void {
  const scope = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  const previous = scope.Capacitor;
  scope.Capacitor = { isNativePlatform: () => true };
  return () => {
    if (previous === undefined) delete scope.Capacitor;
    else scope.Capacitor = previous;
  };
}

function stubFetch(implementation: typeof fetch): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = implementation;
  return () => {
    globalThis.fetch = previous;
  };
}

test('toLanNativeArgs：方法大写、头归一、正文只收字符串', () => {
  const args = toLanNativeArgs(URL, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
    body: '{"code":"123456"}',
  });
  assert.equal(args.method, 'POST');
  assert.equal(args.url, URL);
  assert.deepEqual(args.headers, {
    'content-type': 'application/json',
    authorization: 'Bearer abc',
  });
  assert.equal(args.body, '{"code":"123456"}');
  assert.equal(args.timeoutMs, LAN_HTTP_TIMEOUT_MS);

  const get = toLanNativeArgs(URL);
  assert.equal(get.method, 'GET');
  assert.deepEqual(get.headers, {});
  assert.equal('body' in get, false);
});

test('桌面 lanFetch 走 Rust lan_http_request（不加载 plugin-http）', async () => {
  const restorePlatform = installTauriPlatform();
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  setLanHttpInvokerForTests(async (command, args) => {
    calls.push({ command, args });
    return { status: 200, body: '{"token":"abc"}' };
  });
  try {
    const response = await lanFetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
      body: '{"code":"123456"}',
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"token":"abc"}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, 'lan_http_request');
    assert.deepEqual(calls[0]?.args, {
      method: 'POST',
      url: URL,
      headers: { 'content-type': 'application/json', authorization: 'Bearer abc' },
      body: '{"code":"123456"}',
      timeoutMs: LAN_HTTP_TIMEOUT_MS,
    });
  } finally {
    setLanHttpInvokerForTests(null);
    restorePlatform();
  }
});

test('桌面原生直连失败时回退 fetch 并保留原错误语义', async () => {
  const restorePlatform = installTauriPlatform();
  setLanHttpInvokerForTests(async () => {
    throw new Error('原生直连失败');
  });
  const restoreFetch = stubFetch(async () => new Response('fallback', { status: 503 }));
  try {
    const response = await lanFetch(URL);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'fallback');
  } finally {
    restoreFetch();
    setLanHttpInvokerForTests(null);
    restorePlatform();
  }
});

test('Android 走 CapacitorHttp，不落到 WebView fetch', async () => {
  const restorePlatform = installCapacitorPlatform();
  let captured: Record<string, unknown> | null = null;
  setLanCapacitorHttpForTests({
    request: async (options) => {
      captured = options as unknown as Record<string, unknown>;
      return { status: 200, data: { token: 'abc' } };
    },
  });
  const restoreFetch = stubFetch(async () => {
    throw new Error('不应回退到 WebView fetch');
  });
  try {
    const response = await lanFetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer abc' },
      body: '{"code":"123456"}',
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"token":"abc"}');
    assert.equal(captured?.['url'], URL);
    assert.equal(captured?.['method'], 'POST');
    assert.equal(captured?.['data'], '{"code":"123456"}');
    assert.deepEqual(captured?.['headers'], { authorization: 'Bearer abc' });
  } finally {
    restoreFetch();
    setLanCapacitorHttpForTests(null);
    restorePlatform();
  }
});

test('Android 原生 HTTP 失败时回退 fetch', async () => {
  const restorePlatform = installCapacitorPlatform();
  setLanCapacitorHttpForTests({
    request: async () => {
      throw new Error('CapacitorHttp 不可用');
    },
  });
  const restoreFetch = stubFetch(async () => new Response('android-fallback', { status: 200 }));
  try {
    const response = await lanFetch(URL);
    assert.equal(await response.text(), 'android-fallback');
  } finally {
    restoreFetch();
    setLanCapacitorHttpForTests(null);
    restorePlatform();
  }
});

test('纯浏览器直接走 fetch', async () => {
  const restoreFetch = stubFetch(async () => new Response('web', { status: 200 }));
  try {
    const response = await lanFetch(URL);
    assert.equal(await response.text(), 'web');
  } finally {
    restoreFetch();
  }
});
