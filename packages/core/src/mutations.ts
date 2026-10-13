import { normalizeRow } from './columns.ts';
import { DEFAULT_TIME_ZONE } from './time.ts';
import { addMinutes, parseClock, sectionOf } from './timetable.ts';
import { maskToWeeks, weeksToMask } from './weeks.ts';
import type { Storage } from './storage.ts';
import { assertValid } from './validation.ts';
import type { EventNature, EventType, HolidaySource, PeriodSection, ReminderTargetType } from './types.ts';

type Row = Record<string, unknown>;

export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  const cryptoObject = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (typeof cryptoObject?.getRandomValues === 'function') cryptoObject.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);

  const stamp = BigInt(nowMs);
  bytes[0] = Number((stamp >> 40n) & 0xffn);
  bytes[1] = Number((stamp >> 32n) & 0xffn);
  bytes[2] = Number((stamp >> 24n) & 0xffn);
  bytes[3] = Number((stamp >> 16n) & 0xffn);
  bytes[4] = Number((stamp >> 8n) & 0xffn);
  bytes[5] = Number(stamp & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface WriteOptions {
  now?: () => number;
  id?: () => string;
}

interface Context {
  storage: Storage;
  now: () => number;
  id: () => string;
}

function context(storage: Storage, options: WriteOptions = {}): Context {
  return {
    storage,
    now: options.now ?? (() => Date.now()),
    id: options.id ?? (() => uuidv7()),
  };
}

/**
 * 写入前把对象键翻译成真实列名。
 * 对外输入是驼峰（shortName、startDate…），表里是下划线（short_name、start_date…），
 * 不翻译的话 SQLite 会报 `table X has no column named Y`。
 */
async function insert(ctx: Context, store: Parameters<Storage['collection']>[0], row: Row): Promise<Row> {
  const values = normalizeRow(store, row);
  await assertValid(ctx.storage, store, values);
  await ctx.storage.collection(store).put(values);
  return values;
}

async function patch(
  ctx: Context,
  store: Parameters<Storage['collection']>[0],
  id: string,
  changes: Row,
): Promise<Row> {
  const existing = await ctx.storage.collection<Row>(store).get(id);
  if (existing === undefined) throw new Error(`${store} 不存在: ${id}`);
  const updated: Row = {
    ...existing,
    ...normalizeRow(store, changes),
    updated_at: ctx.now(),
    rev: Number(existing['rev'] ?? 0) + 1,
    dirty: 1,
  };
  await assertValid(ctx.storage, store, updated);
  await ctx.storage.collection(store).put(updated);
  return updated;
}

async function remove(
  ctx: Context,
  store: Parameters<Storage['collection']>[0],
  id: string,
): Promise<void> {
  const existing = await ctx.storage.collection<Row>(store).get(id);
  if (existing === undefined) return;
  const removed: Row = {
    ...existing,
    deleted_at: ctx.now(),
    updated_at: ctx.now(),
    rev: Number(existing['rev'] ?? 0) + 1,
    dirty: 1,
  };
  await assertValid(ctx.storage, store, removed);
  await ctx.storage.collection(store).put(removed);
}

async function dropReminders(ctx: Context, targetType: ReminderTargetType, targetId: string): Promise<void> {
  const rows = await ctx.storage.collection<Row>('reminders').getAll();
  for (const row of rows) {
    if (row['deleted_at'] !== null) continue;
    if (row['target_type'] !== targetType || row['target_id'] !== targetId) continue;
    await remove(ctx, 'reminders', String(row['id']));
  }
}

export async function ensureUser(
  storage: Storage,
  userId: string,
  nickname = '我',
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  const existing = await storage.collection<Row>('users').get(userId);
  if (existing !== undefined) return existing;
  return insert(ctx, 'users', {
    id: userId,
    nickname,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });
}

export interface CreateSemesterInput {
  userId: string;
  name: string;
  startDate: string;
  totalWeeks?: number;
  timeZone?: string;
  isActive?: boolean;
  withDefaultTimeSlots?: boolean;
}

/** 默认节次模板：上午 4 节、下午 4 节、晚上 2 节。 */
export const DEFAULT_PERIODS: ReadonlyArray<{
  periodNo: number;
  startTime: string;
  endTime: string;
  section: 'am' | 'pm' | 'night';
}> = [
  { periodNo: 1, startTime: '08:00', endTime: '08:45', section: 'am' },
  { periodNo: 2, startTime: '08:55', endTime: '09:40', section: 'am' },
  { periodNo: 3, startTime: '10:00', endTime: '10:45', section: 'am' },
  { periodNo: 4, startTime: '10:55', endTime: '11:40', section: 'am' },
  { periodNo: 5, startTime: '14:00', endTime: '14:45', section: 'pm' },
  { periodNo: 6, startTime: '14:55', endTime: '15:40', section: 'pm' },
  { periodNo: 7, startTime: '16:00', endTime: '16:45', section: 'pm' },
  { periodNo: 8, startTime: '16:55', endTime: '17:40', section: 'pm' },
  { periodNo: 9, startTime: '19:00', endTime: '19:45', section: 'night' },
  { periodNo: 10, startTime: '19:55', endTime: '20:40', section: 'night' },
];

export async function seedDefaultTimeSlots(
  storage: Storage,
  semesterId: string,
  options: WriteOptions = {},
): Promise<Row[]> {
  return replaceTimeSlots(storage, semesterId, DEFAULT_PERIODS, options);
}

export interface PeriodInput {
  periodNo: number;
  startTime: string;
  endTime: string;
  section: PeriodSection;
  label?: string | null;
}

/** 用给定课次替换整个时间表；被课次引用的排课不会被删除。 */
export async function replaceTimeSlots(
  storage: Storage,
  semesterId: string,
  periods: readonly PeriodInput[],
  options: WriteOptions = {},
): Promise<Row[]> {
  const ctx = context(storage, options);
  const existing = (await storage.collection<Row>('time_slots').getAll()).filter(
    (row) => isAlive(row) && row['semester_id'] === semesterId,
  );
  for (const row of existing) await remove(ctx, 'time_slots', String(row['id']));

  const rows: Row[] = [];
  for (const period of periods) {
    rows.push(
      await insert(ctx, 'time_slots', {
        id: ctx.id(),
        semester_id: semesterId,
        period_no: period.periodNo,
        start_time: period.startTime,
        end_time: period.endTime,
        label: period.label ?? null,
        section: period.section,
        created_at: ctx.now(),
        updated_at: ctx.now(),
        deleted_at: null,
        rev: 0,
        dirty: 1,
      }),
    );
  }
  return rows;
}

async function aliveTimeSlots(storage: Storage, semesterId: string): Promise<Row[]> {
  const rows = (await storage.collection<Row>('time_slots').getAll()).filter(
    (row) => isAlive(row) && row['semester_id'] === semesterId,
  );
  return rows.sort((left, right) => Number(left['period_no']) - Number(right['period_no']));
}

/** 在末尾追加一节；时间取最后一节的结束时间加课间，时长为固定上课时长。 */
export async function appendTimeSlot(
  storage: Storage,
  semesterId: string,
  durationMinutes: number,
  breakMinutes: number,
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  const existing = await aliveTimeSlots(storage, semesterId);
  const last = existing.at(-1);
  const duration = Math.max(10, Math.round(durationMinutes));
  const gap = Math.max(0, Math.round(breakMinutes));
  const startTime = last === undefined ? '08:00' : addMinutes(String(last['end_time']), gap);
  const periodNo = last === undefined ? 1 : Number(last['period_no']) + 1;
  if (periodNo > 30) throw new Error('课次不能超过 30 节');
  return insert(ctx, 'time_slots', {
    id: ctx.id(),
    semester_id: semesterId,
    period_no: periodNo,
    start_time: startTime,
    end_time: addMinutes(startTime, duration),
    label: null,
    section: sectionOf(startTime),
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });
}

/** 修改单节课次的时间；用于大课间等个别调整。 */
export async function updateTimeSlot(
  storage: Storage,
  id: string,
  changes: { startTime?: string; endTime?: string; label?: string | null },
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  const patchRow: Row = {};
  if (changes.startTime !== undefined) {
    parseClock(changes.startTime);
    patchRow['start_time'] = changes.startTime;
    patchRow['section'] = sectionOf(changes.startTime);
  }
  if (changes.endTime !== undefined) {
    parseClock(changes.endTime);
    patchRow['end_time'] = changes.endTime;
  }
  if (changes.label !== undefined) patchRow['label'] = changes.label;
  if (Object.keys(patchRow).length === 0) {
    const existing = await storage.collection<Row>('time_slots').get(id);
    if (existing === undefined) throw new Error(`time_slots 不存在: ${id}`);
    return existing;
  }
  return patch(ctx, 'time_slots', id, patchRow);
}

/** 删除一节；被排课引用时拒绝，返回引用数量。 */
export async function deleteTimeSlot(
  storage: Storage,
  semesterId: string,
  periodNo: number,
  options: WriteOptions = {},
): Promise<{ deleted: boolean; usedBy: number }> {
  const ctx = context(storage, options);
  const courses = (await storage.collection<Row>('courses').getAll())
    .filter((row) => isAlive(row) && row['semester_id'] === semesterId)
    .map((row) => String(row['id']));
  const usedBy = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) =>
      isAlive(row) &&
      courses.includes(String(row['course_id'])) &&
      Number(row['period_start']) <= periodNo &&
      Number(row['period_end']) >= periodNo,
  ).length;
  if (usedBy > 0) return { deleted: false, usedBy };

  const target = (await aliveTimeSlots(storage, semesterId)).find(
    (row) => Number(row['period_no']) === periodNo,
  );
  if (target === undefined) return { deleted: false, usedBy: 0 };
  await remove(ctx, 'time_slots', String(target['id']));
  return { deleted: true, usedBy: 0 };
}

export async function createSemester(
  storage: Storage,
  input: CreateSemesterInput,
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  await ensureUser(storage, input.userId, '我', options);
  if (input.isActive !== false) {
    const rows = await storage.collection<Row>('semesters').getAll();
    for (const row of rows) {
      if (row['deleted_at'] !== null || row['user_id'] !== input.userId || row['is_active'] !== 1) continue;
      await patch(ctx, 'semesters', String(row['id']), { is_active: 0 });
    }
  }
  const created = await insert(ctx, 'semesters', {
    id: ctx.id(),
    user_id: input.userId,
    name: input.name,
    start_date: input.startDate,
    total_weeks: input.totalWeeks ?? 20,
    time_zone: input.timeZone ?? DEFAULT_TIME_ZONE,
    is_active: input.isActive === false ? 0 : 1,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });

  if (input.withDefaultTimeSlots !== false) {
    await seedDefaultTimeSlots(storage, String(created['id']), options);
  }
  return created;
}

export async function updateSemester(
  storage: Storage,
  id: string,
  changes: Row,
  options: WriteOptions = {},
): Promise<Row> {
  return patch(context(storage, options), 'semesters', id, changes);
}

export async function deleteSemester(storage: Storage, id: string, options: WriteOptions = {}): Promise<void> {
  await remove(context(storage, options), 'semesters', id);
}

export interface SemesterDeleteReport {
  courses: number;
  schedules: number;
  slots: number;
  events: number;
  reminders: number;
}

function isAlive(row: Row): boolean {
  return row['deleted_at'] === null || row['deleted_at'] === undefined;
}

/**
 * 删除学期并连带删除其课程、排课、节次、日程与提醒。
 * 删除当前学期后自动切到最近开学的一个；没有剩余学期时由界面回到引导页。
 */
export async function deleteSemesterDeep(
  storage: Storage,
  id: string,
  options: WriteOptions = {},
): Promise<SemesterDeleteReport> {
  const ctx = context(storage, options);
  const semester = await storage.collection<Row>('semesters').get(id);
  if (semester === undefined || !isAlive(semester)) {
    return { courses: 0, schedules: 0, slots: 0, events: 0, reminders: 0 };
  }

  const courses = (await storage.collection<Row>('courses').getAll()).filter(
    (row) => isAlive(row) && row['semester_id'] === id,
  );
  const courseIds = new Set(courses.map((row) => String(row['id'])));
  const schedules = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) => isAlive(row) && courseIds.has(String(row['course_id'])),
  );
  const scheduleIds = new Set(schedules.map((row) => String(row['id'])));
  const slots = (await storage.collection<Row>('time_slots').getAll()).filter(
    (row) => isAlive(row) && row['semester_id'] === id,
  );
  const events = (await storage.collection<Row>('events').getAll()).filter(
    (row) => isAlive(row) && row['semester_id'] === id,
  );
  const eventIds = new Set(events.map((row) => String(row['id'])));
  const reminders = (await storage.collection<Row>('reminders').getAll()).filter((row) => {
    if (!isAlive(row)) return false;
    const target = String(row['target_id']);
    if (row['target_type'] === 'course') return courseIds.has(target);
    if (row['target_type'] === 'schedule') return scheduleIds.has(target);
    if (row['target_type'] === 'event') return eventIds.has(target);
    return false;
  });

  for (const row of reminders) await remove(ctx, 'reminders', String(row['id']));
  for (const row of schedules) await remove(ctx, 'course_schedules', String(row['id']));
  for (const row of courses) await remove(ctx, 'courses', String(row['id']));
  for (const row of slots) await remove(ctx, 'time_slots', String(row['id']));
  for (const row of events) await remove(ctx, 'events', String(row['id']));

  const wasActive = semester['is_active'] === 1;
  const userId = semester['user_id'];
  await remove(ctx, 'semesters', id);

  if (wasActive) {
    const rest = (await storage.collection<Row>('semesters').getAll())
      .filter((row) => isAlive(row) && row['user_id'] === userId)
      .sort((left, right) => String(right['start_date']).localeCompare(String(left['start_date'])));
    const next = rest[0];
    if (next !== undefined) {
      await patch(ctx, 'semesters', String(next['id']), { is_active: 1 });
    }
  }

  return {
    courses: courses.length,
    schedules: schedules.length,
    slots: slots.length,
    events: events.length,
    reminders: reminders.length,
  };
}

export interface CreateCourseInput {
  semesterId: string;
  name: string;
  shortName?: string | null;
  teacher?: string | null;
  location?: string | null;
  color?: string;
  credits?: number | null;
  note?: string | null;
}

export async function createCourse(
  storage: Storage,
  input: CreateCourseInput,
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  return insert(ctx, 'courses', {
    id: ctx.id(),
    semester_id: input.semesterId,
    name: input.name,
    short_name: input.shortName ?? null,
    teacher: input.teacher ?? null,
    location: input.location ?? null,
    color: input.color ?? '#4F8DFD',
    credits: input.credits ?? null,
    note: input.note ?? null,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });
}

/**
 * 修改课程字段。changes 的键既可以是驼峰（`shortName`、`semesterId`），
 * 也可以是真实列名（`short_name`、`semester_id`），写入前统一翻译成列名。
 * 颜色走同一个入口：`updateCourse(storage, id, { color: '#F2994A', shortName: '高数' })`。
 */
export async function updateCourse(
  storage: Storage,
  id: string,
  changes: Row,
  options: WriteOptions = {},
): Promise<Row> {
  return patch(context(storage, options), 'courses', id, changes);
}

export async function deleteCourse(storage: Storage, id: string, options: WriteOptions = {}): Promise<void> {
  const ctx = context(storage, options);
  const schedules = await storage.collection<Row>('course_schedules').getAll();
  for (const schedule of schedules) {
    if (schedule['deleted_at'] !== null || schedule['course_id'] !== id) continue;
    await remove(ctx, 'course_schedules', String(schedule['id']));
  }
  await dropReminders(ctx, 'course', id);
  await remove(ctx, 'courses', id);
}

export interface CreateScheduleInput {
  courseId: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
  weeksRaw?: string | null;
  room?: string | null;
  /** 自定义时间（HH:MM）：非空时按真实时间展示，节次按重叠关系回填 */
  startTime?: string | null;
  endTime?: string | null;
}

export async function createSchedule(
  storage: Storage,
  input: CreateScheduleInput,
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  return insert(ctx, 'course_schedules', {
    id: ctx.id(),
    course_id: input.courseId,
    day_of_week: input.dayOfWeek,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    weeks_mask: weeksToMask(input.weeks),
    weeks_raw: input.weeksRaw ?? null,
    room: input.room ?? null,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });
}

export async function updateSchedule(
  storage: Storage,
  id: string,
  changes: Row,
  options: WriteOptions = {},
): Promise<Row> {
  return patch(context(storage, options), 'course_schedules', id, changes);
}

export async function deleteSchedule(storage: Storage, id: string, options: WriteOptions = {}): Promise<void> {
  const ctx = context(storage, options);
  await dropReminders(ctx, 'schedule', id);
  await remove(ctx, 'course_schedules', id);
}

export interface ScheduleInput {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: readonly number[];
  weeksRaw?: string | null;
  room?: string | null;
}

/** 用给定排课替换某门课的全部排课。 */
export async function setSchedules(
  storage: Storage,
  courseId: string,
  list: readonly ScheduleInput[],
  options: WriteOptions = {},
): Promise<Row[]> {
  const ctx = context(storage, options);
  const existing = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) => isAlive(row) && row['course_id'] === courseId,
  );
  for (const row of existing) await remove(ctx, 'course_schedules', String(row['id']));

  const rows: Row[] = [];
  for (const item of list) {
    rows.push(
      await insert(ctx, 'course_schedules', {
        id: ctx.id(),
        course_id: courseId,
        day_of_week: item.dayOfWeek,
        period_start: item.periodStart,
        period_end: item.periodEnd,
        weeks_mask: weeksToMask([...item.weeks]),
        weeks_raw: item.weeksRaw ?? null,
        room: item.room ?? null,
        created_at: ctx.now(),
        updated_at: ctx.now(),
        deleted_at: null,
        rev: 0,
        dirty: 1,
      }),
    );
  }
  return rows;
}

export interface ManagedSchedule {
  id: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
  room: string | null;
  /** 自定义时间（HH:MM）：非空时按真实时间展示 */
  startTime: string | null;
  endTime: string | null;
}

export interface ManagedCourse {
  id: string;
  name: string;
  shortName: string | null;
  teacher: string | null;
  location: string | null;
  color: string;
  credits: number | null;
  note: string | null;
  schedules: ManagedSchedule[];
}

/** 课程管理列表：课程及其全部排课。 */
export async function listManagedCourses(storage: Storage, semesterId: string): Promise<ManagedCourse[]> {
  const courses = (await storage.collection<Row>('courses').getAll())
    .filter((row) => isAlive(row) && row['semester_id'] === semesterId)
    .sort((left, right) => String(left['name']).localeCompare(String(right['name'])));
  const courseIds = new Set(courses.map((row) => String(row['id'])));
  const schedules = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) => isAlive(row) && courseIds.has(String(row['course_id'])),
  );

  return courses.map((course) => ({
    id: String(course['id']),
    name: String(course['name']),
    shortName: course['short_name'] === null ? null : String(course['short_name']),
    teacher: course['teacher'] === null ? null : String(course['teacher']),
    location: course['location'] === null ? null : String(course['location']),
    color: String(course['color']),
    credits: course['credits'] === null ? null : Number(course['credits']),
    note: course['note'] === null ? null : String(course['note']),
    schedules: schedules
      .filter((row) => row['course_id'] === course['id'])
      .map((row) => ({
        id: String(row['id']),
        dayOfWeek: Number(row['day_of_week']),
        periodStart: Number(row['period_start']),
        periodEnd: Number(row['period_end']),
        weeks: maskToWeeks(Number(row['weeks_mask'])),
        room: row['room'] === null ? null : String(row['room']),
        startTime: row['start_time'] === null || row['start_time'] === undefined ? null : String(row['start_time']),
        endTime: row['end_time'] === null || row['end_time'] === undefined ? null : String(row['end_time']),
      })),
  }));
}

export interface CreateEventInput {
  userId: string;
  type: EventType;
  title: string;
  semesterId?: string | null;
  onDate?: string | null;
  startAt?: number | null;
  endAt?: number | null;
  location?: string | null;
  note?: string | null;
  priority?: number | null;
  dueAt?: number | null;
  subject?: string | null;
  seatNo?: string | null;
  parentId?: string | null;
  source?: HolidaySource | null;
  asDayOfWeek?: number | null;
  /** 开启倒计时：在倒计时卡片里显示剩余天数 */
  countdown?: boolean;
  /** 需要手动确认完成：不自动完成，过期也留在待办列表 */
  manualDone?: boolean;
  /** 性质标签覆盖（课程 / 实验） */
  nature?: EventNature | null;
  /** 实验节次（type = 'lab' 时必填） */
  periodStart?: number | null;
  periodEnd?: number | null;
  /** 实验重复周次位图；为空表示只这一次 */
  weeksMask?: number | null;
  /** 自定义时间（HH:MM）：非空时该条按真实时间展示，不按节次 */
  startTime?: string | null;
  endTime?: string | null;
}

export async function createEvent(
  storage: Storage,
  input: CreateEventInput,
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  return insert(ctx, 'events', {
    id: ctx.id(),
    user_id: input.userId,
    semester_id: input.semesterId ?? null,
    parent_id: input.parentId ?? null,
    type: input.type,
    title: input.title,
    on_date: input.onDate ?? null,
    start_at: input.startAt ?? null,
    end_at: input.endAt ?? null,
    all_day: 0,
    location: input.location ?? null,
    note: input.note ?? null,
    done: 0,
    countdown: input.countdown === true ? 1 : 0,
    manual_done: input.manualDone === true ? 1 : 0,
    nature: input.nature ?? null,
    priority: input.priority ?? null,
    due_at: input.dueAt ?? null,
    subject: input.subject ?? null,
    seat_no: input.seatNo ?? null,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    weeks_mask: input.weeksMask ?? null,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    ref_schedule_id: null,
    action: null,
    new_date: null,
    new_period_start: null,
    new_period_end: null,
    new_room: null,
    as_day_of_week: input.asDayOfWeek ?? null,
    source: input.source ?? null,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });
}

export async function updateEvent(
  storage: Storage,
  id: string,
  changes: Row,
  options: WriteOptions = {},
): Promise<Row> {
  return patch(context(storage, options), 'events', id, changes);
}

export interface CreateRescheduleInput {
  userId: string;
  semesterId: string;
  refScheduleId: string;
  onDate: string;
  action: 'move' | 'cancel' | 'swap';
  title?: string;
  newDate?: string | null;
  newPeriodStart?: number | null;
  newPeriodEnd?: number | null;
  newRoom?: string | null;
  asDayOfWeek?: number | null;
}

/** 记录一次调课：只影响 on_date 那一天的原课次。 */
export async function createReschedule(
  storage: Storage,
  input: CreateRescheduleInput,
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  const created = await insert(ctx, 'events', {
    id: ctx.id(),
    user_id: input.userId,
    semester_id: input.semesterId,
    parent_id: null,
    type: 'reschedule',
    title: input.title ?? (input.action === 'cancel' ? '停课' : '调课'),
    on_date: input.onDate,
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
    ref_schedule_id: input.refScheduleId,
    action: input.action,
    new_date: input.newDate ?? null,
    new_period_start: input.newPeriodStart ?? null,
    new_period_end: input.newPeriodEnd ?? null,
    new_room: input.newRoom ?? null,
    as_day_of_week: input.asDayOfWeek ?? null,
    source: null,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });
  return created;
}

export async function listReschedules(
  storage: Storage,
  refScheduleId: string,
  onDate: string,
): Promise<Row[]> {
  const rows = await storage.collection<Row>('events').getAll();
  return rows.filter(
    (row) =>
      row['deleted_at'] === null &&
      row['type'] === 'reschedule' &&
      row['ref_schedule_id'] === refScheduleId &&
      row['on_date'] === onDate,
  );
}

/** 撤销某天已记录的调课，返回撤销条数。 */
export async function clearReschedules(
  storage: Storage,
  refScheduleId: string,
  onDate: string,
  options: WriteOptions = {},
): Promise<number> {
  const matched = await listReschedules(storage, refScheduleId, onDate);
  for (const row of matched) {
    await deleteEvent(storage, String(row['id']), options);
  }
  return matched.length;
}

export async function deleteEvent(storage: Storage, id: string, options: WriteOptions = {}): Promise<void> {  const ctx = context(storage, options);
  const events = await storage.collection<Row>('events').getAll();
  for (const event of events) {
    if (event['deleted_at'] !== null || event['parent_id'] !== id) continue;
    await remove(ctx, 'events', String(event['id']));
  }
  await dropReminders(ctx, 'event', id);
  await remove(ctx, 'events', id);
}

export interface SetReminderInput {
  userId: string;
  targetType: ReminderTargetType;
  targetId: string;
  advanceMinutes?: number;
  enabled?: boolean;
  skipHolidays?: boolean;
  sound?: boolean;
  vibrate?: boolean;
  dnd?: 0 | 1 | 2;
  snoozeMinutes?: number | null;
}

/** 同一目标只保留一条提醒，再设置时覆盖。 */
export async function setReminder(
  storage: Storage,
  input: SetReminderInput,
  options: WriteOptions = {},
): Promise<Row> {
  const ctx = context(storage, options);
  const rows = await storage.collection<Row>('reminders').getAll();
  const existing = rows.find(
    (row) =>
      row['deleted_at'] === null &&
      row['target_type'] === input.targetType &&
      row['target_id'] === input.targetId,
  );

  const values: Row = {
    advance_minutes: input.advanceMinutes ?? 10,
    enabled: (input.enabled ?? true) ? 1 : 0,
    skip_holidays: (input.skipHolidays ?? true) ? 1 : 0,
    sound: (input.sound ?? true) ? 1 : 0,
    vibrate: (input.vibrate ?? true) ? 1 : 0,
    dnd: input.dnd ?? 0,
    snooze_minutes: input.snoozeMinutes ?? null,
  };

  if (existing !== undefined) return patch(ctx, 'reminders', String(existing['id']), values);

  return insert(ctx, 'reminders', {
    id: ctx.id(),
    user_id: input.userId,
    target_type: input.targetType,
    target_id: input.targetId,
    ...values,
    created_at: ctx.now(),
    updated_at: ctx.now(),
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });
}

export async function deleteReminder(storage: Storage, id: string, options: WriteOptions = {}): Promise<void> {
  await remove(context(storage, options), 'reminders', id);
}
