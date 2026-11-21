/**
 * 助手的调课动作：改期、停课 / 结课、调休、临时加课、改为考试、删除调整。
 * 校验与落库都走课表调整弹窗同一套 plan / apply，助手只负责把参数找齐。
 */
import {
  AiArgError,
  defineAction,
  deleteEvent,
  listManagedCourses,
  listTimeSlots,
  loadSemester,
  objectSchema,
  optDate,
  optEnum,
  optInt,
  optString,
  reqDate,
  reqInt,
  reqString,
  schema,
  semesterOf,
  type AiAction,
  type AiCoreContext,
  type EventRow,
  type ManagedCourse,
  type ManagedSchedule,
  type SemesterRow,
} from '@dawn-tick/core';
import {
  applyCancelBatch,
  applyExam,
  applyExtra,
  applyMove,
  applySwap,
  planCancelBatch,
  planExam,
  planExtra,
  planMove,
  planSwap,
  type AdjustScope,
  type CancelEntry,
  type CancelRange,
  type CancelTarget,
  type ExamPlan,
  type ExtraPlan,
  type MovePlan,
  type SwapPlan,
} from '../screens/timetable/move-controller.ts';

const MAX_PERIOD = 20;

interface LessonRef {
  semester: SemesterRow;
  course: ManagedCourse;
  schedule: ManagedSchedule;
}

/** 由排课 id 找到它的课程与学期。 */
async function lessonOf(context: AiCoreContext, scheduleId: string): Promise<LessonRef> {
  const row = await context.storage.collection<{ course_id: string; deleted_at: number | null }>('course_schedules').get(scheduleId);
  if (row === undefined || row.deleted_at !== null) throw new AiArgError(`找不到排课 ${scheduleId}`);
  const courseRow = await context.storage.collection<{ semester_id: string; deleted_at: number | null }>('courses').get(row.course_id);
  if (courseRow === undefined || courseRow.deleted_at !== null) throw new AiArgError(`排课 ${scheduleId} 所属的课程已删除`);
  const semester = await loadSemester(context.storage, courseRow.semester_id);
  if (semester === undefined || semester.user_id !== context.userId) throw new AiArgError(`排课 ${scheduleId} 所在的学期已删除`);
  const course = (await listManagedCourses(context.storage, semester.id)).find((item) => item.id === row.course_id);
  const schedule = course?.schedules.find((item) => item.id === scheduleId);
  if (course === undefined || schedule === undefined) throw new AiArgError(`找不到排课 ${scheduleId}`);
  return { semester, course, schedule };
}

/** 模型可能给出没有课的日期：先确认那天确实有这一次课。 */
function requireLesson(ref: LessonRef, date: string): void {
  const found = planCancelBatch({
    semester: ref.semester,
    course: ref.course,
    schedule: ref.schedule,
    range: 'this',
    target: 'schedule',
    from: date,
    to: date,
    cancelledKeys: new Set(),
  });
  if (!found.ok) throw new AiArgError(`「${ref.course.name}」${date} 没有这节课`);
}

function unwrap<T>(result: { ok: true; plan: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new AiArgError(result.message);
  return result.plan;
}

function periodsOf(start: number, end: number): string {
  return start === end ? `第 ${start} 节` : `第 ${start}-${end} 节`;
}

// ---- 改期 ----

const SCOPES: readonly AdjustScope[] = ['this', 'weekly', 'week', 'date'];

interface MoveParams extends LessonRef {
  plan: MovePlan;
  sourceDate: string;
  room: string | null;
}

export const moveLessonAction = defineAction<AiCoreContext, MoveParams>({
  name: 'move_lesson',
  description:
    '调课改期。scope：this 同一周内挪到 newDate；date 挪到任意日期 newDate；week 挪到第 targetWeek 周、星期取 newDate 的星期；weekly 直接改课表，以后每周都按 newDate 的星期与新节次上',
  parameters: objectSchema(
    {
      scheduleId: schema.string('排课 id（get_lessons 或 list_courses 里的 scheduleId）'),
      date: schema.date('要调整的那一次课的原日期'),
      newDate: schema.date('新日期'),
      scope: schema.enumOf('生效范围，默认 date', SCOPES),
      targetWeek: schema.integer('scope 为 week 时的目标周次', 1),
      periodStart: schema.integer('新的起始节，默认不变', 1, MAX_PERIOD),
      periodEnd: schema.integer('新的结束节，默认按原来的节数', 1, MAX_PERIOD),
      room: schema.string('这一次换的教室（weekly 不用）'),
    },
    ['scheduleId', 'date', 'newDate'],
  ),
  risk: 'write',
  async parse(args, context) {
    const ref = await lessonOf(context, reqString(args, 'scheduleId'));
    const sourceDate = reqDate(args, 'date');
    requireLesson(ref, sourceDate);
    const scope = optEnum(args, 'scope', SCOPES) ?? 'date';
    const periodStart = optInt(args, 'periodStart', 1, MAX_PERIOD) ?? ref.schedule.periodStart;
    const span = ref.schedule.periodEnd - ref.schedule.periodStart;
    const periodEnd = optInt(args, 'periodEnd', 1, MAX_PERIOD) ?? Math.min(periodStart + span, MAX_PERIOD);
    const targetWeek = optInt(args, 'targetWeek', 1);
    if (scope === 'week' && targetWeek === undefined) throw new AiArgError('scope 为 week 时要给出 targetWeek');
    const plan = unwrap(
      planMove({
        semester: ref.semester,
        schedule: ref.schedule,
        scope,
        sourceDate,
        newDate: reqDate(args, 'newDate'),
        targetWeek: targetWeek === undefined ? '' : String(targetWeek),
        periodStart,
        periodEnd,
      }),
    );
    const room = optString(args, 'room');
    return { ...ref, plan, sourceDate, room: room === undefined || room === '' ? null : room };
  },
  preview({ course, plan, sourceDate, room }) {
    const target = periodsOf(plan.periodStart, plan.periodEnd);
    if (plan.scope === 'weekly') return `「${course.name}」以后每周改到星期${plan.dayOfWeek} ${target}`;
    return `「${course.name}」${sourceDate} 这次改到 ${plan.finalDate} ${target}${room === null ? '' : `，教室 ${room}`}`;
  },
  async run({ semester, course, plan, sourceDate, room }, context) {
    await applyMove(context.storage, plan, {
      userId: context.userId,
      semesterId: semester.id,
      courseName: course.name,
      sourceDate,
      room,
    });
    return plan.scope === 'weekly' ? `已改「${course.name}」的课表` : `已把「${course.name}」${sourceDate} 的课改到 ${plan.finalDate}`;
  },
});

// ---- 停课 / 结课 ----

const RANGES: readonly CancelRange[] = ['this', 'range', 'from'];
const TARGETS: readonly CancelTarget[] = ['schedule', 'course'];

interface CancelParams {
  semester: SemesterRow;
  course: ManagedCourse;
  entries: CancelEntry[];
  range: CancelRange;
  from: string;
  last: string;
}

/** 已停课的「排课|日期」。按排课 id 匹配：导入或同步来的停课记录可能没有 semester_id。 */
async function cancelledKeysOf(context: AiCoreContext): Promise<Set<string>> {
  const events = await context.storage.collection<EventRow>('events').getAll();
  return new Set(
    events
      .filter(
        (row) =>
          row.deleted_at === null &&
          row.user_id === context.userId &&
          row.type === 'reschedule' &&
          row.action === 'cancel' &&
          row.ref_schedule_id !== null &&
          row.on_date !== null,
      )
      .map((row) => `${row.ref_schedule_id}|${row.on_date}`),
  );
}

export const cancelLessonsAction = defineAction<AiCoreContext, CancelParams>({
  name: 'cancel_lessons',
  description:
    '停课或结课。range：this 只停 from 那天；range 停 from 到 to；from 从 from 起到学期结束（结课）。target：schedule 只停 scheduleId 这个时段；course 停整门课的全部时段。已停的不重复记',
  parameters: objectSchema(
    {
      scheduleId: schema.string('排课 id；target 为 schedule 时必填'),
      courseId: schema.string('课程 id；target 为 course 时可只给它'),
      target: schema.enumOf('停课对象，默认 schedule', TARGETS),
      range: schema.enumOf('停课范围，默认 this', RANGES),
      from: schema.date('起始日期'),
      to: schema.date('range 为 range 时的结束日期'),
    },
    ['from'],
  ),
  risk: 'write',
  async parse(args, context) {
    const target = optEnum(args, 'target', TARGETS) ?? 'schedule';
    const range = optEnum(args, 'range', RANGES) ?? 'this';
    const scheduleId = optString(args, 'scheduleId');
    let semester: SemesterRow;
    let course: ManagedCourse | undefined;
    let schedule: ManagedSchedule | undefined;
    if (scheduleId !== undefined && scheduleId !== '') {
      ({ semester, course, schedule } = await lessonOf(context, scheduleId));
    } else {
      if (target === 'schedule') throw new AiArgError('只停一个时段时要给出 scheduleId');
      const courseId = reqString(args, 'courseId');
      const row = await context.storage.collection<{ semester_id: string; deleted_at: number | null }>('courses').get(courseId);
      if (row === undefined || row.deleted_at !== null) throw new AiArgError(`找不到课程 ${courseId}`);
      semester = await semesterOf(context, { semesterId: row.semester_id });
      course = (await listManagedCourses(context.storage, semester.id)).find((item) => item.id === courseId);
    }
    const from = reqDate(args, 'from');
    const to = optDate(args, 'to') ?? from;
    if (range === 'range' && optDate(args, 'to') === undefined) throw new AiArgError('range 为 range 时要给出 to');
    const result = planCancelBatch({
      semester,
      course,
      schedule,
      range,
      target,
      from,
      to,
      cancelledKeys: await cancelledKeysOf(context),
    });
    if (!result.ok) throw new AiArgError(result.message);
    const entries = result.entries;
    return { semester, course: course as ManagedCourse, entries, range, from, last: entries[entries.length - 1]!.date };
  },
  preview({ course, entries, range, from, last }) {
    const span = entries.length === 1 ? entries[0]!.date : `${from} 至 ${last}`;
    return `${range === 'from' ? '结课' : '停课'}「${course.name}」${span}，共 ${entries.length} 次课`;
  },
  async run({ semester, course, entries }, context) {
    const count = await applyCancelBatch(context.storage, entries, {
      userId: context.userId,
      semesterId: semester.id,
      courseName: course.name,
    });
    return `已为「${course.name}」记 ${count} 次停课`;
  },
});

// ---- 调休 ----

interface SwapParams {
  semester: SemesterRow;
  plan: SwapPlan;
}

export const swapDayAction = defineAction<AiCoreContext, SwapParams>({
  name: 'swap_day',
  description: '调休：把 from 那天的课整体搬到 to 那天上（如周六补周一的课）。from 当天要另设假日时再调用 set_day_kind',
  parameters: objectSchema(
    {
      from: schema.date('原上课日：按这一天的课表上课'),
      to: schema.date('实际上课的日期'),
      semesterId: schema.string('学期 id，默认当前学期'),
    },
    ['from', 'to'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    return { semester, plan: unwrap(planSwap({ semester, restFrom: reqDate(args, 'from'), restTo: reqDate(args, 'to') })) };
  },
  preview: ({ plan }) => `调休：${plan.to} 上 ${plan.from} 的课`,
  async run({ semester, plan }, context) {
    await applySwap(context.storage, plan, { userId: context.userId, semesterId: semester.id });
    return `已记调休：${plan.to} 上 ${plan.from} 的课`;
  },
});

// ---- 临时加课 ----

interface ExtraParams {
  semester: SemesterRow;
  plan: ExtraPlan;
  courseName: string;
}

export const addExtraLessonAction = defineAction<AiCoreContext, ExtraParams>({
  name: 'add_extra_lesson',
  description: '临时加一次课：用已有课程（courseId）或按 courseName 新建一门课，只加 date 这一次',
  parameters: objectSchema(
    {
      courseId: schema.string('已有课程 id'),
      courseName: schema.string('没有 courseId 时新建的课程名'),
      date: schema.date('上课日期'),
      periodStart: schema.integer('起始节', 1, MAX_PERIOD),
      periodEnd: schema.integer('结束节，默认同起始节', 1, MAX_PERIOD),
      semesterId: schema.string('学期 id，默认当前学期'),
    },
    ['date', 'periodStart'],
  ),
  risk: 'write',
  async parse(args, context) {
    const semester = await semesterOf(context, args);
    const courseId = optString(args, 'courseId') ?? '';
    let courseName = optString(args, 'courseName') ?? '';
    if (courseId !== '') {
      const course = (await listManagedCourses(context.storage, semester.id)).find((item) => item.id === courseId);
      if (course === undefined) throw new AiArgError(`学期「${semester.name}」里没有课程 ${courseId}`);
      courseName = course.name;
    }
    const periodStart = reqInt(args, 'periodStart', 1, MAX_PERIOD);
    const plan = unwrap(
      planExtra({
        semester,
        courseId,
        // 用已有课程时不再新建
        courseName: courseId === '' ? courseName : '',
        date: reqDate(args, 'date'),
        periodStart,
        periodEnd: optInt(args, 'periodEnd', 1, MAX_PERIOD) ?? periodStart,
      }),
    );
    return { semester, plan, courseName };
  },
  preview: ({ plan, courseName }) =>
    `${plan.date} ${periodsOf(plan.periodStart, plan.periodEnd)}加一次「${courseName}」${plan.courseId === '' ? '（新课程）' : ''}`,
  async run({ semester, plan, courseName }, context) {
    await applyExtra(context.storage, plan, { semesterId: semester.id });
    return `已在 ${plan.date} 加一次「${courseName}」`;
  },
});

// ---- 改为考试 ----

interface ExamParams {
  semester: SemesterRow;
  plan: ExamPlan;
}

export const lessonToExamAction = defineAction<AiCoreContext, ExamParams>({
  name: 'lesson_to_exam',
  description: '把某一次课改为考试：这次课从课表移除，换成一条考试（进课表与倒计时）',
  parameters: objectSchema(
    {
      scheduleId: schema.string('排课 id'),
      date: schema.date('那一次课的原日期'),
      examDate: schema.date('考试日期，默认同原日期'),
      periodStart: schema.integer('考试起始节，默认原节次', 1, MAX_PERIOD),
      periodEnd: schema.integer('考试结束节', 1, MAX_PERIOD),
      title: schema.string('考试名称，默认课程名'),
      note: schema.string('备注'),
    },
    ['scheduleId', 'date'],
  ),
  risk: 'write',
  async parse(args, context) {
    const ref = await lessonOf(context, reqString(args, 'scheduleId'));
    const { semester, course, schedule } = ref;
    const sourceDate = reqDate(args, 'date');
    requireLesson(ref, sourceDate);
    const periodStart = optInt(args, 'periodStart', 1, MAX_PERIOD) ?? schedule.periodStart;
    const plan = unwrap(
      planExam({
        semester,
        schedule,
        courseId: course.id,
        courseName: optString(args, 'title') || course.name,
        sourceDate,
        date: optDate(args, 'examDate') ?? sourceDate,
        periodStart,
        periodEnd: optInt(args, 'periodEnd', 1, MAX_PERIOD) ?? (periodStart === schedule.periodStart ? schedule.periodEnd : periodStart),
        note: optString(args, 'note') ?? '',
        slots: await listTimeSlots(context.storage, semester.id),
        timeZone: semester.time_zone,
      }),
    );
    return { semester, plan };
  },
  preview: ({ plan }) => `${plan.sourceDate} 的课改为考试「${plan.title}」：${plan.date} ${plan.startTime}-${plan.endTime}`,
  async run({ semester, plan }, context) {
    await applyExam(context.storage, plan, { userId: context.userId, semesterId: semester.id });
    return `已改为考试「${plan.title}」`;
  },
});

// ---- 删除调整 ----

const ADJUSTMENT_TYPES: readonly string[] = ['reschedule', 'makeup'];

export const deleteAdjustmentAction = defineAction<AiCoreContext, EventRow>({
  name: 'delete_adjustment',
  description: '删除一条调课、停课或调休补课记录（get_lessons 的 adjustments 里的 id，或 dayKinds 里调休补课的 id），那次课恢复原样；假日与工作日用 set_day_kind 清除',
  parameters: objectSchema({ id: schema.string('调整记录 id') }, ['id']),
  risk: 'write',
  async parse(args, context) {
    const id = reqString(args, 'id');
    const row = await context.storage.collection<EventRow>('events').get(id);
    if (row === undefined || row.deleted_at !== null || row.user_id !== context.userId) throw new AiArgError(`找不到调整记录 ${id}`);
    if (!ADJUSTMENT_TYPES.includes(row.type)) throw new AiArgError(`${id} 不是调课、停课或调休记录`);
    return row;
  },
  preview: (row) => `删除「${row.title}」${row.on_date === null ? '' : `（${row.on_date}）`}`,
  async run(row, context) {
    await deleteEvent(context.storage, row.id);
    return `已删除「${row.title}」`;
  },
});

export const AI_ADJUST_ACTIONS: readonly AiAction<AiCoreContext>[] = [
  moveLessonAction,
  cancelLessonsAction,
  swapDayAction,
  addExtraLessonAction,
  lessonToExamAction,
  deleteAdjustmentAction,
];
