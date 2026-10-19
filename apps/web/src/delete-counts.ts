import type { Storage } from '@dawn-tick/core';

/** 删除确认句里要用到的行数：按当前库里的可见行统计。 */

type Row = Record<string, unknown>;

function alive(row: Row): boolean {
  return row['deleted_at'] === null || row['deleted_at'] === undefined;
}

export interface SemesterCounts {
  courses: number;
  schedules: number;
  events: number;
  reminders: number;
}

export interface CourseCounts {
  schedules: number;
  reminders: number;
}

async function reminderRows(storage: Storage): Promise<Row[]> {
  return storage.collection<Row>('reminders').getAll();
}

export async function countForCourse(storage: Storage, courseId: string): Promise<CourseCounts> {
  const schedules = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) => alive(row) && String(row['course_id']) === courseId,
  );
  const scheduleIds = new Set(schedules.map((row) => String(row['id'])));
  const reminders = (await reminderRows(storage)).filter((row) => {
    const target = String(row['target_id'] ?? '');
    return (
      (row['target_type'] === 'course' && target === courseId) ||
      (row['target_type'] === 'schedule' && scheduleIds.has(target))
    );
  });
  return { schedules: schedules.length, reminders: reminders.length };
}

export async function countForSemester(storage: Storage, semesterId: string): Promise<SemesterCounts> {
  const courses = (await storage.collection<Row>('courses').getAll()).filter(
    (row) => alive(row) && row['semester_id'] === semesterId,
  );
  const courseIds = new Set(courses.map((row) => String(row['id'])));
  const schedules = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) => alive(row) && courseIds.has(String(row['course_id'])),
  );
  const scheduleIds = new Set(schedules.map((row) => String(row['id'])));
  const events = (await storage.collection<Row>('events').getAll()).filter(
    (row) => alive(row) && row['semester_id'] === semesterId,
  );
  const reminders = (await reminderRows(storage)).filter((row) => {
    const target = String(row['target_id'] ?? '');
    return (
      (row['target_type'] === 'course' && courseIds.has(target)) ||
      (row['target_type'] === 'schedule' && scheduleIds.has(target))
    );
  });
  return {
    courses: courses.length,
    schedules: schedules.length,
    events: events.length,
    reminders: reminders.length,
  };
}
