import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '@dawn-tick/core';
import {
  attachLogStorage,
  debugEnabled,
  flushLogsNow,
  formatLogTimestamp,
  loadLogs,
  logDebug,
  logEntries,
  logError,
  logInfo,
  logsText,
} from '../src/log.ts';

const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}$/;

test('日志时间戳带本地时间与偏移', () => {
  const at = Date.UTC(2026, 9, 13, 10, 1, 34, 123);
  const text = formatLogTimestamp(at);
  assert.match(text, STAMP_RE);
  // 本地时间减去偏移应还原为同一时刻：与运行时区无关
  const [, y, mo, d, h, mi, s, ms, sign, oh, om] = text.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) ([+-])(\d{2}):(\d{2})$/,
  )!.map(String);
  const offset = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const local = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms));
  assert.equal(local - offset * 60_000, at);
});

test('开发渠道记录全部等级且每行都带时间', () => {
  assert.equal(debugEnabled(), true);
  const before = new Set(logEntries());
  logDebug('app', '探针调试', { step: 1 });
  logInfo('app', '探针信息');
  logError('app', '探针错误');
  const added = logEntries().filter((entry) => !before.has(entry));
  assert.deepEqual(
    added.map((entry) => [entry.level, entry.scope]),
    [
      ['debug', 'app'],
      ['info', 'app'],
      ['error', 'app'],
    ],
  );
  const lines = logsText()
    .split('\n')
    .filter((line) => line.includes('app: 探针'));
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line.split(' [')[0] ?? '', STAMP_RE);
    assert.match(line, /\[(debug|info|error)\] app: 探针/);
  }
});

test('日志写入本地存储后可重新读回', async () => {
  const storage = new MemoryStorage();
  attachLogStorage(storage);
  logInfo('log', '写入一条');
  await flushLogsNow();
  const stored = await storage.readMeta('app_log');
  assert.ok(stored !== null && stored !== undefined && stored.includes('写入一条'));
  await loadLogs();
  assert.ok(logEntries().some((entry) => entry.scope === 'log' && entry.message === '写入一条'));
});
