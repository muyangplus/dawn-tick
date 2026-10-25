import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_SERVER_START_ERROR_PREFIX,
  LAN_SERVER_START_TIMEOUT_MESSAGE,
  LAN_SERVER_START_TIMEOUT_MS,
  setLanServerStarterForTests,
  startLanServer,
  startLanServerError,
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

test('生产超时是 8 秒，失败文案带统一前缀', () => {
  assert.equal(LAN_SERVER_START_TIMEOUT_MS, 8_000);
  assert.equal(LAN_SERVER_START_ERROR_PREFIX, '开启配对失败：');
  assert.equal(
    LAN_SERVER_START_TIMEOUT_MESSAGE,
    '原生监听在 8 秒内没有响应，请确认已连接 Wi-Fi 后重试',
  );
  assert.equal(
    startLanServerError(LAN_SERVER_START_TIMEOUT_MESSAGE),
    '开启配对失败：原生监听在 8 秒内没有响应，请确认已连接 Wi-Fi 后重试',
  );
  assert.equal(startLanServerError('开启配对失败：原因'), '开启配对失败：原因');
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
    assert.equal(first.error, `开启配对失败：${LAN_SERVER_START_TIMEOUT_MESSAGE}`);
    assert.match(first.error ?? '', /开启配对失败：/);
    const second = await startLanServer({ host: '192.168.1.23', now: NOW, timeoutMs: 20 });
    assert.equal(second.ok, true);
    assert.equal(second.info?.address, '192.168.1.23:8765');
  } finally {
    setLanServerStarterForTests(null);
    restorePlatform();
  }
});

test('原生失败：原始异常 message 透传并加上「开启配对失败：」前缀', async () => {
  const restorePlatform = installTauriPlatform();
  setLanServerStarterForTests(async () => {
    throw new Error('监听端口失败：Address already in use');
  });
  try {
    const result = await startLanServer({ host: '192.168.1.23', now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.error, '开启配对失败：监听端口失败：Address already in use');
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
