import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canConfigureStorage,
  openDataDirectory,
  readStorageInfo,
  relaunchApplication,
  saveStoragePath,
} from '../src/storage-config.ts';

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
