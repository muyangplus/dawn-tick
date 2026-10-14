export type EventType = 'exam' | 'todo' | 'temp' | 'homework' | 'lab' | 'reschedule' | 'holiday' | 'makeup' | 'workday';
export type EventAction = 'move' | 'cancel' | 'room_change' | 'add';
/** 条目性质标签：课程 / 实验；为空时按类型推断。 */
export type EventNature = 'course' | 'lab';
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
  /** 自定义时间（HH:MM）：非空时按真实时间展示，节次按重叠关系回填 */
  start_time: string | null;
  end_time: string | null;
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
  /** 开启倒计时：为 1 时该条在倒计时卡片里显示剩余天数 */
  countdown: number;
  /** 需要手动确认完成：为 1 时不自动完成，过期也留在待办列表 */
  manual_done: number;
  /** 条目性质标签覆盖；为空时按类型推断 */
  nature: EventNature | null;
  priority: number | null;
  due_at: number | null;
  subject: string | null;
  seat_no: string | null;
  /** 实验节次（仅 type = 'lab'） */
  period_start: number | null;
  period_end: number | null;
  /** 实验重复周次位图（仅 type = 'lab'）；为空表示只这一次，用 on_date */
  weeks_mask: number | null;
  /** 自定义时间（HH:MM）：非空时该条按真实时间展示，不按节次 */
  start_time: string | null;
  end_time: string | null;
  /** 是否显示在课表上：日程/作业/考试由开关决定，实验默认显示 */
  show_in_timetable: number;
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
  schedule_id: string;
  course_id: string;
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
