export type EventType = 'exam' | 'todo' | 'temp' | 'reschedule' | 'holiday' | 'makeup' | 'workday';
export type EventAction = 'move' | 'cancel' | 'room_change' | 'add';
export type HolidaySource = 'builtin' | 'manual' | 'from_school';
export type ReminderTargetType = 'course' | 'schedule' | 'event';
export type PeriodSection = 'am' | 'pm' | 'night';

export interface SyncColumns {
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  rev: number;
  dirty: number;
}

export interface UserRow extends SyncColumns {
  id: string;
  nickname: string;
}

export interface SemesterRow extends SyncColumns {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  total_weeks: number;
  time_zone: string;
  is_active: number;
}

export interface TimeSlotRow extends SyncColumns {
  id: string;
  semester_id: string;
  period_no: number;
  start_time: string;
  end_time: string;
  label: string | null;
  section: PeriodSection | null;
}

export interface CourseRow extends SyncColumns {
  id: string;
  semester_id: string;
  name: string;
  short_name: string | null;
  teacher: string | null;
  location: string | null;
  color: string;
  credits: number | null;
  note: string | null;
}

export interface CourseScheduleRow extends SyncColumns {
  id: string;
  course_id: string;
  day_of_week: number;
  period_start: number;
  period_end: number;
  weeks_mask: number;
  weeks_raw: string | null;
  room: string | null;
}

export interface EventRow extends SyncColumns {
  id: string;
  user_id: string;
  semester_id: string | null;
  parent_id: string | null;
  type: EventType;
  title: string;
  on_date: string | null;
  start_at: number | null;
  end_at: number | null;
  all_day: number;
  location: string | null;
  note: string | null;
  done: number;
  priority: number | null;
  due_at: number | null;
  subject: string | null;
  seat_no: string | null;
  ref_schedule_id: string | null;
  action: EventAction | null;
  new_date: string | null;
  new_period_start: number | null;
  new_period_end: number | null;
  new_room: string | null;
  as_day_of_week: number | null;
  source: HolidaySource | null;
}

export interface ReminderRow extends SyncColumns {
  id: string;
  user_id: string;
  target_type: ReminderTargetType;
  target_id: string;
  advance_minutes: number;
  enabled: number;
  skip_holidays: number;
  sound: number;
  vibrate: number;
  dnd: number;
  snooze_minutes: number | null;
}

export interface WeekViewRow {
  name: string;
  short_name: string | null;
  color: string;
  period_start: number;
  period_end: number;
  room: string | null;
}

export interface DayKindRow {
  type: EventType;
  as_day_of_week: number | null;
  source: HolidaySource | null;
}
