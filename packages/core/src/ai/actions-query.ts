/**
 * 助手的查询类动作：只读存储，结果直接交回模型。
 * 返回给模型的字段用驼峰、日期与时刻转成文本，不带内部同步列。
 */
import { expand } from '../expand.ts';
import {
  activeSemester,
  listCourses,
  listSchedules,
  listSemesters,
  listTimeSlots,
  loadExpandInput,
  loadSemester,
} from '../repository.ts';
import { builtinHolidayName, builtinWorkdayName } from '../holidays.ts';
import { searchAll } from '../search.ts';
import type { Storage } from '../storage.ts';
import { dateRange, dayOfWeek, diffDays, formatDate, formatTime, weekOfDate } from '../time.ts';
import type { CourseRow, EventRow, ReminderRow, SemesterRow } from '../types.ts';
import { describeWeeks, maskToWeeks } from '../weeks.ts';
import {
  AiArgError,
  defineAction,
  objectSchema,
  optBool,
  optDate,
  optEnum,
  optString,
  reqDate,
  reqString,
  schema,
  type AiAction,
  type AiArgs,
} from './actions.ts';

/** core 动作需要的上下文：web 在此基础上扩展。 */
export interface AiCoreContext {
  storage: Storage;
  userId: string;
  now(): number;
  /** 显示用时区：日程时刻按它换算 */
  timeZone: string;
}

/** 一次查询最多覆盖的天数 */
export const AI_QUERY_MAX_DAYS = 62;
/** 日程列表最多返回的条数 */
export const AI_EVENT_LIST_LIMIT = 100;

/** 用户日程的类型（不含调课与假日记录） */
export const AI_ENTRY_TYPES = ['todo', 'temp', 'homework', 'exam', 'lab'] as const;
const DAY_KIND_TYPES = ['holiday', 'makeup', 'workday'];

/** 参数里的学期：不给就用当前学期。 */
export async function semesterOf(context: AiCoreContext, args: AiArgs, key = 'semesterId'): Promise<SemesterRow> {
  const id = optString(args, key);
  if (id !== undefined && id !== '') {
    const row = await loadSemester(context.storage, id);
    if (row === undefined || row.user_id !== context.userId) throw new AiArgError(`找不到学期 ${id}`);
    return row;
  }
  const active = await activeSemester(context.storage, context.userId);
  if (active === undefined) throw new AiArgError('还没有学期，先新建一个');
  return active;
}

export function semesterInfo(row: SemesterRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    totalWeeks: row.total_weeks,
    timeZone: row.time_zone,
    active: row.is_active === 1,
  };
}

function courseInfo(row: CourseRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    teacher: row.teacher,
    location: row.location,
    credits: row.credits,
    note: row.note,
    color: row.color,
  };
}

/** 日程条目给模型看的样子。 */
export function entryInfo(row: EventRow, timeZone: string): Record<string, unknown> {
  const date = row.on_date ?? (row.start_at === null ? null : formatDate(row.start_at, timeZone));
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    date,
    start: row.start_time ?? (row.start_at === null ? null : formatTime(row.start_at, timeZone)),
    end: row.end_time ?? (row.end_at === null ? null : formatTime(row.end_at, timeZone)),
    due: row.due_at === null ? null : `${formatDate(row.due_at, timeZone)} ${formatTime(row.due_at, timeZone)}`,
    location: row.location,
    note: row.note,
    courseId: row.subject,
    done: row.done === 1,
    countdown: row.countdown === 1,
  };
}

/** 起止日期：校验先后与跨度，缺结束日时只查一天。 */
export function dateSpan(args: AiArgs): { from: string; to: string } {
  const from = reqDate(args, 'from');
  const to = optDate(args, 'to') ?? from;
  if (to < from) throw new AiArgError('结束日期不能早于开始日期');
  if (diffDays(to, from) + 1 > AI_QUERY_MAX_DAYS) throw new AiArgError(`一次最多查 ${AI_QUERY_MAX_DAYS} 天`);
  return { from, to };
}

async function liveEvents(storage: Storage): Promise<EventRow[]> {
  return (await storage.collection<EventRow>('events').getAll()).filter((row) => row.deleted_at === null);
}

const semesterArg = { semesterId: schema.string('学期 id；不填为当前学期') };

export const listSemestersAction = defineAction<AiCoreContext, null>({
  name: 'list_semesters',
  description: '列出全部学期（id、名称、开学日期、周数、时区、是否当前学期）',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  async run(_params, context) {
    const rows = await listSemesters(context.storage, context.userId);
    return rows.sort((left, right) => left.start_date.localeCompare(right.start_date)).map(semesterInfo);
  },
});

export const listPeriodsAction = defineAction<AiCoreContext, SemesterRow>({
  name: 'list_periods',
  description: '列出某学期的节次与上下课时间',
  parameters: objectSchema(semesterArg),
  risk: 'query',
  parse: (args, context) => semesterOf(context, args),
  preview: () => '',
  async run(semester, context) {
    const slots = await listTimeSlots(context.storage, semester.id);
    return slots.map((slot) => ({ period: slot.period_no, start: slot.start_time, end: slot.end_time, label: slot.label }));
  },
});

export const listCoursesAction = defineAction<AiCoreContext, SemesterRow>({
  name: 'list_courses',
  description: '列出某学期的课程及其排课时段（星期、节次、周次、教室），含课程 id 与时段 id',
  parameters: objectSchema(semesterArg),
  risk: 'query',
  parse: (args, context) => semesterOf(context, args),
  preview: () => '',
  async run(semester, context) {
    const [courses, schedules] = await Promise.all([
      listCourses(context.storage, semester.id),
      listSchedules(context.storage, semester.id),
    ]);
    return courses.map((course) => ({
      ...courseInfo(course),
      schedules: schedules
        .filter((row) => row.course_id === course.id)
        .sort((left, right) => left.day_of_week - right.day_of_week || left.period_start - right.period_start)
        .map((row) => ({
          id: row.id,
          dayOfWeek: row.day_of_week,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          weeks: describeWeeks(row.weeks_mask, semester.total_weeks),
          weekList: maskToWeeks(row.weeks_mask, semester.total_weeks),
          room: row.room,
          startTime: row.start_time,
          endTime: row.end_time,
        })),
    }));
  },
});

interface LessonQuery {
  semester: SemesterRow;
  from: string;
  to: string;
}

export const getLessonsAction = defineAction<AiCoreContext, LessonQuery>({
  name: 'get_lessons',
  description: `查某段日期（最多 ${AI_QUERY_MAX_DAYS} 天）实际要上的课，已计入调课、停课与放假；同时返回这段日期的假日与调课记录`,
  parameters: objectSchema(
    { ...semesterArg, from: schema.date('开始日期'), to: schema.date('结束日期，不填只查一天') },
    ['from'],
  ),
  risk: 'query',
  async parse(args, context) {
    return { semester: await semesterOf(context, args), ...dateSpan(args) };
  },
  preview: () => '',
  async run({ semester, from, to }, context) {
    const input = await loadExpandInput(context.storage, semester.id, from, to);
    if (input === undefined) return { lessons: [], dayKinds: [], adjustments: [] };
    const lessons = expand({ ...input, includeCancelled: true }).map((item) => ({
      date: item.date,
      week: weekOfDate(item.date, semester.start_date),
      dayOfWeek: dayOfWeek(item.date),
      courseId: item.courseId,
      courseName: item.courseName,
      scheduleId: item.scheduleId,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      start: formatTime(item.startAt, semester.time_zone),
      end: formatTime(item.endAt, semester.time_zone),
      room: item.room,
      cancelled: item.cancelled,
    }));
    const dates = new Set(dateRange(from, to));
    const events = (await liveEvents(context.storage)).filter((row) => row.semester_id === semester.id || row.type === 'reschedule');
    const scheduleIds = new Set((input.schedules ?? []).map((row) => row.id));
    const dayKinds = events
      .filter((row) => DAY_KIND_TYPES.includes(row.type) && row.on_date !== null && dates.has(row.on_date))
      .map((row) => ({ id: row.id as string | null, date: row.on_date as string, kind: row.type as string, title: row.title, source: row.source ?? 'manual' }));
    // 内置的法定假日与调休上班日不落库，也会影响课表：没有记录覆盖的日期一并列出（id 为空，不能删）
    const marked = new Set(dayKinds.map((item) => item.date));
    for (const date of dates) {
      if (marked.has(date)) continue;
      const holiday = builtinHolidayName(date);
      const workday = builtinWorkdayName(date);
      if (holiday !== null) dayKinds.push({ id: null, date, kind: 'holiday', title: holiday, source: 'builtin' });
      else if (workday !== null) dayKinds.push({ id: null, date, kind: 'workday', title: workday, source: 'builtin' });
    }
    dayKinds.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
    const adjustments = events
      .filter(
        (row) =>
          row.type === 'reschedule' &&
          row.ref_schedule_id !== null &&
          scheduleIds.has(row.ref_schedule_id) &&
          ((row.on_date !== null && dates.has(row.on_date)) || (row.new_date !== null && dates.has(row.new_date))),
      )
      .map((row) => ({
        id: row.id,
        scheduleId: row.ref_schedule_id,
        date: row.on_date,
        action: row.action,
        newDate: row.new_date,
        newPeriodStart: row.new_period_start,
        newPeriodEnd: row.new_period_end,
        newRoom: row.new_room,
      }));
    return { semester: semester.name, lessons, dayKinds, adjustments };
  },
});

interface EventQuery {
  from: string | undefined;
  to: string | undefined;
  type: (typeof AI_ENTRY_TYPES)[number] | undefined;
  includeDone: boolean;
}

export const listEventsAction = defineAction<AiCoreContext, EventQuery>({
  name: 'list_events',
  description: `列出日程、待办、作业、考试与实验（含 id），可按日期与类型筛选，最多 ${AI_EVENT_LIST_LIMIT} 条`,
  parameters: objectSchema({
    from: schema.date('开始日期'),
    to: schema.date('结束日期'),
    type: schema.enumOf('类型：todo 待办 / temp 日程 / homework 作业 / exam 考试 / lab 实验', AI_ENTRY_TYPES),
    includeDone: schema.boolean('是否包含已完成的，默认不含'),
  }),
  risk: 'query',
  parse(args) {
    const from = optDate(args, 'from');
    const to = optDate(args, 'to');
    if (from !== undefined && to !== undefined && to < from) throw new AiArgError('结束日期不能早于开始日期');
    return { from, to, type: optEnum(args, 'type', AI_ENTRY_TYPES), includeDone: optBool(args, 'includeDone') ?? false };
  },
  preview: () => '',
  async run(query, context) {
    const rows = (await liveEvents(context.storage))
      .filter((row) => row.user_id === context.userId && (AI_ENTRY_TYPES as readonly string[]).includes(row.type))
      .filter((row) => query.type === undefined || row.type === query.type)
      .filter((row) => query.includeDone || row.done !== 1)
      .map((row) => entryInfo(row, context.timeZone))
      .filter((info) => {
        const date = info['date'] as string | null;
        if (query.from === undefined && query.to === undefined) return true;
        if (date === null) return false;
        return (query.from === undefined || date >= query.from) && (query.to === undefined || date <= query.to);
      })
      .sort((left, right) => String(left['date'] ?? '\uffff').localeCompare(String(right['date'] ?? '\uffff')));
    // 没有日期的条目排在最后，超出条数时先截掉它们
    return { total: rows.length, items: rows.slice(0, AI_EVENT_LIST_LIMIT) };
  },
});

export const searchAction = defineAction<AiCoreContext, { semester: SemesterRow; keyword: string }>({
  name: 'search',
  description: '按关键字搜索当前学期的课程、排课与日程',
  parameters: objectSchema({ ...semesterArg, keyword: schema.string('关键字') }, ['keyword']),
  risk: 'query',
  async parse(args, context) {
    return { semester: await semesterOf(context, args), keyword: reqString(args, 'keyword') };
  },
  preview: () => '',
  async run({ semester, keyword }, context) {
    const hits = await searchAll(context.storage, semester.id, keyword, 30);
    return hits.map((hit) => ({
      kind: hit.kind,
      id: hit.id,
      title: hit.title,
      subtitle: hit.subtitle,
      courseId: hit.courseId ?? null,
      dayOfWeek: hit.dayOfWeek ?? null,
      periodStart: hit.periodStart ?? null,
      periodEnd: hit.periodEnd ?? null,
      date: hit.date ?? null,
    }));
  },
});

export const listRemindersAction = defineAction<AiCoreContext, null>({
  name: 'list_reminders',
  description: '列出已设置的提醒（id、对象类型与名称、提前分钟数、是否开启）',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  async run(_params, context) {
    const [reminders, courses, schedules, events] = await Promise.all([
      context.storage.collection<ReminderRow>('reminders').getAll(),
      context.storage.collection<CourseRow>('courses').getAll(),
      context.storage.collection<{ id: string; course_id: string }>('course_schedules').getAll(),
      context.storage.collection<EventRow>('events').getAll(),
    ]);
    const courseName = new Map(courses.map((row) => [row.id, row.name]));
    const scheduleCourse = new Map(schedules.map((row) => [row.id, row.course_id]));
    const eventTitle = new Map(events.map((row) => [row.id, row.title]));
    const nameOf = (row: ReminderRow): string | null => {
      if (row.target_type === 'course') return courseName.get(row.target_id) ?? null;
      if (row.target_type === 'schedule') return courseName.get(scheduleCourse.get(row.target_id) ?? '') ?? null;
      return eventTitle.get(row.target_id) ?? null;
    };
    return reminders
      .filter((row) => row.deleted_at === null && row.user_id === context.userId)
      .map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: nameOf(row),
        advanceMinutes: row.advance_minutes,
        enabled: row.enabled === 1,
      }));
  },
});

export const AI_QUERY_ACTIONS: readonly AiAction<AiCoreContext>[] = [
  listSemestersAction,
  listPeriodsAction,
  listCoursesAction,
  getLessonsAction,
  listEventsAction,
  searchAction,
  listRemindersAction,
];
