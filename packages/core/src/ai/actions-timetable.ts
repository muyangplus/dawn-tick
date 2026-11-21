/**
 * 助手的写入类动作（只依赖存储的部分）：学期、节次、课程与排课、假日、提醒、日程删除与完成。
 * parse 负责把参数校验到能直接写入；run 只做写入，返回一句结果。
 */
import { createSemester, deleteSemesterDeep, appendTimeSlot, deleteTimeSlot, updateSemester, updateTimeSlot } from '../mutations/semesters.ts';
import { createCourse, createSchedule, deleteCourse, deleteSchedule, updateCourse, updateSchedule } from '../mutations/courses.ts';
import { createEvent, deleteEvent, deleteReminder, setReminder, updateEvent } from '../mutations/events.ts';
import { listSchedules, listSemesters, listTimeSlots, loadSemester } from '../repository.ts';
import { addDays, diffDays, isValidTimeZone } from '../time.ts';
import type { CourseRow, CourseScheduleRow, EventRow, ReminderRow, ReminderTargetType, SemesterRow, TimeSlotRow } from '../types.ts';
import { describeWeeks, maskToWeeks, weeksToMask } from '../weeks.ts';
import {
  AiArgError,
  clearableString,
  defineAction,
  objectSchema,
  optBool,
  optDate,
  optInt,
  optInts,
  optString,
  optTime,
  reqDate,
  reqEnum,
  reqInt,
  reqString,
  schema,
  type AiAction,
  type AiArgs,
} from './actions.ts';
import { AI_ENTRY_TYPES, semesterOf, type AiCoreContext } from './actions-query.ts';

/** 一次最多设多少天假日 */
export const AI_DAY_KIND_MAX_DAYS = 62;
const MAX_TOTAL_WEEKS = 30;
const MAX_PERIOD = 20;

// ---- 读取并确认存在 ----

async function aliveRow<T extends { deleted_at: number | null }>(
  context: AiCoreContext,
  store: 'courses' | 'course_schedules' | 'events' | 'reminders',
  id: string,
  label: string,
): Promise<T> {
  const row = await context.storage.collection<T>(store).get(id);
  // 带 user_id 的表（日程、提醒）只认当前用户的行；课程与排课由所属学期把关
  const owner = (row as { user_id?: unknown } | undefined)?.user_id;
  if (row === undefined || row.deleted_at !== null || (owner !== undefined && owner !== context.userId)) {
    throw new AiArgError(`找不到${label} ${id}`);
  }
  return row;
}

async function courseOf(context: AiCoreContext, id: string): Promise<CourseRow> {
  const course = await aliveRow<CourseRow>(context, 'courses', id, '课程');
  const semester = await loadSemester(context.storage, course.semester_id);
  if (semester === undefined || semester.user_id !== context.userId) throw new AiArgError(`找不到课程 ${id}`);
  return course;
}

async function semesterOfCourse(context: AiCoreContext, course: CourseRow): Promise<SemesterRow> {
  const semester = await loadSemester(context.storage, course.semester_id);
  if (semester === undefined || semester.user_id !== context.userId) throw new AiArgError('课程所在的学期已删除');
  return semester;
}

async function semesterById(context: AiCoreContext, id: string): Promise<SemesterRow> {
  const row = await loadSemester(context.storage, id);
  if (row === undefined || row.user_id !== context.userId) throw new AiArgError(`找不到学期 ${id}`);
  return row;
}

/** 一个排课时段的参数：节次按本学期节次数校验，周次缺省为全学期。 */
interface ScheduleFields {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
  room: string | null;
}

async function periodCount(context: AiCoreContext, semesterId: string): Promise<number> {
  return Math.max(1, (await listTimeSlots(context.storage, semesterId)).length);
}

function allWeeks(total: number): number[] {
  return Array.from({ length: total }, (_, index) => index + 1);
}

function scheduleFields(args: AiArgs, semester: SemesterRow, periods: number): ScheduleFields {
  const dayOfWeek = reqInt(args, 'dayOfWeek', 1, 7);
  const periodStart = reqInt(args, 'periodStart', 1, periods);
  const periodEnd = optInt(args, 'periodEnd', 1, periods) ?? periodStart;
  if (periodEnd < periodStart) throw new AiArgError('结束节次不能早于开始节次');
  const weeks = optInts(args, 'weeks', 1, semester.total_weeks) ?? allWeeks(semester.total_weeks);
  if (weeks.length === 0) throw new AiArgError('周次不能为空');
  return { dayOfWeek, periodStart, periodEnd, weeks, room: optString(args, 'room') || null };
}

const WEEKDAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function scheduleText(fields: ScheduleFields, totalWeeks: number): string {
  const periods = fields.periodStart === fields.periodEnd ? `第 ${fields.periodStart} 节` : `第 ${fields.periodStart}-${fields.periodEnd} 节`;
  const room = fields.room === null ? '' : ` ${fields.room}`;
  return `${WEEKDAY[fields.dayOfWeek]} ${periods}，${describeWeeks(weeksToMask(fields.weeks), totalWeeks)}${room}`;
}

const scheduleProps = {
  dayOfWeek: schema.integer('星期，1-7（周一为 1）', 1, 7),
  periodStart: schema.integer('开始节次', 1, MAX_PERIOD),
  periodEnd: schema.integer('结束节次，不填同开始节次', 1, MAX_PERIOD),
  weeks: schema.integers('上课周次，如 [1,2,3]；不填为全学期'),
  room: schema.string('教室'),
};

// ---- 学期 ----

interface SemesterInput {
  name: string;
  startDate: string;
  totalWeeks: number;
  active: boolean;
}

export const createSemesterAction = defineAction<AiCoreContext, SemesterInput>({
  name: 'create_semester',
  description: '新建学期（带默认节次）',
  parameters: objectSchema(
    {
      name: schema.string('学期名称'),
      startDate: schema.date('开学日期（第 1 周的某天，通常是周一）'),
      totalWeeks: schema.integer('总周数，默认 20', 1, MAX_TOTAL_WEEKS),
      active: schema.boolean('是否设为当前学期，默认是'),
    },
    ['name', 'startDate'],
  ),
  risk: 'write',
  parse: (args) => ({
    name: reqString(args, 'name'),
    startDate: reqDate(args, 'startDate'),
    totalWeeks: optInt(args, 'totalWeeks', 1, MAX_TOTAL_WEEKS) ?? 20,
    active: optBool(args, 'active') ?? true,
  }),
  preview: (input) => `新建学期「${input.name}」，${input.startDate} 开学，共 ${input.totalWeeks} 周${input.active ? '，设为当前学期' : ''}`,
  async run(input, context) {
    await createSemester(context.storage, {
      userId: context.userId,
      name: input.name,
      startDate: input.startDate,
      totalWeeks: input.totalWeeks,
      isActive: input.active,
    });
    return `已新建学期「${input.name}」`;
  },
});

interface SemesterPatch {
  semester: SemesterRow;
  changes: Record<string, unknown>;
  parts: string[];
}

export const updateSemesterAction = defineAction<AiCoreContext, SemesterPatch>({
  name: 'update_semester',
  description: '修改学期的名称、开学日期、总周数或时区',
  parameters: objectSchema(
    {
      id: schema.string('学期 id'),
      name: schema.string('新名称'),
      startDate: schema.date('新的开学日期'),
      totalWeeks: schema.integer('新的总周数', 1, MAX_TOTAL_WEEKS),
      timeZone: schema.string('IANA 时区，如 Asia/Shanghai'),
    },
    ['id'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterById(context, reqString(args, 'id'));
    const changes: Record<string, unknown> = {};
    const parts: string[] = [];
    const name = optString(args, 'name');
    if (name !== undefined && name !== '') {
      changes['name'] = name;
      parts.push(`名称改为「${name}」`);
    }
    const startDate = optDate(args, 'startDate');
    if (startDate !== undefined) {
      changes['start_date'] = startDate;
      parts.push(`开学日期改为 ${startDate}`);
    }
    const totalWeeks = optInt(args, 'totalWeeks', 1, MAX_TOTAL_WEEKS);
    if (totalWeeks !== undefined) {
      changes['total_weeks'] = totalWeeks;
      parts.push(`总周数改为 ${totalWeeks}`);
    }
    const timeZone = optString(args, 'timeZone');
    if (timeZone !== undefined && timeZone !== '') {
      if (!isValidTimeZone(timeZone)) throw new AiArgError(`无效的时区 ${timeZone}`);
      changes['time_zone'] = timeZone;
      parts.push(`时区改为 ${timeZone}`);
    }
    if (parts.length === 0) throw new AiArgError('没有要修改的字段');
    return { semester, changes, parts };
  },
  preview: ({ semester, parts }) => `学期「${semester.name}」：${parts.join('，')}`,
  async run({ semester, changes }, context) {
    await updateSemester(context.storage, semester.id, changes);
    return `已修改学期「${semester.name}」`;
  },
});

export const setActiveSemesterAction = defineAction<AiCoreContext, SemesterRow>({
  name: 'set_active_semester',
  description: '把某学期设为当前学期',
  parameters: objectSchema({ id: schema.string('学期 id') }, ['id']),
  risk: 'write',
  parse: (args, context) => semesterById(context, reqString(args, 'id')),
  preview: (semester) => `切换到学期「${semester.name}」`,
  async run(semester, context) {
    for (const row of await listSemesters(context.storage, context.userId)) {
      const active = row.id === semester.id ? 1 : 0;
      if (row.is_active !== active) await updateSemester(context.storage, row.id, { is_active: active });
    }
    return `已切换到学期「${semester.name}」`;
  },
});

export const deleteSemesterAction = defineAction<AiCoreContext, SemesterRow>({
  name: 'delete_semester',
  description: '删除学期及其全部课程、排课、节次、日程与提醒',
  parameters: objectSchema({ id: schema.string('学期 id') }, ['id']),
  risk: 'danger',
  parse: (args, context) => semesterById(context, reqString(args, 'id')),
  preview: (semester) => `删除学期「${semester.name}」及其全部课程、日程与提醒`,
  async run(semester, context) {
    const report = await deleteSemesterDeep(context.storage, semester.id);
    return `已删除学期「${semester.name}」（课程 ${report.courses} 门，日程 ${report.events} 条）`;
  },
});

// ---- 节次 ----

interface PeriodEdit {
  semester: SemesterRow;
  slot: TimeSlotRow;
  start: string | undefined;
  end: string | undefined;
}

export const updatePeriodAction = defineAction<AiCoreContext, PeriodEdit>({
  name: 'update_period',
  description: '修改某一节的上下课时间',
  parameters: objectSchema(
    { semesterId: schema.string('学期 id；不填为当前学期'), period: schema.integer('第几节', 1, MAX_PERIOD), start: schema.time('上课时间'), end: schema.time('下课时间') },
    ['period'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    const period = reqInt(args, 'period', 1, MAX_PERIOD);
    const slot = (await listTimeSlots(context.storage, semester.id)).find((row) => row.period_no === period);
    if (slot === undefined) throw new AiArgError(`没有第 ${period} 节`);
    const start = optTime(args, 'start');
    const end = optTime(args, 'end');
    if (start === undefined && end === undefined) throw new AiArgError('没有要修改的时间');
    if ((start ?? slot.start_time) >= (end ?? slot.end_time)) throw new AiArgError('下课时间要晚于上课时间');
    return { semester, slot, start, end };
  },
  preview: ({ slot, start, end }) => `第 ${slot.period_no} 节改为 ${start ?? slot.start_time}-${end ?? slot.end_time}`,
  async run({ slot, start, end }, context) {
    await updateTimeSlot(context.storage, slot.id, {
      ...(start === undefined ? {} : { startTime: start }),
      ...(end === undefined ? {} : { endTime: end }),
    });
    return `已修改第 ${slot.period_no} 节`;
  },
});

interface PeriodAppend {
  semester: SemesterRow;
  next: number;
  start: string;
  end: string;
}

export const addPeriodAction = defineAction<AiCoreContext, PeriodAppend>({
  name: 'add_period',
  description: '在最后追加一节',
  parameters: objectSchema(
    { semesterId: schema.string('学期 id；不填为当前学期'), start: schema.time('上课时间'), end: schema.time('下课时间') },
    ['start', 'end'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    const slots = await listTimeSlots(context.storage, semester.id);
    const start = optTime(args, 'start');
    const end = optTime(args, 'end');
    if (start === undefined || end === undefined) throw new AiArgError('缺少上课或下课时间');
    if (start >= end) throw new AiArgError('下课时间要晚于上课时间');
    const last = slots.at(-1);
    if (last !== undefined && start < last.end_time) throw new AiArgError(`上课时间不能早于第 ${last.period_no} 节下课（${last.end_time}）`);
    const next = (last?.period_no ?? 0) + 1;
    if (next > MAX_PERIOD) throw new AiArgError(`节次不能超过 ${MAX_PERIOD} 节`);
    return { semester, next, start, end };
  },
  preview: ({ next, start, end }) => `追加第 ${next} 节 ${start}-${end}`,
  async run({ semester, next, start, end }, context) {
    const created = await appendTimeSlot(context.storage, semester.id, 45, 10);
    await updateTimeSlot(context.storage, String(created['id']), { startTime: start, endTime: end });
    return `已追加第 ${next} 节`;
  },
});

export const deletePeriodAction = defineAction<AiCoreContext, { semester: SemesterRow; period: number }>({
  name: 'delete_period',
  description: '删除某一节；有课排在这一节时不能删',
  parameters: objectSchema({ semesterId: schema.string('学期 id；不填为当前学期'), period: schema.integer('第几节', 1, MAX_PERIOD) }, ['period']),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    const period = reqInt(args, 'period', 1, MAX_PERIOD);
    const slots = await listTimeSlots(context.storage, semester.id);
    if (!slots.some((row) => row.period_no === period)) throw new AiArgError(`没有第 ${period} 节`);
    const used = (await listSchedules(context.storage, semester.id)).filter(
      (row) => row.period_start <= period && row.period_end >= period,
    ).length;
    if (used > 0) throw new AiArgError(`第 ${period} 节还排着 ${used} 个课程时段，先调整这些时段`);
    return { semester, period };
  },
  preview: ({ period }) => `删除第 ${period} 节`,
  async run({ semester, period }, context) {
    const result = await deleteTimeSlot(context.storage, semester.id, period);
    if (!result.deleted) throw new Error(result.usedBy > 0 ? `第 ${period} 节还有课` : `没有第 ${period} 节`);
    return `已删除第 ${period} 节`;
  },
});

// ---- 课程与排课 ----

interface CourseInput {
  semester: SemesterRow;
  name: string;
  shortName: string | null;
  teacher: string | null;
  location: string | null;
  credits: number | null;
  note: string | null;
  schedules: ScheduleFields[];
}

function creditsOf(args: AiArgs): number | null | undefined {
  if (!('credits' in args)) return undefined;
  const raw = args['credits'];
  if (raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 50) throw new AiArgError('参数 credits 应为 0-50 的数');
  return raw;
}

export const createCourseAction = defineAction<AiCoreContext, CourseInput>({
  name: 'create_course',
  description: '新建课程，可同时给出排课时段',
  parameters: objectSchema(
    {
      semesterId: schema.string('学期 id；不填为当前学期'),
      name: schema.string('课程名'),
      shortName: schema.string('课表上显示的简称'),
      teacher: schema.string('教师'),
      location: schema.string('默认教室'),
      credits: { type: 'number', description: '学分' },
      note: schema.string('备注'),
      schedules: { type: 'array', description: '排课时段', items: objectSchema(scheduleProps, ['dayOfWeek', 'periodStart']) },
    },
    ['name'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    const periods = await periodCount(context, semester.id);
    const rawSchedules = args['schedules'] ?? [];
    if (!Array.isArray(rawSchedules)) throw new AiArgError('参数 schedules 应为数组');
    const schedules = rawSchedules.map((raw: unknown, index) => {
      if (raw === null || typeof raw !== 'object') throw new AiArgError(`schedules 第 ${index + 1} 项应为对象`);
      try {
        return scheduleFields(raw as AiArgs, semester, periods);
      } catch (error) {
        throw new AiArgError(`schedules 第 ${index + 1} 项：${(error as Error).message}`);
      }
    });
    return {
      semester,
      name: reqString(args, 'name'),
      shortName: clearableString(args, 'shortName') ?? null,
      teacher: clearableString(args, 'teacher') ?? null,
      location: clearableString(args, 'location') ?? null,
      credits: creditsOf(args) ?? null,
      note: clearableString(args, 'note') ?? null,
      schedules,
    };
  },
  preview(input) {
    const times = input.schedules.map((item) => scheduleText(item, input.semester.total_weeks));
    return `新建课程「${input.name}」${input.teacher === null ? '' : `（${input.teacher}）`}${times.length === 0 ? '' : `：${times.join('；')}`}`;
  },
  async run(input, context) {
    const course = await createCourse(context.storage, {
      semesterId: input.semester.id,
      name: input.name,
      shortName: input.shortName,
      teacher: input.teacher,
      location: input.location,
      credits: input.credits,
      note: input.note,
    });
    for (const item of input.schedules) {
      await createSchedule(context.storage, { courseId: String(course['id']), ...item });
    }
    return `已新建课程「${input.name}」`;
  },
});

interface CoursePatch {
  course: CourseRow;
  changes: Record<string, unknown>;
  parts: string[];
}

const COURSE_TEXT_FIELDS: ReadonlyArray<[key: string, column: string, label: string]> = [
  ['shortName', 'short_name', '简称'],
  ['teacher', 'teacher', '教师'],
  ['location', 'location', '教室'],
  ['note', 'note', '备注'],
];

export const updateCourseAction = defineAction<AiCoreContext, CoursePatch>({
  name: 'update_course',
  description: '修改课程信息（名称、简称、教师、教室、学分、备注）；传空串清空',
  parameters: objectSchema(
    {
      id: schema.string('课程 id'),
      name: schema.string('课程名'),
      shortName: schema.string('简称'),
      teacher: schema.string('教师'),
      location: schema.string('默认教室'),
      credits: { type: ['number', 'null'], description: '学分；null 清空' },
      note: schema.string('备注'),
    },
    ['id'],
  ),
  risk: 'write',
  async parse(args, context) {
    const course = await courseOf(context, reqString(args, 'id'));
    const changes: Record<string, unknown> = {};
    const parts: string[] = [];
    const name = optString(args, 'name');
    if (name !== undefined && name !== '') {
      changes['name'] = name;
      parts.push(`名称改为「${name}」`);
    }
    for (const [key, column, label] of COURSE_TEXT_FIELDS) {
      const value = clearableString(args, key);
      if (value === undefined) continue;
      changes[column] = value;
      parts.push(value === null ? `清空${label}` : `${label}改为「${value}」`);
    }
    const credits = creditsOf(args);
    if (credits !== undefined) {
      changes['credits'] = credits;
      parts.push(credits === null ? '清空学分' : `学分改为 ${credits}`);
    }
    if (parts.length === 0) throw new AiArgError('没有要修改的字段');
    return { course, changes, parts };
  },
  preview: ({ course, parts }) => `课程「${course.name}」：${parts.join('，')}`,
  async run({ course, changes }, context) {
    await updateCourse(context.storage, course.id, changes);
    return `已修改课程「${course.name}」`;
  },
});

export const deleteCourseAction = defineAction<AiCoreContext, CourseRow>({
  name: 'delete_course',
  description: '删除整门课（连同排课时段、调课与提醒）',
  parameters: objectSchema({ id: schema.string('课程 id') }, ['id']),
  risk: 'write',
  parse: (args, context) => courseOf(context, reqString(args, 'id')),
  preview: (course) => `删除课程「${course.name}」及其全部时段`,
  async run(course, context) {
    await deleteCourse(context.storage, course.id);
    return `已删除课程「${course.name}」`;
  },
});

interface ScheduleAdd {
  course: CourseRow;
  semester: SemesterRow;
  fields: ScheduleFields;
}

export const addScheduleAction = defineAction<AiCoreContext, ScheduleAdd>({
  name: 'add_schedule',
  description: '给课程加一个排课时段',
  parameters: objectSchema({ courseId: schema.string('课程 id'), ...scheduleProps }, ['courseId', 'dayOfWeek', 'periodStart']),
  risk: 'write',
  async parse(args, context) {
    const course = await courseOf(context, reqString(args, 'courseId'));
    const semester = await semesterOfCourse(context, course);
    return { course, semester, fields: scheduleFields(args, semester, await periodCount(context, semester.id)) };
  },
  preview: ({ course, semester, fields }) => `给「${course.name}」加时段：${scheduleText(fields, semester.total_weeks)}`,
  async run({ course, fields }, context) {
    await createSchedule(context.storage, { courseId: course.id, ...fields });
    return `已给「${course.name}」加时段`;
  },
});

interface ScheduleEdit {
  schedule: CourseScheduleRow;
  course: CourseRow;
  semester: SemesterRow;
  fields: ScheduleFields;
}

export const updateScheduleAction = defineAction<AiCoreContext, ScheduleEdit>({
  name: 'update_schedule',
  description: '修改排课时段（星期、节次、周次、教室）；只影响以后的全部周次，改单次课用调课',
  parameters: objectSchema(
    {
      id: schema.string('排课时段 id'),
      dayOfWeek: scheduleProps.dayOfWeek,
      periodStart: scheduleProps.periodStart,
      periodEnd: scheduleProps.periodEnd,
      weeks: scheduleProps.weeks,
      room: schema.string('教室；传空串清空'),
    },
    ['id'],
  ),
  risk: 'write',
  async parse(args, context) {
    const schedule = await aliveRow<CourseScheduleRow>(context, 'course_schedules', reqString(args, 'id'), '排课时段');
    const course = await courseOf(context, schedule.course_id);
    const semester = await semesterOfCourse(context, course);
    const periods = await periodCount(context, semester.id);
    const room = clearableString(args, 'room');
    // 没给的字段沿用原值，再整体按同一规则校验
    const merged: Record<string, unknown> = {
      dayOfWeek: args['dayOfWeek'] ?? schedule.day_of_week,
      periodStart: args['periodStart'] ?? schedule.period_start,
      periodEnd: args['periodEnd'] ?? (args['periodStart'] == null ? schedule.period_end : undefined),
      weeks: args['weeks'] ?? maskToWeeks(schedule.weeks_mask, semester.total_weeks),
      room: room === undefined ? schedule.room : room,
    };
    const fields = scheduleFields(merged, semester, periods);
    return { schedule, course, semester, fields };
  },
  preview: ({ course, semester, fields }) => `「${course.name}」的时段改为：${scheduleText(fields, semester.total_weeks)}`,
  async run({ schedule, course, fields }, context) {
    await updateSchedule(context.storage, schedule.id, {
      day_of_week: fields.dayOfWeek,
      period_start: fields.periodStart,
      period_end: fields.periodEnd,
      weeks_mask: weeksToMask(fields.weeks),
      weeks_raw: null,
      room: fields.room,
    });
    return `已修改「${course.name}」的时段`;
  },
});

export const deleteScheduleAction = defineAction<AiCoreContext, { schedule: CourseScheduleRow; course: CourseRow }>({
  name: 'delete_schedule',
  description: '删除课程的一个排课时段（连同它的调课与提醒）',
  parameters: objectSchema({ id: schema.string('排课时段 id') }, ['id']),
  risk: 'write',
  async parse(args, context) {
    const schedule = await aliveRow<CourseScheduleRow>(context, 'course_schedules', reqString(args, 'id'), '排课时段');
    return { schedule, course: await courseOf(context, schedule.course_id) };
  },
  preview: ({ schedule, course }) =>
    `删除「${course.name}」${WEEKDAY[schedule.day_of_week]} 第 ${schedule.period_start}-${schedule.period_end} 节的时段`,
  async run({ schedule, course }, context) {
    await deleteSchedule(context.storage, schedule.id);
    return `已删除「${course.name}」的一个时段`;
  },
});

// ---- 假日与上课日 ----

type DayKindChoice = 'holiday' | 'workday' | 'clear';

interface DayKindInput {
  semester: SemesterRow;
  dates: string[];
  kind: DayKindChoice;
  title: string | null;
}

export const setDayKindAction = defineAction<AiCoreContext, DayKindInput>({
  name: 'set_day_kind',
  description: '把一天或一段日期设为假日（不上课）或上课日（覆盖法定假日），或清除手动设置',
  parameters: objectSchema(
    {
      semesterId: schema.string('学期 id；不填为当前学期'),
      from: schema.date('开始日期'),
      to: schema.date('结束日期，不填只设一天'),
      kind: schema.enumOf('holiday 假日 / workday 上课日 / clear 清除手动设置', ['holiday', 'workday', 'clear']),
      title: schema.string('假日名称，如 运动会'),
    },
    ['from', 'kind'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    const from = reqDate(args, 'from');
    const to = optDate(args, 'to') ?? from;
    if (to < from) throw new AiArgError('结束日期不能早于开始日期');
    const span = diffDays(to, from) + 1;
    if (span > AI_DAY_KIND_MAX_DAYS) throw new AiArgError(`一次最多设 ${AI_DAY_KIND_MAX_DAYS} 天`);
    const dates = Array.from({ length: span }, (_, index) => addDays(from, index));
    return { semester, dates, kind: reqEnum(args, 'kind', ['holiday', 'workday', 'clear'] as const), title: optString(args, 'title') || null };
  },
  preview({ dates, kind, title }) {
    // 单日后面留空格，多日以括号收尾不再加空格
    const range = dates.length === 1 ? `${dates[0]} ` : `${dates[0]} 至 ${dates.at(-1)}（${dates.length} 天）`;
    if (kind === 'clear') return `清除 ${range}的手动假日与上课日设置`;
    return kind === 'holiday' ? `${range}设为假日${title === null ? '' : `「${title}」`}` : `${range}设为上课日`;
  },
  async run({ semester, dates, kind, title }, context) {
    const events = await context.storage.collection<EventRow>('events').getAll();
    const dateSet = new Set(dates);
    // 同一天只能有一条假日/上课日记录（唯一索引）：手动的删掉重写；导入或内置的就地改成手动，手动优先
    const marks = events.filter(
      (row) =>
        row.deleted_at === null &&
        row.semester_id === semester.id &&
        row.on_date !== null &&
        dateSet.has(row.on_date) &&
        (row.type === 'holiday' || row.type === 'workday' || row.type === 'makeup'),
    );
    const manual = marks.filter((row) => row.source === null || row.source === 'manual');
    for (const row of manual) await deleteEvent(context.storage, row.id);
    if (kind === 'clear') return `已清除 ${manual.length} 条手动设置`;
    const imported = new Map(marks.filter((row) => !manual.includes(row)).map((row) => [row.on_date as string, row]));
    const label = kind === 'holiday' ? (title ?? '假日') : '上课日';
    for (const date of dates) {
      const existing = imported.get(date);
      if (existing !== undefined) {
        await updateEvent(context.storage, existing.id, { type: kind, title: label, source: 'manual', as_day_of_week: null });
        continue;
      }
      await createEvent(context.storage, { userId: context.userId, semesterId: semester.id, type: kind, title: label, onDate: date });
    }
    return `已设置 ${dates.length} 天`;
  },
});

// ---- 日程：删除与完成（新建与修改在 web，与表单同一口径） ----

async function entryOf(context: AiCoreContext, id: string): Promise<EventRow> {
  const row = await aliveRow<EventRow>(context, 'events', id, '日程');
  if (!(AI_ENTRY_TYPES as readonly string[]).includes(row.type)) throw new AiArgError(`${id} 不是日程条目`);
  return row;
}

export const deleteEventAction = defineAction<AiCoreContext, EventRow>({
  name: 'delete_event',
  description: '删除一条日程、待办、作业、考试或实验（连同提醒）',
  parameters: objectSchema({ id: schema.string('日程 id') }, ['id']),
  risk: 'write',
  parse: (args, context) => entryOf(context, reqString(args, 'id')),
  preview: (row) => `删除「${row.title}」${row.on_date === null ? '' : `（${row.on_date}）`}`,
  async run(row, context) {
    await deleteEvent(context.storage, row.id);
    return `已删除「${row.title}」`;
  },
});

export const setEventDoneAction = defineAction<AiCoreContext, { row: EventRow; done: boolean }>({
  name: 'set_event_done',
  description: '把日程标为已完成或未完成',
  parameters: objectSchema({ id: schema.string('日程 id'), done: schema.boolean('true 已完成，false 未完成，默认 true') }, ['id']),
  risk: 'write',
  async parse(args, context) {
    return { row: await entryOf(context, reqString(args, 'id')), done: optBool(args, 'done') ?? true };
  },
  preview: ({ row, done }) => `「${row.title}」标为${done ? '已完成' : '未完成'}`,
  async run({ row, done }, context) {
    await updateEvent(context.storage, row.id, { done: done ? 1 : 0 });
    return `「${row.title}」已标为${done ? '已完成' : '未完成'}`;
  },
});

// ---- 提醒 ----

interface ReminderInput {
  targetType: ReminderTargetType;
  targetId: string;
  name: string;
  advanceMinutes: number;
  enabled: boolean;
}

export const setReminderAction = defineAction<AiCoreContext, ReminderInput>({
  name: 'set_reminder',
  description: '给课程、排课时段或日程设置提醒（同一对象只保留一条，再设会覆盖）',
  parameters: objectSchema(
    {
      targetType: schema.enumOf('course 课程 / schedule 排课时段 / event 日程', ['course', 'schedule', 'event']),
      targetId: schema.string('对象 id'),
      advanceMinutes: schema.integer('提前多少分钟，默认 10', 0, 10080),
      enabled: schema.boolean('是否开启，默认开启'),
    },
    ['targetType', 'targetId'],
  ),
  risk: 'write',
  async parse(args, context) {
    const targetType = reqEnum(args, 'targetType', ['course', 'schedule', 'event'] as const);
    const targetId = reqString(args, 'targetId');
    let name: string;
    if (targetType === 'course') name = (await courseOf(context, targetId)).name;
    else if (targetType === 'schedule') {
      const schedule = await aliveRow<CourseScheduleRow>(context, 'course_schedules', targetId, '排课时段');
      const course = await courseOf(context, schedule.course_id);
      name = `${course.name} ${WEEKDAY[schedule.day_of_week]} 第 ${schedule.period_start} 节`;
    } else name = (await entryOf(context, targetId)).title;
    return {
      targetType,
      targetId,
      name,
      advanceMinutes: optInt(args, 'advanceMinutes', 0, 10080) ?? 10,
      enabled: optBool(args, 'enabled') ?? true,
    };
  },
  preview: (input) =>
    input.enabled ? `给「${input.name}」设提醒，提前 ${input.advanceMinutes} 分钟` : `关闭「${input.name}」的提醒`,
  async run(input, context) {
    await setReminder(context.storage, {
      userId: context.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      advanceMinutes: input.advanceMinutes,
      enabled: input.enabled,
    });
    return `已设置「${input.name}」的提醒`;
  },
});

export const deleteReminderAction = defineAction<AiCoreContext, ReminderRow>({
  name: 'delete_reminder',
  description: '删除一条提醒',
  parameters: objectSchema({ id: schema.string('提醒 id') }, ['id']),
  risk: 'write',
  async parse(args, context) {
    const row = await aliveRow<ReminderRow>(context, 'reminders', reqString(args, 'id'), '提醒');
    if (row.user_id !== context.userId) throw new AiArgError('找不到这条提醒');
    return row;
  },
  preview: (row) => `删除提醒 ${row.id}`,
  async run(row, context) {
    await deleteReminder(context.storage, row.id);
    return '已删除提醒';
  },
});

export const AI_TIMETABLE_ACTIONS: readonly AiAction<AiCoreContext>[] = [
  createSemesterAction,
  updateSemesterAction,
  setActiveSemesterAction,
  deleteSemesterAction,
  updatePeriodAction,
  addPeriodAction,
  deletePeriodAction,
  createCourseAction,
  updateCourseAction,
  deleteCourseAction,
  addScheduleAction,
  updateScheduleAction,
  deleteScheduleAction,
  setDayKindAction,
  deleteEventAction,
  setEventDoneAction,
  setReminderAction,
  deleteReminderAction,
];
