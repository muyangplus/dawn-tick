import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, validatedStorage } from '../src/validation.ts';
import type { SqlDriver, SqlValue } from '../src/db.ts';
import type { StoreName } from '../src/storage.ts';
import type { Storage } from '../src/storage.ts';
import {
  NOW,
  SEMESTER_ID,
  USER_ID,
  courseRow,
  createSqlite,
  createStorage,
  eventRow,
  insertSql,
  scheduleRow,
  semesterRow,
  timeSlotRow,
  userRow,
} from './helpers.ts';

type Row = Record<string, unknown>;

const asRow = (value: object): Row => value as Row;

interface BadCase {
  name: string;
  store: StoreName;
  row: Row;
  rule: string;
  sqlite: boolean;
}

const badCases: BadCase[] = [
  { name: '总周数 0', store: 'semesters', row: asRow(semesterRow({ total_weeks: 0 })), rule: 'total_weeks', sqlite: true },
  { name: '总周数 31', store: 'semesters', row: asRow(semesterRow({ total_weeks: 31 })), rule: 'total_weeks', sqlite: true },
  { name: '节次序号 41', store: 'time_slots', row: asRow(timeSlotRow(41, '22:00', '22:45')), rule: 'period_no', sqlite: true },
  { name: '学分为负', store: 'courses', row: asRow(courseRow('c-x', '坏课', { credits: -1 })), rule: 'credits', sqlite: true },
  { name: '星期越界', store: 'course_schedules', row: asRow(scheduleRow('x-dow', 'c-1', [1], { day_of_week: 8 })), rule: 'day_of_week', sqlite: true },
  { name: '节次区间倒置', store: 'course_schedules', row: asRow(scheduleRow('x-range', 'c-1', [1], { period_start: 5, period_end: 3 })), rule: 'period_end', sqlite: true },
  { name: '空周次位图', store: 'course_schedules', row: asRow(scheduleRow('x-mask', 'c-1', [1], { weeks_mask: 0 })), rule: 'weeks_mask', sqlite: true },
  { name: '提前分钟越界', store: 'reminders', row: { id: 'r-x', user_id: USER_ID, target_type: 'course', target_id: 'c-1', advance_minutes: 1441, enabled: 1, skip_holidays: 1, sound: 1, vibrate: 1, dnd: 0, snooze_minutes: null, ...sync() }, rule: 'advance_minutes', sqlite: true },
  { name: '贪睡分钟越界', store: 'reminders', row: { id: 'r-y', user_id: USER_ID, target_type: 'course', target_id: 'c-1', advance_minutes: 10, enabled: 1, skip_holidays: 1, sound: 1, vibrate: 1, dnd: 0, snooze_minutes: 121, ...sync() }, rule: 'snooze_minutes', sqlite: true },
  { name: '勿扰档位越界', store: 'reminders', row: { id: 'r-dnd', user_id: USER_ID, target_type: 'course', target_id: 'c-1', advance_minutes: 10, enabled: 1, skip_holidays: 1, sound: 1, vibrate: 1, dnd: 3, snooze_minutes: null, ...sync() }, rule: 'dnd', sqlite: true },
  { name: '声音开关非 0/1', store: 'reminders', row: { id: 'r-snd', user_id: USER_ID, target_type: 'course', target_id: 'c-1', advance_minutes: 10, enabled: 1, skip_holidays: 1, sound: 2, vibrate: 1, dnd: 0, snooze_minutes: null, ...sync() }, rule: 'sound', sqlite: false },
  { name: '放假缺日期', store: 'events', row: asRow(eventRow('x-holiday', 'holiday')), rule: 'on_date', sqlite: true },
  { name: '调休缺星期', store: 'events', row: asRow(eventRow('x-makeup', 'makeup', { on_date: '2026-10-11' })), rule: 'as_day_of_week', sqlite: true },
  { name: '临时日程带优先级', store: 'events', row: asRow(eventRow('x-prio', 'temp', { priority: 1 })), rule: 'priority', sqlite: true },
  { name: '调课缺关联排课', store: 'events', row: asRow(eventRow('x-resch', 'reschedule', { action: 'cancel' })), rule: 'ref_schedule_id', sqlite: true },
  { name: '改期缺新日期', store: 'events', row: asRow(eventRow('x-move', 'reschedule', { ref_schedule_id: 's-1', action: 'move' })), rule: 'new_date', sqlite: true },
  { name: '调课新节次倒置', store: 'events', row: asRow(eventRow('x-newrange', 'reschedule', { ref_schedule_id: 's-1', action: 'move', new_date: '2026-09-22', new_period_start: 5, new_period_end: 3 })), rule: 'new_period_end', sqlite: true },
  { name: '子任务指向自身', store: 'events', row: asRow(eventRow('x-self', 'todo', { parent_id: 'x-self' })), rule: 'parent_id', sqlite: true },
  { name: '优先级越界', store: 'events', row: asRow(eventRow('x-prio4', 'todo', { priority: 4 })), rule: 'priority', sqlite: true },
  { name: '类型非法', store: 'events', row: asRow(eventRow('x-type', 'temp', { type: 'unknown' as never })), rule: 'type', sqlite: true },
  { name: '颜色格式错误', store: 'courses', row: asRow(courseRow('c-bad', '坏色', { color: 'red' })), rule: 'color', sqlite: false },
  { name: '日期格式错误', store: 'semesters', row: asRow(semesterRow({ start_date: '2026/09/07' })), rule: 'start_date', sqlite: false },
];

function sync(): Row {
  return { created_at: NOW, updated_at: NOW, deleted_at: null, rev: 0, dirty: 0 };
}

function clean(row: Row): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    out[key] = value as SqlValue;
  }
  return out;
}

async function sqliteFixture(): Promise<SqlDriver> {
  const db = await createSqlite();
  await insertSql(db, 'users', { id: USER_ID, nickname: '我', created_at: NOW, updated_at: NOW });
  await insertSql(db, 'semesters', {
    id: SEMESTER_ID,
    user_id: USER_ID,
    name: '第一学期',
    start_date: '2026-09-07',
    total_weeks: 20,
    is_active: 1,
    created_at: NOW,
    updated_at: NOW,
  });
  await insertSql(db, 'courses', {
    id: 'c-1',
    semester_id: SEMESTER_ID,
    name: '高等数学',
    color: '#4F8DFD',
    created_at: NOW,
    updated_at: NOW,
  });
  await insertSql(db, 'course_schedules', {
    id: 's-1',
    course_id: 'c-1',
    day_of_week: 1,
    period_start: 1,
    period_end: 2,
    weeks_mask: 65535,
    created_at: NOW,
    updated_at: NOW,
  });
  return db;
}

function storageWithBase(): Storage {
  const storage = validatedStorage(createStorage());
  return storage;
}

async function putBase(storage: Storage): Promise<void> {
  await storage.collection('users').put(userRow());
  await storage.collection('semesters').put(semesterRow());
  await storage.collection('courses').put(courseRow('c-1', '高等数学'));
  await storage.collection('course_schedules').put(scheduleRow('s-1', 'c-1', [1]));
}

test('合法数据通过校验', async () => {
  const storage = storageWithBase();
  await putBase(storage);
  await storage.collection('time_slots').put(timeSlotRow(1, '08:00', '08:45'));
  await storage.collection('events').put(eventRow('e-ok', 'todo', { priority: 2, due_at: NOW }));
  await storage.collection('events').put(eventRow('e-h', 'holiday', { on_date: '2026-10-01', source: 'builtin' }));
  await storage
    .collection('events')
    .put(eventRow('e-mv', 'reschedule', { ref_schedule_id: 's-1', action: 'move', new_date: '2026-09-22' }));
  // 截止时刻对所有类型开放：实验与考试带 due_at 也要能写入
  await storage.collection('events').put(
    eventRow('e-lab-due', 'lab', {
      on_date: '2026-11-05',
      period_start: 7,
      period_end: 7,
      due_at: NOW,
      subject: 'c-1',
    }),
  );
  await storage.collection('events').put(eventRow('e-exam-due', 'exam', { due_at: NOW }));
  assert.equal((await storage.collection('events').getAll()).length, 5);
});

test('非法数据在写入前被拒', async () => {
  for (const item of badCases) {
    const storage = storageWithBase();
    await putBase(storage);
    await assert.rejects(
      () => storage.collection(item.store).put(item.row),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError, `${item.name}: 应抛出 ValidationError`);
        assert.ok(
          error.violations.some((violation) => violation.rule === item.rule),
          `${item.name}: 期望命中规则 ${item.rule}，实际 ${error.violations.map((v) => v.rule).join(',')}`,
        );
        return true;
      },
      item.name,
    );
  }
});

test('校验与 SQLite 约束对拍', async () => {
  const backed = badCases.filter((item) => item.sqlite);
  assert.ok(backed.length >= 15);
  for (const item of backed) {
    const db = await sqliteFixture();
    await assert.rejects(
      () => insertSql(db, item.store, clean(item.row)),
      `${item.name}: SQLite 应拒绝`,
    );
  }
});

test('唯一性：同一学期节次不重复', async () => {
  const storage = storageWithBase();
  await putBase(storage);
  await storage.collection('time_slots').put(timeSlotRow(1, '08:00', '08:45'));
  await assert.rejects(
    () => storage.collection('time_slots').put({ ...timeSlotRow(1, '09:00', '09:45'), id: 'ts-other' }),
    (error: unknown) => error instanceof ValidationError && error.violations.some((v) => v.rule === 'ux_time_slots'),
  );
});

test('唯一性：同一天只能有一条假期或调休判定', async () => {
  const storage = storageWithBase();
  await putBase(storage);
  await storage.collection('events').put(eventRow('e-1', 'holiday', { on_date: '2026-10-01', source: 'builtin' }));
  await assert.rejects(
    () =>
      storage
        .collection('events')
        .put(eventRow('e-2', 'makeup', { on_date: '2026-10-01', as_day_of_week: 3, source: 'from_school' })),
    (error: unknown) => error instanceof ValidationError && error.violations.some((v) => v.rule === 'ux_events_day_kind'),
  );
});

test('唯一性：每个用户只能有一个当前学期', async () => {
  const storage = storageWithBase();
  await putBase(storage);
  await assert.rejects(
    () => storage.collection('semesters').put(semesterRow({ id: 'sem-2', is_active: 1 })),
    (error: unknown) => error instanceof ValidationError && error.violations.some((v) => v.rule === 'ux_semesters_active'),
  );
});

test('软删除的行不参与唯一性判定', async () => {
  const storage = storageWithBase();
  await putBase(storage);
  await storage.collection('time_slots').put({ ...timeSlotRow(1, '08:00', '08:45'), id: 'ts-old', deleted_at: NOW });
  await assert.doesNotReject(() => storage.collection('time_slots').put(timeSlotRow(1, '08:00', '08:45')));
});
