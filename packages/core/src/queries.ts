import type { SqlDriver } from './db.ts';
import type {
  CourseRow,
  CourseScheduleRow,
  DayKindRow,
  EventRow,
  SemesterRow,
  TimeSlotRow,
  WeekViewRow,
} from './types.ts';
import type { ExpandCourse, ExpandDayKind, ExpandReschedule, ExpandSchedule, ExpandTimeSlot } from './expand.ts';

export const WEEK_VIEW_SQL = `
SELECT c.name AS name,
       c.short_name AS short_name,
       c.color AS color,
       cs.period_start AS period_start,
       cs.period_end AS period_end,
       COALESCE(cs.room, c.location) AS room
FROM course_schedules cs
JOIN courses c ON c.id = cs.course_id
WHERE c.semester_id = ?
  AND cs.day_of_week = ?
  AND (cs.weeks_mask >> (? - 1)) & 1 = 1
  AND cs.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY cs.period_start`;

export const DAY_KIND_SQL = `
SELECT type AS type, as_day_of_week AS as_day_of_week, source AS source
FROM events
WHERE semester_id = ? AND on_date = ?
  AND type IN ('holiday','makeup','workday') AND deleted_at IS NULL
ORDER BY CASE source WHEN 'manual' THEN 1 WHEN 'from_school' THEN 2 ELSE 3 END
LIMIT 1`;

export function weekView(db: SqlDriver, semesterId: string, dayOfWeek: number, week: number): WeekViewRow[] {
  return db.all<WeekViewRow>(WEEK_VIEW_SQL, [semesterId, dayOfWeek, week]);
}

export function dayKindForDate(db: SqlDriver, semesterId: string, date: string): DayKindRow | undefined {
  return db.get<DayKindRow>(DAY_KIND_SQL, [semesterId, date]);
}

export function activeSemester(db: SqlDriver, userId: string): SemesterRow | undefined {
  return db.get<SemesterRow>(
    'SELECT * FROM semesters WHERE user_id = ? AND is_active = 1 AND deleted_at IS NULL',
    [userId],
  );
}

export function loadSemester(db: SqlDriver, semesterId: string): SemesterRow | undefined {
  return db.get<SemesterRow>('SELECT * FROM semesters WHERE id = ? AND deleted_at IS NULL', [semesterId]);
}

export function loadSchedules(db: SqlDriver, semesterId: string): ExpandSchedule[] {
  return db
    .all<CourseScheduleRow>(
      `SELECT cs.id, cs.course_id, cs.day_of_week, cs.period_start, cs.period_end,
              cs.weeks_mask, cs.room
       FROM course_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE c.semester_id = ? AND cs.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [semesterId],
    )
    .map((row) => ({
      id: row.id,
      course_id: row.course_id,
      day_of_week: row.day_of_week,
      period_start: row.period_start,
      period_end: row.period_end,
      weeks_mask: row.weeks_mask,
      room: row.room,
    }));
}

export function loadCourses(db: SqlDriver, semesterId: string): ExpandCourse[] {
  return db
    .all<CourseRow>(
      'SELECT * FROM courses WHERE semester_id = ? AND deleted_at IS NULL',
      [semesterId],
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      short_name: row.short_name,
      location: row.location,
      color: row.color,
    }));
}

export function loadTimeSlots(db: SqlDriver, semesterId: string): ExpandTimeSlot[] {
  return db
    .all<TimeSlotRow>(
      `SELECT period_no, start_time, end_time FROM time_slots
       WHERE semester_id = ? AND deleted_at IS NULL ORDER BY period_no`,
      [semesterId],
    )
    .map((row) => ({
      period_no: row.period_no,
      start_time: row.start_time,
      end_time: row.end_time,
    }));
}

export function loadDayKinds(db: SqlDriver, semesterId: string, from: string, to: string): ExpandDayKind[] {
  return db
    .all<ExpandDayKind>(
      `SELECT on_date, type, as_day_of_week, source FROM events
       WHERE semester_id = ? AND type IN ('holiday','makeup','workday')
         AND on_date BETWEEN ? AND ? AND deleted_at IS NULL`,
      [semesterId, from, to],
    );
}

export function loadReschedules(db: SqlDriver, semesterId: string, from: string, to: string): ExpandReschedule[] {
  return db
    .all<ExpandReschedule>(
      `SELECT e.ref_schedule_id, e.on_date, e.action, e.new_date,
              e.new_period_start, e.new_period_end, e.new_room
       FROM events e
       JOIN course_schedules cs ON cs.id = e.ref_schedule_id
       JOIN courses c ON c.id = cs.course_id
       WHERE c.semester_id = ? AND e.type = 'reschedule'
         AND e.on_date BETWEEN ? AND ? AND e.deleted_at IS NULL`,
      [semesterId, from, to],
    );
}
