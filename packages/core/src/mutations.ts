import { DEFAULT_TIME_ZONE } from './time.ts';
import { weeksToMask } from './weeks.ts';
import type { Storage } from './storage.ts';
import { assertValid } from './validation.ts';
import type { EventType, HolidaySource, ReminderTargetType } from './types.ts';

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

async function insert(ctx: Context, store: Parameters<Storage['collection']>[0], row: Row): Promise<Row> {
  await assertValid(ctx.storage, store, row);
  await ctx.storage.collection(store).put(row);
  return row;
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
    ...changes,
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
  const ctx = context(storage, options);
  const rows: Row[] = [];
  for (const period of DEFAULT_PERIODS) {
    rows.push(
      await insert(ctx, 'time_slots', {
        id: ctx.id(),
        semester_id: semesterId,
        period_no: period.periodNo,
        start_time: period.startTime,
        end_time: period.endTime,
        label: null,
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
    priority: input.priority ?? null,
    due_at: input.dueAt ?? null,
    subject: input.subject ?? null,
    seat_no: input.seatNo ?? null,
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
