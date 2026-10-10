import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSemester,
  applyDayKind,
  dayKindForDate,
  listSchedules,
  loadExpandInput,
  weekView,
} from '../src/repository.ts';
import type { EventRow } from '../src/types.ts';
import {
  NOW,
  SEMESTER_ID,
  USER_ID,
  courseRow,
  createStorage,
  eventRow,
  scheduleRow,
  seedStorage,
  weekRange,
} from './helpers.ts';

test('周视图按位图过滤', async () => {
  const storage = createStorage();
  await seedStorage(storage);

  const monday = await weekView(storage, SEMESTER_ID, 1, 3);
  assert.equal(monday.length, 1);
  assert.equal(monday[0]?.name, '高等数学');
  assert.equal(monday[0]?.room, '教三-201');

  assert.deepEqual(await weekView(storage, SEMESTER_ID, 3, 3), []);
  assert.equal((await weekView(storage, SEMESTER_ID, 3, 4))[0]?.name, '大学物理');
  assert.deepEqual(await weekView(storage, SEMESTER_ID, 1, 17), []);
  assert.equal((await weekView(storage, SEMESTER_ID, 5, 5))[0]?.name, '大学英语');
  assert.deepEqual(await weekView(storage, SEMESTER_ID, 5, 6), []);
  assert.equal((await weekView(storage, SEMESTER_ID, 5, 7))[0]?.name, '大学英语');
});

test('软删除的行不进入结果', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('courses').put(courseRow('c-1', '高等数学', { deleted_at: NOW }));
  assert.deepEqual(await weekView(storage, SEMESTER_ID, 1, 3), []);
  assert.equal((await listSchedules(storage, SEMESTER_ID)).length, 2);
});

test('当前学期', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  assert.equal((await activeSemester(storage, USER_ID))?.id, SEMESTER_ID);
  assert.equal(await activeSemester(storage, 'nobody'), undefined);
});

test('来源优先级决定写入动作', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const events = storage.collection<EventRow>('events');

  await events.put(eventRow('e-1', 'holiday', { on_date: '2026-10-01', source: 'builtin' }));
  const overwrite = await applyDayKind(storage, {
    id: 'e-2',
    userId: USER_ID,
    semesterId: SEMESTER_ID,
    onDate: '2026-10-01',
    type: 'holiday',
    source: 'from_school',
    title: '教务校历',
  });
  assert.equal(overwrite, 'overwrite');
  assert.equal((await dayKindForDate(storage, SEMESTER_ID, '2026-10-01'))?.source, 'from_school');
  assert.equal((await events.getAll()).filter((row) => row.on_date === '2026-10-01').length, 1);

  await events.put(eventRow('e-3', 'holiday', { on_date: '2026-10-02', source: 'manual' }));
  const skip = await applyDayKind(storage, {
    id: 'e-4',
    userId: USER_ID,
    semesterId: SEMESTER_ID,
    onDate: '2026-10-02',
    type: 'holiday',
    source: 'builtin',
    title: '内置放假',
  });
  assert.equal(skip, 'skip');
  assert.equal((await dayKindForDate(storage, SEMESTER_ID, '2026-10-02'))?.source, 'manual');
});

test('空日期直接插入', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const action = await applyDayKind(storage, {
    id: 'e-9',
    userId: USER_ID,
    semesterId: SEMESTER_ID,
    onDate: '2026-10-11',
    type: 'makeup',
    source: 'from_school',
    title: '调休补课',
    asDayOfWeek: 3,
  });
  assert.equal(action, 'insert');
  assert.equal((await dayKindForDate(storage, SEMESTER_ID, '2026-10-11'))?.as_day_of_week, 3);
});

test('组装展开输入', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const input = await loadExpandInput(storage, SEMESTER_ID, '2026-09-21', '2026-09-27');
  assert.ok(input !== undefined);
  assert.equal(input.semester.time_zone, 'Asia/Shanghai');
  assert.equal(input.courses.length, 3);
  assert.equal(input.schedules.length, 3);
  assert.equal(input.timeSlots.length, 6);

  assert.equal(await loadExpandInput(storage, 'missing', '2026-09-21', '2026-09-27'), undefined);
});

test('展开输入包含调课与日期判定', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put(
    eventRow('e-mv', 'reschedule', {
      on_date: '2026-09-21',
      ref_schedule_id: 's-1',
      action: 'move',
      new_date: '2026-09-22',
      new_period_start: 3,
      new_period_end: 4,
    }),
  );
  await storage.collection('events').put(eventRow('e-h', 'holiday', { on_date: '2026-09-25', source: 'builtin' }));
  const input = await loadExpandInput(storage, SEMESTER_ID, '2026-09-21', '2026-09-27');
  assert.ok(input !== undefined);
  assert.equal(input.reschedules?.length, 1);
  assert.equal(input.dayKinds?.length, 1);
});

test('未使用的行工厂仍可用', () => {
  const row = scheduleRow('s-x', 'c-1', weekRange(1, 4));
  assert.equal(row.weeks_mask, 15);
});
