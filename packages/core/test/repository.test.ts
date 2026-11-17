import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSemester,
  applyDayKind,
  dayKindForDate,
  expandInputOf,
  listSchedules,
  loadExpandInput,
  loadSemesterSnapshot,
  weekView,
} from '../src/repository.ts';
import { createCourse, createReschedule, createSchedule, createSemester } from '../src/mutations.ts';
import type { Storage } from '../src/storage.ts';
import type { EventRow } from '../src/types.ts';
import { validatedStorage, writeGeneration } from '../src/validation.ts';
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
} from './kit/index.ts';

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
  // 用户记录在前，内置中秋假期（09-25～09-27）随后合并进来
  assert.deepEqual(
    input.dayKinds?.map((kind) => [kind.on_date, kind.type]),
    [
      ['2026-09-25', 'holiday'],
      ['2026-09-25', 'holiday'],
      ['2026-09-26', 'holiday'],
      ['2026-09-27', 'holiday'],
    ],
  );
});

test('未使用的行工厂仍可用', () => {
  const row = scheduleRow('s-x', 'c-1', weekRange(1, 4));
  assert.equal(row.weeks_mask, 15);
});

test('学期快照一次读齐，展开输入与逐表读取一致，并带上没记学期的调课', async () => {
  const { storage, semesterId } = await seededForSnapshot();
  const snapshot = await loadSemesterSnapshot(storage, semesterId);
  assert.ok(snapshot !== undefined);
  assert.ok(snapshot.events.some((row) => row.semester_id === null && row.type === 'reschedule'));
  const from = '2026-09-01';
  const to = '2027-01-31';
  assert.deepEqual(expandInputOf(snapshot, from, to), await loadExpandInput(storage, semesterId, from, to));
  const input = expandInputOf(snapshot, from, to);
  assert.equal(input.reschedules?.length, 1, '没记学期的调课也参与展开');
  assert.ok(input.dayKinds?.some((row) => row.source === 'builtin'), '带内置节假日');
});

test('写入代数随每次写入递增，未包装的存储返回 null', async () => {
  const raw = createStorage();
  assert.equal(writeGeneration(raw), null);
  const storage = validatedStorage(raw);
  const before = writeGeneration(storage) ?? -1;
  await storage.writeMeta('k', 'v');
  await storage.collection('users').put({ id: 'u-x', nickname: 'x', created_at: 1, updated_at: 1, deleted_at: null, rev: 0, dirty: 0 });
  assert.equal(writeGeneration(storage), before + 2);
});

async function seededForSnapshot(): Promise<{ storage: Storage; semesterId: string }> {
  const storage = createStorage();
  const semester = await createSemester(storage, { userId: USER_ID, name: '第一学期', startDate: '2026-09-07' });
  const semesterId = String(semester['id']);
  const course = await createCourse(storage, { semesterId, name: '高等数学' });
  const schedule = await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: [1, 2, 3, 4],
  });
  const reschedule = await createReschedule(storage, {
    userId: USER_ID,
    semesterId,
    refScheduleId: String(schedule['id']),
    onDate: '2026-09-14',
    action: 'cancel',
  });
  const events = storage.collection<Record<string, unknown>>('events');
  await events.put({ ...(await events.get(String(reschedule['id']))), semester_id: null });
  return { storage, semesterId };
}
