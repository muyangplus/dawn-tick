import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_SERVER_START_TIMEOUT_MESSAGE,
  LAN_SERVER_START_TIMEOUT_MS,
  setLanServerStarterForTests,
  startLanServer,
  withTimeout,
} from '../src/lan-sync.ts';

const NOW = 1759900000000;

function installTauriPlatform(): () => void {
  const scope = globalThis as { __TAURI_INTERNALS__?: unknown };
  const previous = scope.__TAURI_INTERNALS__;
  scope.__TAURI_INTERNALS__ = {};
  return () => {
    if (previous === undefined) delete scope.__TAURI_INTERNALS__;
    else scope.__TAURI_INTERNALS__ = previous;
  };
}

test('生产超时是 8 秒，文案可直接展示', () => {
  assert.equal(LAN_SERVER_START_TIMEOUT_MS, 8_000);
  assert.equal(LAN_SERVER_START_TIMEOUT_MESSAGE, '开启配对超时：请确认已连接 Wi-Fi 后重试');
});

test('withTimeout：按时返回或抛可读超时错误', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 50, '超时'), 'ok');
  await assert.rejects(withTimeout(new Promise(() => {}), 20, '自定义超时'), /自定义超时/);
  await assert.rejects(withTimeout(Promise.reject(new Error('原始错误')), 50, '超时'), /原始错误/);
});

test('startLanServer 把选中地址透传给原生并归一到 info', async () => {
  const restorePlatform = installTauriPlatform();
  let captured: string | undefined;
  setLanServerStarterForTests(async (host) => {
    captured = host;
    return { host: host ?? '192.168.1.23', port: 8765 };
  });
  try {
    const result = await startLanServer({ host: '10.0.0.8', now: NOW });
    assert.equal(captured, '10.0.0.8');
    assert.equal(result.ok, true);
    assert.equal(result.info?.host, '10.0.0.8');
    assert.equal(result.info?.port, 8765);
    assert.equal(result.info?.address, '10.0.0.8:8765');
    assert.match(result.info?.code ?? '', /^\d{6}$/);
    assert.equal(result.info?.expiresAt, NOW + 5 * 60_000);
  } finally {
    setLanServerStarterForTests(null);
    restorePlatform();
  }
});

test('自动选择（不传 host）时原生返回的地址就是界面地址', async () => {
  const restorePlatform = installTauriPlatform();
  let captured: string | undefined = 'unset';
  setLanServerStarterForTests(async (host) => {
    captured = host;
    return { host: '172.20.1.2', port: 9000 };
  });
  try {
    const result = await startLanServer({ now: NOW });
    assert.equal(captured, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.info?.host, '172.20.1.2');
  } finally {
    setLanServerStarterForTests(null);
    restorePlatform();
  }
});

test('start 超时：返回可读错误、不抛异常，且允许立即重试', async () => {
  const restorePlatform = installTauriPlatform();
  let attempts = 0;
  setLanServerStarterForTests(() => {
    attempts += 1;
    // 第一次模拟原生卡住不回调；第二次立即成功
    return attempts === 1
      ? new Promise(() => {})
      : Promise.resolve({ host: '192.168.1.23', port: 8765 });
  });
  try {
    const first = await startLanServer({ host: '192.168.1.23', now: NOW, timeoutMs: 20 });
    assert.equal(first.ok, false);
    assert.equal(first.info, null);
    assert.equal(first.error, LAN_SERVER_START_TIMEOUT_MESSAGE);
    const second = await startLanServer({ host: '192.168.1.23', now: NOW, timeoutMs: 20 });
    assert.equal(second.ok, true);
    assert.equal(second.info?.address, '192.168.1.23:8765');
  } finally {
    setLanServerStarterForTests(null);
    restorePlatform();
  }
});

test('浏览器端不开配对：直接给提示且不调原生', async () => {
  let called = false;
  setLanServerStarterForTests(async () => {
    called = true;
    return { host: '192.168.1.23', port: 8765 };
  });
  try {
    const result = await startLanServer({ now: NOW });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /浏览器端/);
    assert.equal(called, false);
  } finally {
    setLanServerStarterForTests(null);
  }
});
