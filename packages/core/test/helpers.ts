import { readFileSync } from 'node:fs';
import { openNodeSqlite } from '../src/drivers/node-sqlite.ts';
import { migrate } from '../src/migrate.ts';
import { weeksToMask } from '../src/weeks.ts';
import type { SqlDriver, SqlValue } from '../src/db.ts';

export const NOW = 1759900000000;
export const SEMESTER_ID = 'sem-1';
export const USER_ID = 'u1';

export function initSql(): string {
  return readFileSync(new URL('../src/schema/001_init.sql', import.meta.url), 'utf8');
}

export function createDb(): SqlDriver {
  const db = openNodeSqlite(':memory:');
  migrate(db, [{ id: '001_init', sql: initSql() }]);
  return db;
}

export function insert(db: SqlDriver, table: string, row: Record<string, SqlValue>): void {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(',');
  db.run(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`,
    columns.map((column) => row[column] as SqlValue),
  );
}

function weekRange(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let week = from; week <= to; week += step) out.push(week);
  return out;
}

export function seed(db: SqlDriver): void {
  insert(db, 'users', { id: USER_ID, nickname: '我', created_at: NOW, updated_at: NOW });
  insert(db, 'semesters', {
    id: SEMESTER_ID,
    user_id: USER_ID,
    name: '2026-2027 第一学期',
    start_date: '2026-09-07',
    total_weeks: 20,
    time_zone: 'Asia/Shanghai',
    is_active: 1,
    created_at: NOW,
    updated_at: NOW,
  });

  const slots: Array<[number, string, string, string]> = [
    [1, '08:00', '08:45', 'am'],
    [2, '08:55', '09:40', 'am'],
    [3, '10:00', '10:45', 'am'],
    [4, '10:55', '11:40', 'am'],
    [5, '14:00', '14:45', 'pm'],
    [6, '14:55', '15:40', 'pm'],
  ];
  for (const [periodNo, startTime, endTime, section] of slots) {
    insert(db, 'time_slots', {
      id: `ts-${periodNo}`,
      semester_id: SEMESTER_ID,
      period_no: periodNo,
      start_time: startTime,
      end_time: endTime,
      section,
      created_at: NOW,
      updated_at: NOW,
    });
  }

  insert(db, 'courses', {
    id: 'c-1',
    semester_id: SEMESTER_ID,
    name: '高等数学',
    short_name: '高数',
    teacher: '张老师',
    location: '教三-201',
    color: '#4F8DFD',
    credits: 5,
    created_at: NOW,
    updated_at: NOW,
  });
  insert(db, 'courses', {
    id: 'c-2',
    semester_id: SEMESTER_ID,
    name: '大学物理',
    short_name: '大物',
    teacher: '李老师',
    location: '理科楼-105',
    color: '#F2994A',
    credits: 3.5,
    created_at: NOW,
    updated_at: NOW,
  });
  insert(db, 'courses', {
    id: 'c-3',
    semester_id: SEMESTER_ID,
    name: '大学英语',
    short_name: '大英',
    teacher: '王老师',
    location: '外语楼-302',
    color: '#27AE60',
    credits: 2,
    created_at: NOW,
    updated_at: NOW,
  });

  insert(db, 'course_schedules', {
    id: 's-1',
    course_id: 'c-1',
    day_of_week: 1,
    period_start: 1,
    period_end: 2,
    weeks_mask: weeksToMask(weekRange(1, 16)),
    weeks_raw: '1-16周',
    created_at: NOW,
    updated_at: NOW,
  });
  insert(db, 'course_schedules', {
    id: 's-2',
    course_id: 'c-2',
    day_of_week: 3,
    period_start: 3,
    period_end: 4,
    weeks_mask: weeksToMask(weekRange(2, 16, 2)),
    weeks_raw: '2-16周(双)',
    created_at: NOW,
    updated_at: NOW,
  });
  insert(db, 'course_schedules', {
    id: 's-3',
    course_id: 'c-3',
    day_of_week: 5,
    period_start: 5,
    period_end: 6,
    weeks_mask: weeksToMask([1, 3, 5, 7]),
    weeks_raw: '1,3,5,7周',
    created_at: NOW,
    updated_at: NOW,
  });
}

export function tableNames(db: SqlDriver): string[] {
  return db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .map((row) => row.name);
}
