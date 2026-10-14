import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_STORES, MemoryRemote, collectDirty, syncAll } from '../src/sync.ts';
import type { Storage } from '../src/storage.ts';
import { createStorage, seedStorage } from './helpers.ts';

async function markAllDirty(storage: Storage): Promise<number> {
  let count = 0;
  for (const store of SYNC_STORES) {
    const rows = await storage.collection<Record<string, unknown>>(store).getAll();
    if (rows.length === 0) continue;
    await storage
      .collection(store)
      .putMany(rows.map((row) => ({ ...row, dirty: 1 })));
    count += rows.length;
  }
  return count;
}

test('首次同步把一个库的数据推到另一个库', async () => {
  const remote = new MemoryRemote();
  const deviceA = createStorage();
  const deviceB = createStorage();
  await seedStorage(deviceA);

  const seeded = await markAllDirty(deviceA);
  assert.equal(seeded, 14);

  const pushReport = await syncAll(deviceA, remote);
  assert.equal(pushReport.pushed, 14);
  assert.equal(await collectDirty(deviceA).then((rows) => rows.length), 0);

  const pullReport = await syncAll(deviceB, remote);
  assert.equal(pullReport.pulled, 14);
  assert.equal((await deviceB.collection('courses').getAll()).length, 3);
  assert.equal((await deviceB.collection('course_schedules').getAll()).length, 3);
  assert.equal((await deviceB.collection('semesters').getAll()).length, 1);
});

test('同步是幂等的', async () => {
  const remote = new MemoryRemote();
  const deviceA = createStorage();
  const deviceB = createStorage();
  await seedStorage(deviceA);
  await markAllDirty(deviceA);
  await syncAll(deviceA, remote);
  await syncAll(deviceB, remote);

  const again = await syncAll(deviceB, remote);
  assert.equal(again.pushed, 0);
  assert.equal(again.pulled, 0);
  assert.equal(again.conflicts.length, 0);
});

test('本地修改能同步到另一端', async () => {
  const remote = new MemoryRemote();
  const deviceA = createStorage();
  const deviceB = createStorage();
  await seedStorage(deviceA);
  await markAllDirty(deviceA);
  await syncAll(deviceA, remote);
  await syncAll(deviceB, remote);

  const course = await deviceB.collection<Record<string, unknown>>('courses').get('c-1');
  assert.ok(course !== undefined);
  await deviceB.collection('courses').put({
    ...course,
    name: '高等数学（改）',
    rev: Number(course.rev) + 1,
    updated_at: Number(course.updated_at) + 1000,
    dirty: 1,
  });

  const report = await syncAll(deviceB, remote);
  assert.equal(report.pushed, 1);
  await syncAll(deviceA, remote);

  const updated = await deviceA.collection<Record<string, unknown>>('courses').get('c-1');
  assert.equal(updated?.name, '高等数学（改）');
});

test('远端版本更高时以远端为准', async () => {
  const remote = new MemoryRemote();
  const deviceA = createStorage();
  const deviceB = createStorage();
  await seedStorage(deviceA);
  await markAllDirty(deviceA);
  await syncAll(deviceA, remote);
  await syncAll(deviceB, remote);

  const local = await deviceB.collection<Record<string, unknown>>('courses').get('c-2');
  assert.ok(local !== undefined);
  await deviceB.collection('courses').put({ ...local, name: '旧的本地改动', rev: 1, dirty: 1 });

  const remoteRow = await deviceA.collection<Record<string, unknown>>('courses').get('c-2');
  assert.ok(remoteRow !== undefined);
  await deviceA.collection('courses').put({
    ...remoteRow,
    name: '更新的远端',
    rev: 5,
    updated_at: Number(remoteRow.updated_at) + 5000,
    dirty: 1,
  });
  await syncAll(deviceA, remote);

  const report = await syncAll(deviceB, remote);
  const merged = await deviceB.collection<Record<string, unknown>>('courses').get('c-2');
  assert.equal(merged?.name, '更新的远端');
  assert.ok(report.conflicts.some((conflict) => conflict.key === 'c-2' && conflict.resolution === 'remote'));
});

test('同版本不同时间戳记为冲突并保留较新者', async () => {
  const remote = new MemoryRemote();
  const deviceA = createStorage();
  const deviceB = createStorage();
  await seedStorage(deviceA);
  await markAllDirty(deviceA);
  await syncAll(deviceA, remote);
  await syncAll(deviceB, remote);

  const rowB = await deviceB.collection<Record<string, unknown>>('events').get('e-1');
  void rowB;
  await deviceB.collection('events').put({
    id: 'e-1', user_id: 'u1', semester_id: 'sem-1', parent_id: null, type: 'temp', title: '班会',
    on_date: null, start_at: null, end_at: null, all_day: 0, location: null, note: null, done: 0,
    priority: null, due_at: null, subject: null, seat_no: null, ref_schedule_id: null, action: null,
    new_date: null, new_period_start: null, new_period_end: null, new_room: null, as_day_of_week: null,
    source: null, created_at: 1, updated_at: 100, deleted_at: null, rev: 3, dirty: 1,
  });
  await deviceA.collection('events').put({
    id: 'e-1', user_id: 'u1', semester_id: 'sem-1', parent_id: null, type: 'temp', title: '班会（新）',
    on_date: null, start_at: null, end_at: null, all_day: 0, location: null, note: null, done: 0,
    priority: null, due_at: null, subject: null, seat_no: null, ref_schedule_id: null, action: null,
    new_date: null, new_period_start: null, new_period_end: null, new_room: null, as_day_of_week: null,
    source: null, created_at: 1, updated_at: 200, deleted_at: null, rev: 3, dirty: 1,
  });
  await syncAll(deviceA, remote);

  const report = await syncAll(deviceB, remote);
  const merged = await deviceB.collection<Record<string, unknown>>('events').get('e-1');
  assert.equal(merged?.title, '班会（新）');
  assert.ok(report.conflicts.some((conflict) => conflict.key === 'e-1'));
});

test('软删除随同步传播', async () => {
  const remote = new MemoryRemote();
  const deviceA = createStorage();
  const deviceB = createStorage();
  await seedStorage(deviceA);
  await markAllDirty(deviceA);
  await syncAll(deviceA, remote);
  await syncAll(deviceB, remote);

  const target = await deviceA.collection<Record<string, unknown>>('courses').get('c-3');
  assert.ok(target !== undefined);
  await deviceA.collection('courses').put({
    ...target,
    deleted_at: 1799900000000,
    rev: Number(target.rev) + 1,
    dirty: 1,
  });
  await syncAll(deviceA, remote);
  await syncAll(deviceB, remote);

  const removed = await deviceB.collection<Record<string, unknown>>('courses').get('c-3');
  assert.equal(removed?.deleted_at, 1799900000000);
});
