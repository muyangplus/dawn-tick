import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLogSettings,
  debugEnabled,
  defaultLogLevel,
  LOG_LEVELS,
  logDebug,
  logEntries,
  logError,
  logInfo,
  logLevel,
  logTrace,
  logWarn,
  type LogLevel,
} from '../src/log.ts';
import { LOG_SCOPE_NAMES, LOG_SCOPES } from '../src/lib/log-scopes.ts';

/** 本文件会改模块级门槛：单独成文件，`node --test` 按文件分进程，不影响 log.test.ts 的默认 trace。 */

const WRITERS: Record<LogLevel, (message: string) => void> = {
  error: (message) => logError('log', message),
  warn: (message) => logWarn('log', message),
  info: (message) => logInfo('log', message),
  debug: (message) => logDebug('log', message),
  trace: (message) => logTrace('log', message),
};

/** 在给定门槛下每级各写一条，返回实际进缓冲的级别。 */
function levelsKeptAt(threshold: LogLevel): LogLevel[] {
  applyLogSettings({ level: threshold, fileEnabled: false });
  const before = new Set(logEntries());
  for (const level of LOG_LEVELS) WRITERS[level](`门槛 ${threshold} 下的 ${level}`);
  return logEntries()
    .filter((entry) => !before.has(entry))
    .map((entry) => entry.level);
}

test('defaultLogLevel：dev 渠道为 trace，其余渠道为 info', () => {
  assert.equal(defaultLogLevel('dev'), 'trace');
  assert.equal(defaultLogLevel('beta'), 'info');
  assert.equal(defaultLogLevel('release'), 'info');
  assert.equal(defaultLogLevel(''), 'info');
  assert.equal(defaultLogLevel('DEV'), 'info', '渠道名区分大小写');
});

test('未注入渠道时按 dev 处理：默认门槛 trace', () => {
  // 本文件第一处改门槛之前读：测试进程没有 __DT_CHANNEL__
  assert.equal(logLevel(), 'trace');
  assert.equal(debugEnabled(), true);
});

test('级别次序固定为 error < warn < info < debug < trace', () => {
  assert.deepEqual([...LOG_LEVELS], ['error', 'warn', 'info', 'debug', 'trace']);
});

test('每个门槛只放行同级及更严重的条目', () => {
  assert.deepEqual(levelsKeptAt('error'), ['error']);
  assert.deepEqual(levelsKeptAt('warn'), ['error', 'warn']);
  assert.deepEqual(levelsKeptAt('info'), ['error', 'warn', 'info']);
  assert.deepEqual(levelsKeptAt('debug'), ['error', 'warn', 'info', 'debug']);
  assert.deepEqual(levelsKeptAt('trace'), ['error', 'warn', 'info', 'debug', 'trace']);
});

test('info 门槛下 trace 与 debug 不进缓冲，debugEnabled 为 false', () => {
  applyLogSettings({ level: 'info', fileEnabled: true });
  assert.equal(logLevel(), 'info');
  assert.equal(debugEnabled(), false);
  const before = logEntries().length;
  logTrace('app', '高频细节');
  logDebug('app', '中间状态');
  assert.equal(logEntries().length, before);
  logInfo('app', '关键节点');
  assert.equal(logEntries().length, before + 1);
  assert.equal(logEntries().at(-1)?.level, 'info');
});

test('fileEnabled 关闭不影响内存缓冲', () => {
  applyLogSettings({ level: 'warn', fileEnabled: false });
  const before = new Set(logEntries());
  logWarn('app', '仍然记录');
  assert.deepEqual(
    logEntries()
      .filter((entry) => !before.has(entry))
      .map((entry) => entry.message),
    ['仍然记录'],
  );
});

test('范围清单：16 个，名字为小写单词且不重复', () => {
  assert.equal(LOG_SCOPE_NAMES.length, 16);
  assert.deepEqual(LOG_SCOPE_NAMES, Object.keys(LOG_SCOPES));
  assert.equal(new Set(LOG_SCOPE_NAMES).size, LOG_SCOPE_NAMES.length);
  for (const name of LOG_SCOPE_NAMES) {
    assert.match(name, /^[a-z]+$/);
    assert.ok(LOG_SCOPES[name].length > 0, `${name} 缺少说明`);
  }
});

/** 等后台 IIFE 跑完：applyLogSettings 不返回 Promise。 */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('Android：applyLogSettings 把级别交给 SystemActions.setNativeLogLevel', async (t) => {
  // 走真实的 @capacitor/core：androidBridge 让平台判定为 android，PluginHeaders 声明原生方法，
  // nativePromise 是原生桥的出口，在这里截获调用
  const calls: Array<{ plugin: string; method: string; options: unknown }> = [];
  const scope = globalThis as Record<string, unknown>;
  const previous = { androidBridge: scope['androidBridge'], Capacitor: scope['Capacitor'] };
  scope['androidBridge'] = {};
  scope['Capacitor'] = {
    isNativePlatform: () => true,
    PluginHeaders: [{ name: 'SystemActions', methods: [{ name: 'setNativeLogLevel', rtype: 'promise' }] }],
    nativePromise: async (plugin: string, method: string, options: unknown) => {
      calls.push({ plugin, method, options });
    },
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete scope[key];
      else scope[key] = value;
    }
  });

  applyLogSettings({ level: 'debug', fileEnabled: true });
  await waitFor(() => calls.length > 0);
  assert.deepEqual(calls, [{ plugin: 'SystemActions', method: 'setNativeLogLevel', options: { level: 'debug' } }]);
  assert.equal(logLevel(), 'debug');
});

test('桌面：applyLogSettings 调 set_log_settings，带级别与写文件开关', async (t) => {
  // @tauri-apps/api 的 invoke 经 window.__TAURI_INTERNALS__.invoke 出口，在这里截获
  const calls: Array<{ command: string; args: unknown }> = [];
  const scope = globalThis as Record<string, unknown>;
  const previous = { window: scope['window'], __TAURI_INTERNALS__: scope['__TAURI_INTERNALS__'] };
  scope['window'] = globalThis;
  scope['__TAURI_INTERNALS__'] = {
    invoke: async (command: string, args: unknown) => {
      calls.push({ command, args });
    },
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete scope[key];
      else scope[key] = value;
    }
  });

  applyLogSettings({ level: 'warn', fileEnabled: false });
  await waitFor(() => calls.some((call) => call.command === 'set_log_settings'));
  assert.deepEqual(
    calls.filter((call) => call.command === 'set_log_settings'),
    [{ command: 'set_log_settings', args: { level: 'warn', fileEnabled: false } }],
  );
});
