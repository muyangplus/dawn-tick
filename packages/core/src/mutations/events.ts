// 事件（日程、待办、调课、假期）与提醒。
import type { Storage } from '../storage.ts';
import type { EventNature, EventType, HolidaySource, ReminderTargetType } from '../types.ts';
import {
  context,
  insert,
  patch,
  remove,
  removeEventsDeep,
  withDescendants,
  type Row,
  type WriteOptions,
} from './base.ts';

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
  /** 是否显示在课表上：日程/作业/考试用开关控制，实验默认显示 */
  showInTimetable?: boolean;
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
    show_in_timetable: input.showInTimetable === true ? 1 : 0,
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
  action: 'move' | 'cancel';
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

/** 删除事件及其全部子孙事件，连同它们的提醒。 */
export async function deleteEvent(storage: Storage, id: string, options: WriteOptions = {}): Promise<void> {
  const ctx = context(storage, options);
  const events = await storage.collection<Row>('events').getAll();
  await removeEventsDeep(ctx, withDescendants(events, (row) => row['id'] === id));
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
