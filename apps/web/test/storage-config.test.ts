import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '@dawn-tick/core';
import {
  canConfigureStorage,
  openDataDirectory,
  readStorageInfo,
  relaunchApplication,
  saveStoragePath,
  storageStatusLabel,
} from '../src/storage-config.ts';
import {
  ReadOnlyStorageError,
  STORAGE_READ_ONLY_MESSAGE,
  isFallbackStorage,
  markStorageFallback,
  readOnlyStorage,
} from '../src/db/fallback.ts';

test('浏览器环境不提供存储位置配置', async () => {
  assert.equal(canConfigureStorage(), false);
  assert.equal(await readStorageInfo(), null);
  const refused = await saveStoragePath('D:\\dt-data');
  assert.equal(refused.info, null);
  assert.equal(refused.error, '当前平台不支持修改存储位置');
});

test('浏览器环境不打开数据目录、也不重启', async () => {
  assert.equal(await openDataDirectory(), null);
  assert.equal(await relaunchApplication(), false);
});

test('回退标记落在返回的 Storage 上，普通存储不会被误判', () => {
  const plain = new MemoryStorage();
  assert.equal(isFallbackStorage(plain), false);
  assert.equal(isFallbackStorage(null), false);

  const opened = markStorageFallback(plain, '原生库打不开');
  assert.equal(isFallbackStorage(opened), true);
  assert.equal(opened.fallback, true);
  assert.equal(opened.fallbackReason, '原生库打不开');
  // 状态行：回退时一定带「临时回退」，否则维持真实类型
  assert.equal(storageStatusLabel('原生 SQLite', true), '原生 SQLite · 临时回退');
  assert.equal(storageStatusLabel('原生 SQLite', false), '原生 SQLite');
});

test('临时回退期间写操作被拦截且提示只读，读操作照常', async () => {
  const fallback = markStorageFallback(new MemoryStorage(), 'smoke');
  await fallback.writeMeta('probe', 'v1');
  const guarded = readOnlyStorage(fallback);
  assert.equal(isFallbackStorage(guarded), true);
  assert.equal(await guarded.readMeta('probe'), 'v1');

  await assert.rejects(
    () => guarded.writeMeta('probe', 'v2'),
    (cause: unknown) =>
      cause instanceof ReadOnlyStorageError && cause.message === STORAGE_READ_ONLY_MESSAGE,
  );
  await assert.rejects(
    () => guarded.collection('courses').put({ id: 'c1' }),
    (cause: unknown) => cause instanceof ReadOnlyStorageError,
  );
  await assert.rejects(
    () => guarded.collection('courses').clear(),
    (cause: unknown) => cause instanceof ReadOnlyStorageError,
  );
});
