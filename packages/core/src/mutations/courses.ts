// 课程与排课。
import { DEFAULT_COURSE_COLOR } from '../colors.ts';
import { MAX_WEEKS, describeWeeks, maskToWeeks, weeksToMask } from '../weeks.ts';
import type { Storage } from '../storage.ts';
import {
  context,
  dropReminders,
  insert,
  isAlive,
  patch,
  remove,
  removeScheduleDeep,
  type Row,
  type WriteOptions,
} from './base.ts';

function requireCourseName(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('课程名必须是字符串');
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RangeError('课程名不能为空');
  return trimmed;
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
    name: requireCourseName(input.name),
    short_name: input.shortName ?? null,
    teacher: input.teacher ?? null,
    location: input.location ?? null,
    color: input.color ?? DEFAULT_COURSE_COLOR,
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
  // 只改其他字段时不动名称；一旦带了 name（含真实列名），同样按非空校验
  const next = changes['name'] === undefined ? changes : { ...changes, name: requireCourseName(changes['name']) };
  return patch(context(storage, options), 'courses', id, next);
}

export async function deleteCourse(storage: Storage, id: string, options: WriteOptions = {}): Promise<void> {
  const ctx = context(storage, options);
  const schedules = await storage.collection<Row>('course_schedules').getAll();
  for (const schedule of schedules) {
    if (schedule['deleted_at'] !== null || schedule['course_id'] !== id) continue;
    await removeScheduleDeep(ctx, String(schedule['id']));
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
  await removeScheduleDeep(context(storage, options), id);
}

export interface ScheduleInput {
  /** 已有排课的 id：带上时原地更新，保留挂在它上面的调课、停课与提醒 */
  id?: string | undefined;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: readonly number[];
  weeksRaw?: string | null;
  room?: string | null;
  /** 自定义时间（HH:MM）；为空表示按节次时间 */
  startTime?: string | null;
  endTime?: string | null;
}

export interface SetSchedulesOptions extends WriteOptions {
  /** 学期总周数：用于把周次位图转成「1-16周」文本；缺省按 30 周上限。 */
  totalWeeks?: number | undefined;
}

/**
 * 用给定排课替换某门课的全部排课；`weeks_raw` 由位图派生，调用方不必再传。
 * 已有排课原地更新（按 id，缺 id 时按星期与节次匹配）以保留其上的调课、停课与提醒；
 * 不再出现的排课连同这些附属记录一起删除。
 */
export async function setSchedules(
  storage: Storage,
  courseId: string,
  list: readonly ScheduleInput[],
  options: SetSchedulesOptions = {},
): Promise<Row[]> {
  const ctx = context(storage, options);
  const totalWeeks = options.totalWeeks ?? MAX_WEEKS;
  const existing = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) => isAlive(row) && row['course_id'] === courseId,
  );
  const unclaimed = new Map(existing.map((row) => [String(row['id']), row]));
  const claim = (item: ScheduleInput): Row | undefined => {
    if (item.id !== undefined) {
      const byId = unclaimed.get(item.id);
      if (byId !== undefined) return byId;
    }
    for (const row of unclaimed.values()) {
      if (
        row['day_of_week'] === item.dayOfWeek &&
        row['period_start'] === item.periodStart &&
        row['period_end'] === item.periodEnd
      ) {
        return row;
      }
    }
    return undefined;
  };

  const rows: Row[] = [];
  for (const item of list) {
    const mask = weeksToMask([...item.weeks]);
    const fields: Row = {
      day_of_week: item.dayOfWeek,
      period_start: item.periodStart,
      period_end: item.periodEnd,
      weeks_mask: mask,
      weeks_raw: item.weeksRaw ?? describeWeeks(mask, totalWeeks),
      room: item.room ?? null,
      start_time: item.startTime ?? null,
      end_time: item.endTime ?? null,
    };
    const match = claim(item);
    if (match !== undefined) {
      unclaimed.delete(String(match['id']));
      rows.push(await patch(ctx, 'course_schedules', String(match['id']), fields));
      continue;
    }
    rows.push(
      await insert(ctx, 'course_schedules', {
        id: ctx.id(),
        course_id: courseId,
        ...fields,
        created_at: ctx.now(),
        updated_at: ctx.now(),
        deleted_at: null,
        rev: 0,
        dirty: 1,
      }),
    );
  }
  for (const id of unclaimed.keys()) await removeScheduleDeep(ctx, id);
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
  const courses = (await storage.collection<Row>('courses').getAll()).filter(
    (row) => isAlive(row) && row['semester_id'] === semesterId,
  );
  const courseIds = new Set(courses.map((row) => String(row['id'])));
  const schedules = (await storage.collection<Row>('course_schedules').getAll()).filter(
    (row) => isAlive(row) && courseIds.has(String(row['course_id'])),
  );
  return managedCoursesOf(courses, schedules);
}

/** 由已读出的课程与排课（均为本学期、未删除）组装课程管理列表，按名称排序。 */
export function managedCoursesOf(courseRows: readonly object[], scheduleRows: readonly object[]): ManagedCourse[] {
  const courses = (courseRows as readonly Row[])
    .slice()
    .sort((left, right) => String(left['name']).localeCompare(String(right['name'])));
  const schedules = scheduleRows as readonly Row[];
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
