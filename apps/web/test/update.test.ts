import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPDATE_FEEDS,
  checkForUpdate,
  compareVersions,
  defaultReceiveBeta,
  resolveFeed,
  resolveReceiveBeta,
} from '../src/update.ts';

function manifestResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

test('版本比较遵循语义化规则', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-beta.1') > 0, '正式版高于同号预发布版');
  assert.ok(compareVersions('1.0.0-beta.2', '1.0.0-beta.1') > 0);
  assert.ok(compareVersions('1.0.0-beta.10', '1.0.0-beta.9') > 0, '预发布序号按数值比较');
  assert.ok(compareVersions('v0.1.1', '0.1.0') > 0, '允许 v 前缀');
});

test('dev 渠道永远只查 dev 源', () => {
  assert.equal(resolveFeed('dev', true), 'dev');
  assert.equal(resolveFeed('dev', false), 'dev');
  assert.equal(defaultReceiveBeta('dev'), false);
});

test('release 与 beta 按开关决定源，beta 默认开', () => {
  assert.equal(resolveFeed('release', false), 'release');
  assert.equal(resolveFeed('release', true), 'beta');
  assert.equal(resolveFeed('beta', true), 'beta');
  assert.equal(resolveFeed('beta', false), 'release');
  assert.equal(defaultReceiveBeta('beta'), true);
  assert.equal(defaultReceiveBeta('release'), false);
  assert.equal(resolveReceiveBeta(null, 'beta'), true);
  assert.equal(resolveReceiveBeta(null, 'release'), false);
  assert.equal(resolveReceiveBeta(false, 'beta'), false, '显式关闭优先于默认值');
});

test('发现新版本时返回清单与下载信息', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () =>
      manifestResponse({
        channel: 'release',
        version: '0.2.0',
        notes: '修复若干问题',
        assets: { windows: { url: 'https://example.com/a.zip', signature: 'sig' } },
      }),
  });
  assert.equal(status.feed, 'release');
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.manifest?.assets?.windows?.url, 'https://example.com/a.zip');
  assert.equal(status.error, null);
});

test('同版本或更旧版本不算更新', async () => {
  const same = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.2.0',
    fetchImpl: async () => manifestResponse({ channel: 'release', version: '0.2.0' }),
  });
  assert.equal(same.available, false);

  const older = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.3.0',
    fetchImpl: async () => manifestResponse({ channel: 'release', version: '0.2.0' }),
  });
  assert.equal(older.available, false, '不允许降级');
});

test('渠道不一致的清单被忽略', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse({ channel: 'dev', version: '9.9.9' }),
  });
  assert.equal(status.available, false);
  assert.match(String(status.error), /渠道/);
});

test('打开接收测试版后 release 用户能看到 beta 版', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: true,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse({ channel: 'beta', version: '0.2.0-beta.1' }),
  });
  assert.equal(status.feed, 'beta');
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.2.0-beta.1');
});

test('网络与格式异常都有可读原因', async () => {
  const failure = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(failure.available, false);
  assert.match(String(failure.error), /offline/);

  const badShape = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse({ version: 123 }),
  });
  assert.match(String(badShape.error), /格式/);

  const httpError = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse({}, false, 404),
  });
  assert.match(String(httpError.error), /404/);
});

test('各渠道更新源各自独立', () => {
  assert.match(UPDATE_FEEDS.dev, /dev-latest/);
  assert.match(UPDATE_FEEDS.beta, /beta-latest/);
  assert.match(UPDATE_FEEDS.release, /releases\/latest\/download/);
  assert.equal(new Set(Object.values(UPDATE_FEEDS)).size, 3);
});
