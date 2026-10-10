import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PERIODS,
  clearReschedules,
  createCourse,
  createEvent,
  createReschedule,
  createSchedule,
  createSemester,
  deleteCourse,
  deleteEvent,
  ensureUser,
  listReschedules,
  setReminder,
  updateCourse,
  uuidv7,
} from '../src/mutations.ts';
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../src/settings.ts';
import { weekView } from '../src/repository.ts';
import { ValidationError } from '../src/validation.ts';
import { MemoryStorage } from '../src/storage.ts';
import { SEMESTER_ID, START_DATE, USER_ID, createStorage, seedStorage, weekRange } from './helpers.ts';

const FIXED = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `id-${counter}`;
  };
})();

function fixedClock(): () => number {
  let tick = 1759900000000;
  return () => {
    tick += 1000;
    return tick;
  };
}

test('uuidv7 编码 48 位时间戳且版本位正确', () => {
  const value = uuidv7(1759900000000);
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const stampOf = (uuid: string): bigint => BigInt(`0x${uuid.replace(/-/g, '').slice(0, 12)}`);
  assert.equal(stampOf(value), 1759900000000n);
  assert.equal(stampOf(uuidv7(1759900005000)), 1759900005000n);
  assert.ok(stampOf(uuidv7(1759900005000)) > stampOf(value));
});

test('ensureUser 幂等', async () => {
  const storage = createStorage();
  const first = await ensureUser(storage, USER_ID);
  const second = await ensureUser(storage, USER_ID, '别人');
  assert.equal(first['id'], second['id']);
  assert.equal(second['nickname'], '我');
  assert.equal((await storage.collection('users').getAll()).length, 1);
});

test('新建学期会把旧学期取消当前状态', async () => {
  const storage = createStorage();
  const options = { now: fixedClock(), id: FIXED };
  const first = await createSemester(storage, { userId: USER_ID, name: '第一学期', startDate: START_DATE }, options);
  const second = await createSemester(storage, { userId: USER_ID, name: '第二学期', startDate: '2027-02-22' }, options);

  const rows = await storage.collection<Record<string, unknown>>('semesters').getAll();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row['id'] === first['id'])?.['is_active'], 0);
  assert.equal(rows.find((row) => row['id'] === second['id'])?.['is_active'], 1);
});

test('新建学期后可立即用于周视图', async () => {
  const storage = createStorage();
  const options = { now: fixedClock(), id: FIXED };
  const semester = await createSemester(
    storage,
    { userId: USER_ID, name: '第一学期', startDate: START_DATE },
    options,
  );
  const course = await createCourse(
    storage,
    { semesterId: String(semester['id']), name: '高等数学', shortName: '高数', location: '教三-201' },
    options,
  );
  await createSchedule(
    storage,
    {
      courseId: String(course['id']),
      dayOfWeek: 1,
      periodStart: 1,
      periodEnd: 2,
      weeks: weekRange(1, 16),
    },
    options,
  );

  const rows = await weekView(storage, String(semester['id']), 1, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, '高等数学');
  assert.equal(rows[0]?.room, '教三-201');
});

test('更新会递增 rev 并置 dirty', async () => {
  const storage = createStorage();
  const options = { now: fixedClock(), id: FIXED };
  const semester = await createSemester(storage, { userId: USER_ID, name: '第一学期', startDate: START_DATE }, options);
  const course = await createCourse(storage, { semesterId: String(semester['id']), name: '高等数学' }, options);
  const updated = await updateCourse(storage, String(course['id']), { name: '高等数学（改）' }, options);

  assert.equal(updated['name'], '高等数学（改）');
  assert.equal(updated['rev'], 1);
  assert.equal(updated['dirty'], 1);
});

test('删除课程会软删除排课并清理提醒', async () => {
  const storage = createStorage();
  const options = { now: fixedClock(), id: FIXED };
  const semester = await createSemester(storage, { userId: USER_ID, name: '第一学期', startDate: START_DATE }, options);
  const course = await createCourse(storage, { semesterId: String(semester['id']), name: '高等数学' }, options);
  const schedule = await createSchedule(
    storage,
    { courseId: String(course['id']), dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: weekRange(1, 16) },
    options,
  );
  await setReminder(
    storage,
    { userId: USER_ID, targetType: 'course', targetId: String(course['id']), advanceMinutes: 15 },
    options,
  );

  await deleteCourse(storage, String(course['id']), options);

  const schedules = await storage.collection<Record<string, unknown>>('course_schedules').get(String(schedule['id']));
  assert.ok((schedules?.['deleted_at'] as number) > 0);
  const reminders = await storage.collection<Record<string, unknown>>('reminders').getAll();
  assert.ok(reminders.every((row) => (row['deleted_at'] as number) > 0));
  assert.deepEqual(await weekView(storage, String(semester['id']), 1, 3), []);
});

test('删除待办会连带删除子任务', async () => {
  const storage = createStorage();
  const options = { now: fixedClock(), id: FIXED };
  await ensureUser(storage, USER_ID, '我', options);
  const parent = await createEvent(storage, { userId: USER_ID, type: 'todo', title: '交实验报告' }, options);
  const child = await createEvent(
    storage,
    { userId: USER_ID, type: 'todo', title: '写实验一', parentId: String(parent['id']) },
    options,
  );

  await deleteEvent(storage, String(parent['id']), options);
  const events = await storage.collection<Record<string, unknown>>('events').getAll();
  assert.ok(events.every((row) => (row['deleted_at'] as number) > 0));
  assert.equal(events.length, 2);
  assert.ok(events.some((row) => row['id'] === child['id']));
});

test('同一目标的提醒只保留一条', async () => {
  const storage = createStorage();
  const options = { now: fixedClock(), id: FIXED };
  await ensureUser(storage, USER_ID, '我', options);
  await setReminder(storage, { userId: USER_ID, targetType: 'course', targetId: 'c-1', advanceMinutes: 5 }, options);
  const second = await setReminder(
    storage,
    { userId: USER_ID, targetType: 'course', targetId: 'c-1', advanceMinutes: 30, dnd: 2 },
    options,
  );

  const rows = await storage.collection<Record<string, unknown>>('reminders').getAll();
  assert.equal(rows.length, 1);
  assert.equal(second['advance_minutes'], 30);
  assert.equal(second['dnd'], 2);
});

test('写入前校验会拦截非法值', async () => {
  const storage = createStorage();
  const options = { now: fixedClock(), id: FIXED };
  const semester = await createSemester(storage, { userId: USER_ID, name: '第一学期', startDate: START_DATE }, options);
  await assert.rejects(
    () => createCourse(storage, { semesterId: String(semester['id']), name: '坏色', color: 'red' }, options),
    (error: unknown) => error instanceof ValidationError,
  );
  await assert.rejects(
    () => createSemester(storage, { userId: USER_ID, name: '坏周数', startDate: START_DATE, totalWeeks: 99 }, options),
    (error: unknown) => error instanceof ValidationError,
  );
});

test('设置默认值与读写回环', async () => {
  const storage = new MemoryStorage();
  assert.deepEqual(await readSettings(storage), DEFAULT_SETTINGS);

  const saved = await writeSettings(storage, { viewDays: 7, theme: 'dark', themePreset: 'muted', autoTimeZone: true });
  assert.equal(saved.viewDays, 7);
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.themePreset, 'muted');
  assert.equal(saved.autoTimeZone, true);
  assert.equal(saved.timeZone, DEFAULT_SETTINGS.timeZone);

  assert.deepEqual(await readSettings(storage), saved);
});

test('设置非法值被拒或回退', async () => {
  const storage = new MemoryStorage();
  await assert.rejects(() => writeSettings(storage, { viewDays: 4 }), RangeError);
  await assert.rejects(() => writeSettings(storage, { timeZone: '' }), RangeError);

  await storage.writeMeta('view_days', '99');
  await storage.writeMeta('theme', 'neon');
  await storage.writeMeta('theme_preset', 'unknown');
  const settings = await readSettings(storage);
  assert.equal(settings.viewDays, DEFAULT_SETTINGS.viewDays);
  assert.equal(settings.theme, DEFAULT_SETTINGS.theme);
  assert.equal(settings.themePreset, DEFAULT_SETTINGS.themePreset);
});

test('新建学期会带默认节次时间表', async () => {
  const storage = createStorage();
  const semester = await createSemester(
    storage,
    { userId: USER_ID, name: '第一学期', startDate: START_DATE },
    { now: fixedClock(), id: FIXED },
  );
  const slots = await storage.collection<Record<string, unknown>>('time_slots').getAll();
  assert.equal(slots.length, DEFAULT_PERIODS.length);
  assert.equal(slots.filter((row) => row['semester_id'] === semester['id']).length, DEFAULT_PERIODS.length);
  const first = slots.find((row) => row['period_no'] === 1);
  assert.equal(first?.['start_time'], '08:00');
  assert.equal(first?.['section'], 'am');

  const withoutSlots = await createSemester(
    storage,
    { userId: USER_ID, name: '第二学期', startDate: '2027-02-22', withDefaultTimeSlots: false },
    { now: fixedClock(), id: FIXED },
  );
  const rows = await storage.collection<Record<string, unknown>>('time_slots').getAll();
  assert.equal(rows.filter((row) => row['semester_id'] === withoutSlots['id']).length, 0);
});

test('调课记录可写入、查询与撤销', async () => {
  const storage = createStorage();
  await seedStorage(storage);

  const created = await createReschedule(storage, {
    userId: USER_ID,
    semesterId: 'sem-1',
    refScheduleId: 's-1',
    onDate: '2026-09-21',
    action: 'move',
    newDate: '2026-09-22',
    newPeriodStart: 3,
    newPeriodEnd: 4,
  });
  assert.equal(created['type'], 'reschedule');
  assert.equal(created['action'], 'move');

  const found = await listReschedules(storage, 's-1', '2026-09-21');
  assert.equal(found.length, 1);
  assert.equal(found[0]?.['new_period_start'], 3);
  assert.deepEqual(await listReschedules(storage, 's-1', '2026-09-28'), []);

  assert.equal(await clearReschedules(storage, 's-1', '2026-09-21'), 1);
  assert.deepEqual(await listReschedules(storage, 's-1', '2026-09-21'), []);

  const cancel = await createReschedule(storage, {
    userId: USER_ID,
    semesterId: 'sem-1',
    refScheduleId: 's-1',
    onDate: '2026-09-28',
    action: 'cancel',
  });
  assert.equal(cancel['title'], '停课');
});

test('调课记录缺少字段时被校验拒绝', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await assert.rejects(
    () =>
      createReschedule(storage, {
        userId: USER_ID,
        semesterId: 'sem-1',
        refScheduleId: 's-1',
        onDate: '2026-09-21',
        action: 'move',
      }),
    /new_date|new_period|校验/,
  );
});

test('新建学期使用固定 id 生成器便于断言', async () => {
  const storage = createStorage();
  let first = true;
  const semester = await createSemester(
    storage,
    { userId: USER_ID, name: '第一学期', startDate: START_DATE },
    {
      now: fixedClock(),
      id: () => {
        if (first) {
          first = false;
          return SEMESTER_ID;
        }
        return `slot-${Math.random().toString(16).slice(2)}`;
      },
    },
  );
  assert.equal(semester['id'], SEMESTER_ID);
});
