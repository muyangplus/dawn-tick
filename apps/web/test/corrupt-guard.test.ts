import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, type Collection, type Storage } from '@dawn-tick/core';
import {
  CorruptWriteBlockedError,
  DATABASE_CORRUPT_MESSAGE,
  EXPORT_CORRUPT_MESSAGE,
  corruptReadOnlyStorage,
  guardStorage,
  isCorruptLocked,
  isCorruptWriteBlockedError,
  reportCorrupt,
  resetCorruptGuardForTests,
  subscribeCorrupt,
} from '../src/db/corrupt-guard.ts';
import { exportConfig } from '../src/data-management.ts';

/** SQLite/sqlx 的典型损坏文案。 */
function corruptError(): Error {
  return new Error('error returned from database: (code: 11) database disk image is malformed');
}

/** 让 `getAll` 抛指定错误的存储：模拟读到一半才发现损坏。 */
function failingStorage(message: string): Storage {
  const base = new MemoryStorage();
  return {
    ...base,
    collection: <T,>(name: Parameters<Storage['collection']>[0]): Collection<T> => ({
      ...base.collection<T>(name),
      getAll: async () => {
        throw new Error(message);
      },
    }),
  };
}

test('损坏错误首次触发一次，之后不再重复通知', () => {
  resetCorruptGuardForTests();
  const events: string[] = [];
  const off = subscribeCorrupt((event) => events.push(event.message));
  assert.equal(isCorruptLocked(), false);

  // 锁冲突/权限不是损坏：不锁定、不通知
  assert.equal(reportCorrupt(new Error('database is locked')), false);
  assert.equal(reportCorrupt(new Error('attempt to write a readonly database')), false);
  assert.equal(isCorruptLocked(), false);
  assert.equal(events.length, 0);

  assert.equal(reportCorrupt(corruptError()), true);
  assert.equal(isCorruptLocked(), true);
  assert.equal(events.length, 1, '首次损坏通知一次');

  // 同会话后续损坏（另一种文案）仍返回 true，但不再通知第二次
  assert.equal(reportCorrupt(new Error('(code: 26) file is not a database')), true);
  assert.equal(events.length, 1, '同一会话只触发一次');
  off();

  // 晚订阅的组件仍能拿到当前损坏状态（对话框挂载晚于首错时靠这个补齐）
  const late: string[] = [];
  const offLate = subscribeCorrupt((event) => late.push(event.message));
  assert.equal(late.length, 1);
  offLate();

  resetCorruptGuardForTests();
  assert.equal(isCorruptLocked(), false);
});

test('guardStorage 先放行写入，损坏后锁死写入并保留读取', async () => {
  resetCorruptGuardForTests();
  const base = new MemoryStorage();
  const guarded = guardStorage(base);

  await guarded.collection<Record<string, unknown>>('courses').put({ id: 'c-1', name: '高等数学' });
  assert.equal((await guarded.collection('courses').getAll()).length, 1);

  assert.equal(reportCorrupt(corruptError()), true);

  await assert.rejects(
    guarded.collection<Record<string, unknown>>('courses').put({ id: 'c-2', name: '线性代数' }),
    (cause: unknown) => isCorruptWriteBlockedError(cause),
  );
  await assert.rejects(guarded.writeMeta('theme', 'dark'), (cause: unknown) => cause instanceof CorruptWriteBlockedError);
  // 读取仍转发：用户还能把看得见的数据导出来
  assert.equal((await guarded.collection('courses').getAll()).length, 1);

  resetCorruptGuardForTests();
});

test('存储读取里第一次出现损坏也会锁定并通知', async () => {
  resetCorruptGuardForTests();
  const guarded = guardStorage(failingStorage('unsupported file format'));
  await assert.rejects(guarded.collection('courses').getAll());
  assert.equal(isCorruptLocked(), true);
  resetCorruptGuardForTests();
});

test('损坏后的只读包装拒绝所有写入口', async () => {
  resetCorruptGuardForTests();
  const readOnly = corruptReadOnlyStorage(new MemoryStorage());
  await assert.rejects(readOnly.collection('courses').put({ id: 'c-1' }), (cause: unknown) =>
    cause instanceof CorruptWriteBlockedError,
  );
  assert.ok(DATABASE_CORRUPT_MESSAGE.length > 0);
  resetCorruptGuardForTests();
});

test('导出遇到损坏时换成恢复引导文案，日志保留原始错误', async () => {
  resetCorruptGuardForTests();
  const outcome = await exportConfig(failingStorage('database disk image is malformed'), {
    modules: ['courses'],
    format: 'json',
    bundlePresets: false,
    bundleLogs: false,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.corrupt, true, '应标记为损坏，界面才能换提示');
  assert.equal(outcome.error, EXPORT_CORRUPT_MESSAGE);
  assert.equal(outcome.error, '数据库文件损坏，导出已停止：可从最近快照恢复后重试');
  assert.equal(isCorruptLocked(), true, '导出入口同样会触发恢复对话框');
  resetCorruptGuardForTests();
});

test('非损坏的导出错误保持原文案', async () => {
  resetCorruptGuardForTests();
  const outcome = await exportConfig(failingStorage('磁盘已满'), {
    modules: ['courses'],
    format: 'json',
    bundlePresets: false,
    bundleLogs: false,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.corrupt, false);
  assert.equal(outcome.error, '磁盘已满');
  assert.equal(isCorruptLocked(), false);
});
