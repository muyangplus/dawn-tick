import type { StoreName } from './storage.ts';

type Row = Record<string, unknown>;

/**
 * 驼峰字段名到真实列名的映射层。
 *
 * 背景：业务层的对外输入用驼峰（`CreateCourseInput.shortName`），而表结构用
 * 下划线（`courses.short_name`）。SqliteCollection.put 又是拿对象键当列名的，
 * 所以任何驼峰字段直接进 SQL 都会报 `table X has no column named Y`。
 * 这一层把「对象键」翻译成「真实列名」，并且不接受拼错的列名。
 *
 * 唯一的事实来源是 src/schema/001_init.sql；columns.test.ts 用 PRAGMA
 * table_info 与 DDL 对拍，下面这张表与建表语句脱节时测试会红。
 */
export const TABLE_COLUMNS: Record<StoreName, readonly string[]> = {
  users: ['id', 'nickname', 'created_at', 'updated_at', 'deleted_at', 'rev', 'dirty'],
  semesters: [
    'id',
    'user_id',
    'name',
    'start_date',
    'total_weeks',
    'time_zone',
    'is_active',
    'created_at',
    'updated_at',
    'deleted_at',
    'rev',
    'dirty',
  ],
  time_slots: [
    'id',
    'semester_id',
    'period_no',
    'start_time',
    'end_time',
    'label',
    'section',
    'created_at',
    'updated_at',
    'deleted_at',
    'rev',
    'dirty',
  ],
  courses: [
    'id',
    'semester_id',
    'name',
    'short_name',
    'teacher',
    'location',
    'color',
    'credits',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
    'rev',
    'dirty',
  ],
  course_schedules: [
    'id',
    'course_id',
    'day_of_week',
    'period_start',
    'period_end',
    'weeks_mask',
    'weeks_raw',
    'room',
    'start_time',
    'end_time',
    'created_at',
    'updated_at',
    'deleted_at',
    'rev',
    'dirty',
  ],
  events: [
    'id',
    'user_id',
    'semester_id',
    'parent_id',
    'type',
    'title',
    'on_date',
    'start_at',
    'end_at',
    'all_day',
    'location',
    'note',
    'done',
    'countdown',
    'manual_done',
    'nature',
    'priority',
    'due_at',
    'subject',
    'seat_no',
    'period_start',
    'period_end',
    'weeks_mask',
    'start_time',
    'end_time',
    'ref_schedule_id',
    'action',
    'new_date',
    'new_period_start',
    'new_period_end',
    'new_room',
    'as_day_of_week',
    'source',
    'created_at',
    'updated_at',
    'deleted_at',
    'rev',
    'dirty',
  ],
  reminders: [
    'id',
    'user_id',
    'target_type',
    'target_id',
    'advance_minutes',
    'enabled',
    'skip_holidays',
    'sound',
    'vibrate',
    'dnd',
    'snooze_minutes',
    'created_at',
    'updated_at',
    'deleted_at',
    'rev',
    'dirty',
  ],
  app_meta: ['key', 'value'],
};

/**
 * 显式列名映射：业务层公开的驼峰字段 → 表里的真实列名。
 * 例如 courses 的 `shortName` 对应 `short_name`，`semesterId` 对应 `semester_id`。
 * 没有列在这里的名字会走 camelToSnake 通用转换，转换结果仍须是真实列名。
 */
export const COLUMN_ALIASES: Record<StoreName, Readonly<Record<string, string>>> = {
  users: {},
  semesters: {
    userId: 'user_id',
    startDate: 'start_date',
    totalWeeks: 'total_weeks',
    timeZone: 'time_zone',
    isActive: 'is_active',
  },
  time_slots: {
    semesterId: 'semester_id',
    periodNo: 'period_no',
    startTime: 'start_time',
    endTime: 'end_time',
  },
  courses: {
    semesterId: 'semester_id',
    shortName: 'short_name',
  },
  course_schedules: {
    courseId: 'course_id',
    dayOfWeek: 'day_of_week',
    periodStart: 'period_start',
    periodEnd: 'period_end',
    weeksMask: 'weeks_mask',
    weeksRaw: 'weeks_raw',
    startTime: 'start_time',
    endTime: 'end_time',
  },
  events: {
    userId: 'user_id',
    semesterId: 'semester_id',
    parentId: 'parent_id',
    onDate: 'on_date',
    startAt: 'start_at',
    endAt: 'end_at',
    allDay: 'all_day',
    manualDone: 'manual_done',
    dueAt: 'due_at',
    seatNo: 'seat_no',
    periodStart: 'period_start',
    periodEnd: 'period_end',
    weeksMask: 'weeks_mask',
    startTime: 'start_time',
    endTime: 'end_time',
    refScheduleId: 'ref_schedule_id',
    newDate: 'new_date',
    newPeriodStart: 'new_period_start',
    newPeriodEnd: 'new_period_end',
    newRoom: 'new_room',
    asDayOfWeek: 'as_day_of_week',
  },
  reminders: {
    userId: 'user_id',
    targetType: 'target_type',
    targetId: 'target_id',
    advanceMinutes: 'advance_minutes',
    skipHolidays: 'skip_holidays',
    snoozeMinutes: 'snooze_minutes',
  },
  app_meta: {},
};

/** `shortName` → `short_name`、`asDayOfWeek` → `as_day_of_week`。 */
export function camelToSnake(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** 名字已经是真实列名时原样返回；驼峰映射不存在的列时返回 null。 */
export function toColumnName(store: StoreName, key: string): string | null {
  const columns = TABLE_COLUMNS[store];
  if (columns.includes(key)) return key;

  const alias = COLUMN_ALIASES[store][key];
  if (alias !== undefined && columns.includes(alias)) return alias;

  const snake = camelToSnake(key);
  if (snake !== key && columns.includes(snake)) return snake;

  return null;
}

/** 把一行的键全部翻译成真实列名；出现不存在的列时直接抛错而不是交给 SQLite。 */
export function normalizeRow(store: StoreName, row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    const column = toColumnName(store, key);
    if (column === null) {
      throw new TypeError(`${store} 没有列 "${key}"（可用列：${TABLE_COLUMNS[store].join(', ')}）`);
    }
    out[column] = value;
  }
  return out;
}
