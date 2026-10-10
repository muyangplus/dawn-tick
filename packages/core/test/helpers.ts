import { readFileSync } from 'node:fs';
import { openNodeSqlite } from '../src/drivers/node-sqlite.ts';
import { migrate } from '../src/migrate.ts';
import { MemoryStorage, type Storage } from '../src/storage.ts';
import { weeksToMask } from '../src/weeks.ts';
import type { SqlDriver, SqlValue } from '../src/db.ts';
import type {
  CourseRow,
  CourseScheduleRow,
  EventRow,
  SemesterRow,
  TimeSlotRow,
  UserRow,
} from '../src/types.ts';

export const NOW = 1759900000000;
export const USER_ID = 'u1';
export const SEMESTER_ID = 'sem-1';
export const START_DATE = '2026-09-07';
export const TIME_ZONE = 'Asia/Shanghai';

const SYNC = { created_at: NOW, updated_at: NOW, deleted_at: null, rev: 0, dirty: 0 } as const;

export function weekRange(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let week = from; week <= to; week += step) out.push(week);
  return out;
}

export function initSql(): string {
  return readFileSync(new URL('../src/schema/001_init.sql', import.meta.url), 'utf8');
}

export function createSqlite(): SqlDriver {
  const db = openNodeSqlite(':memory:');
  migrate(db, [{ id: '001_init', sql: initSql() }]);
  return db;
}

export function insertSql(db: SqlDriver, table: string, row: Record<string, SqlValue>): void {
  const columns = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
    columns.map((column) => row[column] as SqlValue),
  );
}

export function tableNames(db: SqlDriver): string[] {
  return db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .map((row) => row.name);
}

export function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return { id: USER_ID, nickname: '我', ...SYNC, ...overrides };
}

export function semesterRow(overrides: Partial<SemesterRow> = {}): SemesterRow {  return {
    id: SEMESTER_ID,
    user_id: USER_ID,
    name: '2026-2027 第一学期',
    start_date: START_DATE,
    total_weeks: 20,
    time_zone: TIME_ZONE,
    is_active: 1,
    ...SYNC,
    ...overrides,
  };
}

export function timeSlotRow(periodNo: number, startTime: string, endTime: string): TimeSlotRow {
  return {
    id: `ts-${periodNo}`,
    semester_id: SEMESTER_ID,
    period_no: periodNo,
    start_time: startTime,
    end_time: endTime,
    label: null,
    section: null,
    ...SYNC,
  };
}

export function courseRow(id: string, name: string, overrides: Partial<CourseRow> = {}): CourseRow {
  return {
    id,
    semester_id: SEMESTER_ID,
    name,
    short_name: name.slice(0, 2),
    teacher: null,
    location: null,
    color: '#4F8DFD',
    credits: null,
    note: null,
    ...SYNC,
    ...overrides,
  };
}

export function scheduleRow(
  id: string,
  courseId: string,
  weeks: number[],
  overrides: Partial<CourseScheduleRow> = {},
): CourseScheduleRow {
  return {
    id,
    course_id: courseId,
    day_of_week: 1,
    period_start: 1,
    period_end: 2,
    weeks_mask: weeksToMask(weeks),
    weeks_raw: null,
    room: null,
    ...SYNC,
    ...overrides,
  };
}

export function eventRow(
  id: string,
  type: EventRow['type'],
  overrides: Partial<EventRow> = {},
): EventRow {
  return {
    id,
    user_id: USER_ID,
    semester_id: SEMESTER_ID,
    parent_id: null,
    type,
    title: id,
    on_date: null,
    start_at: null,
    end_at: null,
    all_day: 0,
    location: null,
    note: null,
    done: 0,
    priority: null,
    due_at: null,
    subject: null,
    seat_no: null,
    ref_schedule_id: null,
    action: null,
    new_date: null,
    new_period_start: null,
    new_period_end: null,
    new_room: null,
    as_day_of_week: null,
    source: null,
    ...SYNC,
    ...overrides,
  };
}

export function createStorage(): Storage {
  return new MemoryStorage();
}

/** 与 SQLite 校验使用的同一份样例数据。 */
export async function seedStorage(storage: Storage): Promise<void> {
  await storage.collection('users').put({ id: USER_ID, nickname: '我', ...SYNC });
  await storage.collection('semesters').put(semesterRow());

  const slots: Array<[number, string, string]> = [
    [1, '08:00', '08:45'],
    [2, '08:55', '09:40'],
    [3, '10:00', '10:45'],
    [4, '10:55', '11:40'],
    [5, '14:00', '14:45'],
    [6, '14:55', '15:40'],
  ];
  for (const [periodNo, startTime, endTime] of slots) {
    await storage.collection<TimeSlotRow>('time_slots').put(timeSlotRow(periodNo, startTime, endTime));
  }

  await storage
    .collection<CourseRow>('courses')
    .put(courseRow('c-1', '高等数学', { short_name: '高数', teacher: '张老师', location: '教三-201', color: '#4F8DFD', credits: 5 }));
  await storage
    .collection<CourseRow>('courses')
    .put(courseRow('c-2', '大学物理', { short_name: '大物', teacher: '李老师', location: '理科楼-105', color: '#F2994A', credits: 3.5 }));
  await storage
    .collection<CourseRow>('courses')
    .put(courseRow('c-3', '大学英语', { short_name: '大英', teacher: '王老师', location: '外语楼-302', color: '#27AE60', credits: 2 }));

  await storage
    .collection<CourseScheduleRow>('course_schedules')
    .put(scheduleRow('s-1', 'c-1', weekRange(1, 16), { day_of_week: 1, period_start: 1, period_end: 2, weeks_raw: '1-16周' }));
  await storage
    .collection<CourseScheduleRow>('course_schedules')
    .put(scheduleRow('s-2', 'c-2', weekRange(2, 16, 2), { day_of_week: 3, period_start: 3, period_end: 4, weeks_raw: '2-16周(双)' }));
  await storage
    .collection<CourseScheduleRow>('course_schedules')
    .put(scheduleRow('s-3', 'c-3', [1, 3, 5, 7], { day_of_week: 5, period_start: 5, period_end: 6, weeks_raw: '1,3,5,7周' }));
}
