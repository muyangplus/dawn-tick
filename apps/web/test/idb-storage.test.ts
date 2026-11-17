import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_NAMES, activeSemester, weekView, type Storage } from '@dawn-tick/core';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import { SAMPLE_SEMESTER, SAMPLE_USER, seedSample } from '../src/db/sample.ts';

async function open(name: string): Promise<Storage> {
  const storage = await openIndexedDbStorage(name);
  await seedSample(storage, '2026-09-07', 'Asia/Shanghai');
  return storage;
}

test('IndexedDB 存储满足统一接口', async () => {
  const storage = await open('case-basic');
  assert.equal(storage.kind, 'indexeddb');
  assert.equal((await activeSemester(storage, SAMPLE_USER))?.id, SAMPLE_SEMESTER);

  const monday = await weekView(storage, SAMPLE_SEMESTER, 1, 3);
  assert.equal(monday.length, 1);
  assert.equal(monday[0]?.name, '高等数学');
  assert.equal(monday[0]?.room, '教三-201');
  assert.deepEqual(await weekView(storage, SAMPLE_SEMESTER, 3, 3), []);
  assert.deepEqual(await weekView(storage, SAMPLE_SEMESTER, 1, 17), []);
  await storage.close();
});

test('IndexedDB 上 put 为 upsert，delete 生效', async () => {
  const storage = await open('case-upsert');
  await storage.collection('courses').put({
    id: 'c-1',
    semester_id: SAMPLE_SEMESTER,
    name: '高等数学（改）',
    color: '#000000',
    created_at: 1,
    updated_at: 2,
    deleted_at: null,
    rev: 1,
    dirty: 1,
  });
  const rows = await storage.collection<Record<string, unknown>>('courses').getAll();
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row['id'] === 'c-1')?.['name'], '高等数学（改）');

  await storage.collection('courses').delete('c-2');
  assert.equal((await storage.collection('courses').getAll()).length, 2);
  await storage.close();
});

test('元数据读写', async () => {
  const storage = await open('case-meta');
  await storage.writeMeta('time_zone', 'Asia/Shanghai');
  assert.equal(await storage.readMeta('time_zone'), 'Asia/Shanghai');
  await storage.writeMeta('time_zone', 'America/New_York');
  assert.equal(await storage.readMeta('time_zone'), 'America/New_York');
  assert.equal(await storage.readMeta('missing'), undefined);
  await storage.close();
});

test('集合清单与 SQLite 端一致', async () => {
  const storage = await open('case-stores');
  for (const store of STORE_NAMES) {
    const rows = await storage.collection(store).getAll();
    assert.ok(Array.isArray(rows), `${store} 应可读取`);
  }
  await storage.close();
});
