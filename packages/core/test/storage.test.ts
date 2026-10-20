import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, createMetaAccessors, type MetaRow } from '../src/storage.ts';

test('createMetaAccessors 是 app_meta 的唯一 kv 实现', async () => {
  const storage = new MemoryStorage();
  const accessors = createMetaAccessors(storage.collection<MetaRow>('app_meta'));

  assert.equal(await accessors.readMeta('missing'), undefined);
  await accessors.writeMeta('theme', 'dark');
  assert.equal(await accessors.readMeta('theme'), 'dark');
  await accessors.writeMeta('theme', 'light');
  assert.equal(await accessors.readMeta('theme'), 'light', '同键覆盖');

  // 与 Storage 自身的 readMeta/writeMeta 共用同一份 app_meta 行
  assert.equal(await storage.readMeta('theme'), 'light');
  await storage.writeMeta('view_days', '5');
  assert.equal(await accessors.readMeta('view_days'), '5');

  const rows = await storage.collection<MetaRow>('app_meta').getAll();
  assert.deepEqual(rows.map((row) => row.key).sort(), ['theme', 'view_days']);
  assert.deepEqual(rows.find((row) => row.key === 'view_days'), { key: 'view_days', value: '5' });
});

test('MemoryStorage 的 readMeta/writeMeta 委托给同一实现', async () => {
  const storage = new MemoryStorage();
  await storage.writeMeta('empty', '');
  assert.equal(await storage.readMeta('empty'), '', '空串与缺失可区分');
  assert.equal(await storage.readMeta('nope'), undefined);
});
