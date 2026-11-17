import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPendingRestart,
  pendingRestartSources,
  registerPendingRestart,
  subscribePendingRestart,
} from '../src/pending-restart.ts';

test('待重启按来源去重计数，重启后清空', () => {
  clearPendingRestart();
  let notified = 0;
  const unsubscribe = subscribePendingRestart(() => {
    notified += 1;
  });
  registerPendingRestart('wal');
  registerPendingRestart('wal');
  registerPendingRestart('storage-path');
  assert.deepEqual(pendingRestartSources(), ['wal', 'storage-path']);
  assert.equal(notified, 2);
  clearPendingRestart();
  assert.equal(pendingRestartSources().length, 0);
  assert.equal(notified, 3);
  // 清空后再登记同一来源仍然生效
  registerPendingRestart('wal');
  assert.deepEqual(pendingRestartSources(), ['wal']);
  clearPendingRestart();
  unsubscribe();
});
