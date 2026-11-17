// 用户、学期与节次表。
import { DEFAULT_TIME_ZONE } from '../time.ts';
import { MAX_PERIODS, addMinutes, parseClock, sectionOf } from '../timetable.ts';
import type { Storage } from '../storage.ts';
import type { PeriodSection } from '../types.ts';
import {
  context,
  insert,
  isAlive,
  patch,
  remove,
  withDescendants,
  type Row,
  type WriteOptions,
} from './base.ts';

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
  if (periodNo > MAX_PERIODS) throw new Error(`节次不能超过 ${MAX_PERIODS} 节`);
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
  // 本学期的事件、挂在本学期排课上的调课/停课（semester_id 可能为空），以及它们的子孙事件
  const events = withDescendants(
    await storage.collection<Row>('events').getAll(),
    (row) => row['semester_id'] === id || scheduleIds.has(String(row['ref_schedule_id'])),
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

/**
 * 课程名的唯一权威校验：界面禁用保存只是第一道提示，这里兜底拒绝空名，
 * 避免脚本调用或竞态绕开 UI 写出空白课卡。
 */
