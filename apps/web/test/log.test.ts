import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '@dawn-tick/core';
import {
  attachLogStorage,
  debugEnabled,
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
  const text = formatLogTimestamp(Date.UTC(2026, 9, 13, 10, 1, 34, 123));
  assert.match(text, STAMP_RE);
  assert.match(text, /^2026-10-13 \d{2}:01:34\.123 [+-]\d{2}:\d{2}$/);
});

test('开发渠道记录全部等级且每行都带时间', () => {
  assert.equal(debugEnabled(), true);
  logDebug('probe', '调试', { step: 1 });
  logInfo('probe', '信息');
  logError('probe', '错误');
  const entries = logEntries();
  const levels = entries.filter((entry) => entry.scope === 'probe').map((entry) => entry.level);
  assert.deepEqual(levels, ['debug', 'info', 'error']);
  const lines = logsText()
    .split('\n')
    .filter((line) => line.includes('probe:'));
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line.split(' [')[0] ?? '', STAMP_RE);
    assert.match(line, /\[(debug|info|error)\] probe:/);
  }
});

test('日志写入本地存储后可重新读回', async () => {
  const storage = new MemoryStorage();
  attachLogStorage(storage);
  logInfo('persist', '写入一条');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const stored = await storage.readMeta('app_log');
  assert.ok(stored !== null && stored !== undefined && stored.includes('写入一条'));
  await loadLogs();
  assert.ok(logEntries().some((entry) => entry.scope === 'persist'));
});
