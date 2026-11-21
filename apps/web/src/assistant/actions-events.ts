/**
 * 助手新建与修改日程：字段口径与待办表单保存时一致（类型、截止时刻、地点、课表显示、提醒）。
 * 修改时先按表单的回填规则把原条目读成表单状态，再叠加模型给的字段，避免漏写的列被清空。
 */
import {
  AiArgError,
  AI_ENTRY_TYPES,
  clearableString,
  createEvent,
  dateWallClockToEpoch,
  defineAction,
  listManagedCourses,
  objectSchema,
  optBool,
  optDate,
  optEnum,
  optInt,
  optInts,
  optString,
  optTime,
  reqDate,
  reqEnum,
  reqString,
  schema,
  semesterOf,
  updateEvent,
  weeksToMask,
  type AiAction,
  type AiArgs,
  type AiCoreContext,
  type EventRow,
  type SemesterRow,
} from '@dawn-tick/core';
import {
  eventTypeFor,
  kindDefaults,
  kindOfEvent,
  syncEventReminder,
  todoFormFromEvent,
  type EventFormKind,
} from '../screens/todo-form-model.ts';

const KINDS: readonly EventFormKind[] = ['todo', 'homework', 'exam', 'lab'];
const KIND_NAME: Record<EventFormKind, string> = { todo: '待办', homework: '作业', exam: '考试', lab: '实验' };
/** 新建时没给提醒：与表单默认一样提前 30 分钟 */
const DEFAULT_ADVANCE = 30;
const MAX_ADVANCE = 30 * 24 * 60;
const MAX_PERIOD = 20;

/** 写入前的完整字段，与待办表单的状态一一对应。 */
export interface EventDraftFields {
  kind: EventFormKind;
  title: string;
  date: string;
  /** 不用自定义时间时的时刻 */
  time: string;
  /** 起止都有才算自定义时间 */
  startTime: string | null;
  endTime: string | null;
  courseId: string | null;
  location: string | null;
  seatNo: string | null;
  note: string | null;
  countdown: boolean;
  manualDone: boolean;
  showInTimetable: boolean;
  /** 实验节次与按周重复 */
  periodStart: number | null;
  periodEnd: number | null;
  weeks: number[] | null;
  dayOfWeek: number | null;
}

/** 表单字段 → events 列（snake_case），新建与修改共用。 */
export function eventColumnsOf(fields: EventDraftFields, semesterId: string, timeZone: string): Record<string, unknown> {
  const custom = fields.startTime !== null && fields.endTime !== null;
  const startAt = dateWallClockToEpoch(fields.date, custom ? (fields.startTime as string) : fields.time, timeZone);
  const endAt = custom ? dateWallClockToEpoch(fields.date, fields.endTime as string, timeZone) : null;
  const isLab = fields.kind === 'lab';
  const isExam = fields.kind === 'exam';
  const linked = !isExam && fields.courseId !== null;
  const repeat = isLab && fields.weeks !== null && fields.weeks.length > 0;
  return {
    type: eventTypeFor(fields.kind, linked),
    title: fields.title,
    semester_id: semesterId,
    on_date: fields.date,
    start_at: startAt,
    end_at: endAt,
    due_at: !isLab && (fields.kind === 'homework' || linked) ? (custom ? (endAt ?? startAt) : startAt) : null,
    subject: linked ? fields.courseId : null,
    location: isExam || isLab ? fields.location : null,
    seat_no: isExam ? fields.seatNo : null,
    note: fields.note,
    countdown: fields.countdown ? 1 : 0,
    manual_done: fields.manualDone ? 1 : 0,
    start_time: custom ? fields.startTime : null,
    end_time: custom ? fields.endTime : null,
    period_start: isLab ? fields.periodStart : null,
    period_end: isLab ? fields.periodEnd : null,
    weeks_mask: repeat ? weeksToMask(fields.weeks as number[]) : null,
    as_day_of_week: repeat ? fields.dayOfWeek : null,
    nature: isLab ? 'lab' : null,
    show_in_timetable: isLab || fields.showInTimetable ? 1 : 0,
  };
}

/** 列 → createEvent 的输入（camelCase）。 */
function createInputOf(columns: Record<string, unknown>, userId: string): Parameters<typeof createEvent>[1] {
  return {
    userId,
    type: columns['type'] as EventRow['type'],
    title: columns['title'] as string,
    semesterId: columns['semester_id'] as string,
    onDate: columns['on_date'] as string,
    startAt: columns['start_at'] as number,
    endAt: columns['end_at'] as number | null,
    dueAt: columns['due_at'] as number | null,
    subject: columns['subject'] as string | null,
    location: columns['location'] as string | null,
    seatNo: columns['seat_no'] as string | null,
    note: columns['note'] as string | null,
    countdown: columns['countdown'] === 1,
    manualDone: columns['manual_done'] === 1,
    startTime: columns['start_time'] as string | null,
    endTime: columns['end_time'] as string | null,
    periodStart: columns['period_start'] as number | null,
    periodEnd: columns['period_end'] as number | null,
    weeksMask: columns['weeks_mask'] as number | null,
    asDayOfWeek: columns['as_day_of_week'] as number | null,
    nature: columns['nature'] as 'lab' | null,
    showInTimetable: columns['show_in_timetable'] === 1,
  };
}

const FIELD_SCHEMA = {
  title: schema.string('标题'),
  date: schema.date('日期'),
  time: schema.time('时刻（作业为截止时刻），默认 09:00'),
  startTime: schema.time('开始时刻；与 endTime 一起给出时按起止时间显示，传空串取消'),
  endTime: schema.time('结束时刻'),
  courseId: schema.string('关联的课程 id（考试不关联）；传空串取消关联'),
  location: schema.string('地点（考试与实验）；传空串清空'),
  seatNo: schema.string('考试座位号；传空串清空'),
  note: schema.string('备注；传空串清空'),
  countdown: schema.boolean('是否在倒计时卡片显示，作业与考试默认开'),
  manualDone: schema.boolean('是否需要手动标记完成，作业默认开'),
  showInTimetable: schema.boolean('是否显示在课表上，实验总是显示'),
  advanceMinutes: schema.integer('提前多少分钟提醒，-1 不提醒；新建默认 30', -1, MAX_ADVANCE),
  periodStart: schema.integer('实验起始节', 1, MAX_PERIOD),
  periodEnd: schema.integer('实验结束节', 1, MAX_PERIOD),
  weeks: schema.integers('实验按周重复的周次；不给只这一次'),
  dayOfWeek: schema.integer('实验按周重复时的星期（1-7），默认取日期的星期', 1, 7),
};

interface EventWrite {
  semester: SemesterRow;
  fields: EventDraftFields;
  /** undefined 不动提醒；-1 删除提醒 */
  advance: number | undefined;
  /** 修改时的原条目 */
  row: EventRow | null;
  courseName: string | null;
}

async function courseNameOf(context: AiCoreContext, semester: SemesterRow, courseId: string | null): Promise<string | null> {
  if (courseId === null) return null;
  const course = (await listManagedCourses(context.storage, semester.id)).find((item) => item.id === courseId);
  if (course === undefined) throw new AiArgError(`学期「${semester.name}」里没有课程 ${courseId}`);
  return course.name;
}

/** 把模型给的字段叠到 base 上；只认传了的字段。 */
function overlay(base: EventDraftFields, args: AiArgs, semester: SemesterRow): EventDraftFields {
  const fields = { ...base };
  const kind = optEnum(args, 'kind', KINDS);
  if (kind !== undefined && kind !== base.kind) Object.assign(fields, kindDefaults(kind));
  const title = optString(args, 'title');
  if (title !== undefined) {
    if (title === '') throw new AiArgError('标题不能为空');
    fields.title = title;
  }
  fields.date = optDate(args, 'date') ?? fields.date;
  fields.time = optTime(args, 'time') ?? fields.time;
  const start = clearableString(args, 'startTime');
  const end = clearableString(args, 'endTime');
  if (start === null || end === null) {
    fields.startTime = null;
    fields.endTime = null;
  } else if (start !== undefined || end !== undefined) {
    fields.startTime = optTime(args, 'startTime') ?? fields.startTime;
    fields.endTime = optTime(args, 'endTime') ?? fields.endTime;
    if (fields.startTime === null || fields.endTime === null) throw new AiArgError('startTime 与 endTime 要一起给出');
  }
  if (fields.startTime !== null && fields.endTime !== null && fields.endTime <= fields.startTime) {
    throw new AiArgError('endTime 应晚于 startTime');
  }
  for (const key of ['courseId', 'location', 'seatNo', 'note'] as const) {
    const value = clearableString(args, key);
    if (value !== undefined) fields[key] = value;
  }
  fields.countdown = optBool(args, 'countdown') ?? fields.countdown;
  fields.manualDone = optBool(args, 'manualDone') ?? fields.manualDone;
  fields.showInTimetable = optBool(args, 'showInTimetable') ?? fields.showInTimetable;
  fields.periodStart = optInt(args, 'periodStart', 1, MAX_PERIOD) ?? fields.periodStart;
  fields.periodEnd = optInt(args, 'periodEnd', 1, MAX_PERIOD) ?? fields.periodEnd;
  const weeks = optInts(args, 'weeks', 1, semester.total_weeks);
  if (weeks !== undefined) fields.weeks = weeks.length === 0 ? null : weeks;
  fields.dayOfWeek = optInt(args, 'dayOfWeek', 1, 7) ?? fields.dayOfWeek;
  if (fields.kind === 'lab') {
    if (fields.periodStart === null) throw new AiArgError('实验要给出 periodStart');
    fields.periodEnd = Math.max(fields.periodStart, fields.periodEnd ?? fields.periodStart);
    if (fields.weeks !== null && fields.dayOfWeek === null) fields.dayOfWeek = isoWeekday(fields.date);
  }
  return fields;
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function describe(write: EventWrite): string {
  const { fields } = write;
  const custom = fields.startTime !== null && fields.endTime !== null;
  const when = `${fields.date} ${custom ? `${fields.startTime}-${fields.endTime}` : fields.time}`;
  const course = write.courseName === null ? '' : `，关联「${write.courseName}」`;
  const place = fields.location === null || (fields.kind !== 'exam' && fields.kind !== 'lab') ? '' : `，${fields.location}`;
  const periods = fields.kind === 'lab' ? `，第 ${fields.periodStart}-${fields.periodEnd} 节` : '';
  const advance = write.advance === undefined ? '' : write.advance < 0 ? '，不提醒' : `，提前 ${write.advance} 分钟提醒`;
  return `${KIND_NAME[fields.kind]}「${fields.title}」${when}${periods}${place}${course}${advance}`;
}

async function writeReminder(context: AiCoreContext, eventId: string, advance: number | undefined): Promise<void> {
  if (advance === undefined) return;
  await syncEventReminder(context.storage, context.userId, eventId, advance);
}

export const createEventAction = defineAction<AiCoreContext, EventWrite>({
  name: 'create_event',
  description: '新建待办、作业、考试或实验；默认放在当前学期',
  parameters: objectSchema(
    {
      kind: schema.enumOf('类型：todo 待办 / homework 作业 / exam 考试 / lab 实验', KINDS),
      semesterId: schema.string('学期 id，默认当前学期'),
      ...FIELD_SCHEMA,
    },
    ['kind', 'title', 'date'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    const kind = reqEnum(args, 'kind', KINDS);
    const base: EventDraftFields = {
      ...kindDefaults(kind),
      title: reqString(args, 'title'),
      date: reqDate(args, 'date'),
      time: '09:00',
      startTime: null,
      endTime: null,
      courseId: null,
      location: null,
      seatNo: null,
      note: null,
      showInTimetable: kind === 'lab',
      periodStart: null,
      periodEnd: null,
      weeks: null,
      dayOfWeek: null,
    };
    const fields = overlay(base, args, semester);
    const courseName = await courseNameOf(context, semester, fields.kind === 'exam' ? null : fields.courseId);
    const advance = optInt(args, 'advanceMinutes', -1, MAX_ADVANCE) ?? DEFAULT_ADVANCE;
    return { semester, fields, advance, row: null, courseName };
  },
  preview: (write) => `新建${describe(write)}`,
  async run(write, context) {
    const columns = eventColumnsOf(write.fields, write.semester.id, context.timeZone);
    const created = await createEvent(context.storage, createInputOf(columns, context.userId));
    if (write.advance !== undefined && write.advance >= 0) await writeReminder(context, String(created['id']), write.advance);
    return `已新建${KIND_NAME[write.fields.kind]}「${write.fields.title}」`;
  },
});

async function entryRow(context: AiCoreContext, id: string): Promise<EventRow> {
  const row = await context.storage.collection<EventRow>('events').get(id);
  if (row === undefined || row.deleted_at !== null || row.user_id !== context.userId) throw new AiArgError(`找不到日程 ${id}`);
  if (!(AI_ENTRY_TYPES as readonly string[]).includes(row.type)) throw new AiArgError(`${id} 不是日程条目`);
  return row;
}

export const updateEventAction = defineAction<AiCoreContext, EventWrite>({
  name: 'update_event',
  description: '修改一条待办、作业、考试或实验；只改传了的字段',
  parameters: objectSchema(
    {
      id: schema.string('日程 id'),
      kind: schema.enumOf('改成的类型', KINDS),
      ...FIELD_SCHEMA,
    },
    ['id'],
  ),
  risk: 'write',
  async parse(args, context) {
    const row = await entryRow(context, reqString(args, 'id'));
    const semester = await semesterOf(context, row.semester_id === null ? {} : { semesterId: row.semester_id });
    const form = todoFormFromEvent(row, { timeZone: context.timeZone, totalWeeks: semester.total_weeks, now: context.now() });
    const base: EventDraftFields = {
      kind: kindOfEvent(row),
      title: form.title,
      date: form.dueDate,
      time: form.dueTime,
      startTime: form.customTime ? form.startTime : null,
      endTime: form.customTime ? form.endTime : null,
      courseId: row.subject,
      location: row.location,
      seatNo: row.seat_no,
      note: row.note,
      countdown: form.countdown,
      manualDone: form.manualDone,
      showInTimetable: form.showInTimetable,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      weeks: row.weeks_mask === null ? null : form.labWeeks,
      dayOfWeek: row.as_day_of_week,
    };
    const fields = overlay(base, args, semester);
    const courseName = await courseNameOf(context, semester, fields.kind === 'exam' ? null : fields.courseId);
    return { semester, fields, advance: optInt(args, 'advanceMinutes', -1, MAX_ADVANCE), row, courseName };
  },
  preview: (write) => `修改为${describe(write)}`,
  async run(write, context) {
    const row = write.row as EventRow;
    const columns = eventColumnsOf(write.fields, write.semester.id, context.timeZone);
    // 非实验沿用原来的性质标签，与表单一致
    if (write.fields.kind !== 'lab') columns['nature'] = row.nature;
    await updateEvent(context.storage, row.id, columns);
    await writeReminder(context, row.id, write.advance);
    return `已修改「${write.fields.title}」`;
  },
});

export const AI_EVENT_ACTIONS: readonly AiAction<AiCoreContext>[] = [createEventAction, updateEventAction];
