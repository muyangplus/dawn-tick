import type { SqlDriver } from '@dawn-tick/core';
import { weeksToMask } from '@dawn-tick/core';

const NOW = Date.now();
export const SAMPLE_USER = 'u1';
export const SAMPLE_SEMESTER = 'sem-1';

function insert(db: SqlDriver, table: string, row: Record<string, string | number | null>): void {
  const columns = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
    columns.map((column) => row[column] as string | number | null),
  );
}

function weekRange(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let week = from; week <= to; week += step) out.push(week);
  return out;
}

export function seedSample(db: SqlDriver, startDate: string, timeZone: string): void {
  insert(db, 'users', { id: SAMPLE_USER, nickname: '我', created_at: NOW, updated_at: NOW });
  insert(db, 'semesters', {
    id: SAMPLE_SEMESTER,
    user_id: SAMPLE_USER,
    name: '示例学期',
    start_date: startDate,
    total_weeks: 20,
    time_zone: timeZone,
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
      semester_id: SAMPLE_SEMESTER,
      period_no: periodNo,
      start_time: startTime,
      end_time: endTime,
      section,
      created_at: NOW,
      updated_at: NOW,
    });
  }

  const courses: Array<[string, string, string, string, string, string, number]> = [
    ['c-1', '高等数学', '高数', '张老师', '教三-201', '#4F8DFD', 5],
    ['c-2', '大学物理', '大物', '李老师', '理科楼-105', '#F2994A', 3.5],
    ['c-3', '大学英语', '大英', '王老师', '外语楼-302', '#27AE60', 2],
  ];
  for (const [id, name, shortName, teacher, location, color, credits] of courses) {
    insert(db, 'courses', {
      id,
      semester_id: SAMPLE_SEMESTER,
      name,
      short_name: shortName,
      teacher,
      location,
      color,
      credits,
      created_at: NOW,
      updated_at: NOW,
    });
  }

  const schedules: Array<[string, string, number, number, number, number[], string]> = [
    ['s-1', 'c-1', 1, 1, 2, weekRange(1, 16), '1-16周'],
    ['s-2', 'c-2', 3, 3, 4, weekRange(2, 16, 2), '2-16周(双)'],
    ['s-3', 'c-3', 5, 5, 6, [1, 3, 5, 7], '1,3,5,7周'],
  ];
  for (const [id, courseId, dayOfWeek, periodStart, periodEnd, weeks, weeksRaw] of schedules) {
    insert(db, 'course_schedules', {
      id,
      course_id: courseId,
      day_of_week: dayOfWeek,
      period_start: periodStart,
      period_end: periodEnd,
      weeks_mask: weeksToMask(weeks),
      weeks_raw: weeksRaw,
      created_at: NOW,
      updated_at: NOW,
    });
  }
}
