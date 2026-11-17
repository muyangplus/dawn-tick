import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_AUTO_INTERVAL_MS,
  LAN_AUTO_MODE_LABEL,
  LAN_AUTO_STORAGE_KEY,
  defaultAutoConfig,
  formatAutoScopes,
  nextAutoDelay,
  parseAutoConfig,
  runAutoWithRetry,
  serializeAutoConfig,
  shouldAutoSync,
} from '../src/lan-sync-auto.ts';

const NOW = 1759900000000;

test('自动同步配置：默认关闭，损坏 JSON 回退默认，范围与上次时间可往返', () => {
  assert.deepEqual(defaultAutoConfig(), { mode: 'off', scopes: ['timetable', 'todos', 'settings'], lastRunAt: null });
  assert.deepEqual(parseAutoConfig(null), defaultAutoConfig());
  assert.deepEqual(parseAutoConfig('not json'), defaultAutoConfig());
  assert.deepEqual(parseAutoConfig(JSON.stringify({ mode: 'everyday' })), defaultAutoConfig());

  const config = parseAutoConfig(
    JSON.stringify({ mode: 'interval30', scopes: ['settings', 'todos'], lastRunAt: NOW }),
  );
  assert.deepEqual(config, { mode: 'interval30', scopes: ['todos', 'settings'], lastRunAt: NOW });
  assert.equal(serializeAutoConfig(config), JSON.stringify({ mode: 'interval30', scopes: ['todos', 'settings'], lastRunAt: NOW }));
  assert.equal(LAN_AUTO_MODE_LABEL.interval30, '每 30 分钟');
  assert.equal(formatAutoScopes(config), 'todos,settings');
  assert.ok(LAN_AUTO_STORAGE_KEY.startsWith('dt.lan.'));
});

test('定时策略：每次启动只跑一次，每 30 分钟按上次运行时间判断', () => {
  const launchAt = NOW;
  assert.equal(
    shouldAutoSync({ mode: 'off', scopes: ['todos'], lastRunAt: null }, NOW, launchAt),
    false,
  );
  assert.equal(
    shouldAutoSync({ mode: 'startup', scopes: [], lastRunAt: null }, NOW, launchAt),
    false,
    '没有勾选范围不跑',
  );
  assert.equal(
    shouldAutoSync({ mode: 'startup', scopes: ['todos'], lastRunAt: null }, NOW, launchAt),
    true,
  );
  assert.equal(
    shouldAutoSync({ mode: 'startup', scopes: ['todos'], lastRunAt: NOW + 1000 }, NOW, launchAt),
    false,
    '本次启动已跑过',
  );
  assert.equal(
    shouldAutoSync({ mode: 'startup', scopes: ['todos'], lastRunAt: NOW - 1000 }, NOW, NOW + 5000),
    true,
    '下一次启动（launchAt 更新）再跑一次',
  );

  const interval = { mode: 'interval30' as const, scopes: ['todos' as const], lastRunAt: NOW };
  assert.equal(shouldAutoSync(interval, NOW + LAN_AUTO_INTERVAL_MS - 1, NOW), false);
  assert.equal(shouldAutoSync(interval, NOW + LAN_AUTO_INTERVAL_MS, NOW), true);
  assert.equal(shouldAutoSync({ ...interval, lastRunAt: null }, NOW, NOW), true);
  assert.equal(nextAutoDelay(interval, NOW), LAN_AUTO_INTERVAL_MS);
  assert.equal(nextAutoDelay(interval, NOW + LAN_AUTO_INTERVAL_MS - 1000), 1000);
  assert.equal(nextAutoDelay({ ...interval, lastRunAt: null }, NOW), 0);
});

test('失败静默重试一次：第一次失败后重试，成功只跑两次；两次都失败返回错误', async () => {
  let attempts = 0;
  const retried = await runAutoWithRetry(
    async () => {
      attempts += 1;
      return { ok: attempts === 2, imported: attempts === 2 ? 3 : 0 };
    },
    (value) => value.ok,
    0,
  );
  assert.deepEqual(retried, {
    ok: true,
    value: { ok: true, imported: 3 },
    attempts: 2,
    error: null,
  });

  let failedAttempts = 0;
  const failed = await runAutoWithRetry(
    async () => {
      failedAttempts += 1;
      throw new Error('网络断开');
    },
    () => true,
    0,
  );
  assert.equal(failedAttempts, 2);
  assert.equal(failed.ok, false);
  assert.equal(failed.attempts, 2);
  assert.equal(failed.error, '网络断开');

  let once = 0;
  const firstTry = await runAutoWithRetry(
    async () => {
      once += 1;
      return { ok: true };
    },
    (value) => value.ok,
    0,
  );
  assert.equal(once, 1);
  assert.equal(firstTry.attempts, 1);
});
