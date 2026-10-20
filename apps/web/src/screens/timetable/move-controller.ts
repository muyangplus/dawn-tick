import {
  createCourse,
  createEvent,
  createReschedule,
  createSchedule,
  dayOfWeek,
  rangesOverlap,
  updateSchedule,
  weekOfDate,
  weeksIntersect,
  type ManagedCourse,
  type ManagedSchedule,
  type SemesterRow,
  type Storage,
} from '@dawn-tick/core';
import { dayRangeOf, type DayRange } from '../../lib/day-nav.ts';
import { weekDateOf } from '../../data.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 调课弹窗的四个主操作。 */
export type AdjustMode = 'move' | 'cancel' | 'swap' | 'extra';

/** 改期的四种生效范围。 */
export type AdjustScope = 'this' | 'weekly' | 'week' | 'date';

export interface AdjustTarget {
  scheduleId: string;
  courseId: string;
  courseName: string;
  /** 原日期，YYYY-MM-DD */
  date: string;
  periodStart: number;
  periodEnd: number;
  /** 拖动入口的落点：目标日期与目标起始节，打开时预填进「改期」 */
  drop?: { date: string; periodStart: number } | undefined;
  /** 入口预选的主操作，缺省为「改期」 */
  mode?: AdjustMode | undefined;
}

/** 目标位置上已有的课；只用来提醒，不拦截（课程允许重叠）。 */
export interface Overlap {
  name: string;
  start: number;
  end: number;
}

/** 节次是否可用：1 起、整数、结束不小于开始。 */
export function periodsValid(start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
}

/** 学期覆盖的日期区间（与 `dayRangeOf` 同一口径）。 */
export function semesterRangeOf(semester: Pick<SemesterRow, 'start_date' | 'total_weeks'> | null): DayRange | null {
  return semester === null ? null : dayRangeOf(semester);
}

/** 日期溢出判定：不在学期内时返回说明，null 表示可用。 */
export function semesterDateError(semester: SemesterRow | null, date: string, label: string): string | null {
  if (semester === null) return '还没有学期';
  if (!DATE_RE.test(date)) return `请先选择${label}`;
  const range = dayRangeOf(semester);
  if (date < range.first || date > range.last) return `${label}要在学期内（${range.first} 至 ${range.last}）`;
  return null;
}

/** 冲突判定：目标位置已有的课。week 为 null 表示不限周次（每周生效）。 */
export function overlapAt(
  courses: readonly ManagedCourse[],
  target: {
    dayOfWeek: number;
    periodStart: number;
    periodEnd: number;
    week: number | null;
    excludeCourseId: string;
  },
): Overlap | null {
  for (const course of courses) {
    if (course.id === target.excludeCourseId) continue;
    for (const schedule of course.schedules) {
      if (schedule.dayOfWeek !== target.dayOfWeek) continue;
      if (!rangesOverlap(schedule.periodStart, schedule.periodEnd, target.periodStart, target.periodEnd)) continue;
      if (target.week !== null && !weeksIntersect(schedule.weeks, [target.week])) continue;
      return { name: course.name, start: schedule.periodStart, end: schedule.periodEnd };
    }
  }
  return null;
}

/** 改期校验通过后的执行计划：每周改排课本身，其余只改原日期这一次课。 */
export interface MovePlan {
  /** weekly = 直接改课表；其余只记一次调课 */
  scope: AdjustScope;
  scheduleId: string;
  /** 生效日期：weekly 时是目标日（只取星期几），其余是最终落点 */
  finalDate: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  /** 调课的落点周次，用于按周冲突判定 */
  week: number | null;
}

export type MovePlanResult = { ok: true; plan: MovePlan } | { ok: false; message: string };

export interface MoveInput {
  semester: SemesterRow | null;
  schedule: ManagedSchedule | undefined;
  scope: AdjustScope;
  sourceDate: string;
  newDate: string;
  /** 「指定周」的周次输入框原文 */
  targetWeek: string;
  periodStart: number;
  periodEnd: number;
}

/** 改期：先做溢出/同位置/跨周校验，再给出要落库的计划；不写库。 */
export function planMove(input: MoveInput): MovePlanResult {
  const { semester, schedule } = input;
  if (semester === null || schedule === undefined) {
    return { ok: false, message: '请先选课程与要调整的课次' };
  }
  if (!periodsValid(input.periodStart, input.periodEnd)) {
    return { ok: false, message: '节次需要是 1 起、且结束不小于开始' };
  }
  const sourceError = semesterDateError(semester, input.sourceDate, '原日期');
  if (sourceError !== null) return { ok: false, message: sourceError };
  const targetError = semesterDateError(semester, input.newDate, '调整后日期');
  if (targetError !== null) return { ok: false, message: targetError };

  const targetDay = dayOfWeek(input.newDate);
  // 每周：直接改课表本身，不再记一次调课
  if (input.scope === 'weekly') {
    if (
      targetDay === schedule.dayOfWeek &&
      input.periodStart === schedule.periodStart &&
      input.periodEnd === schedule.periodEnd
    ) {
      return { ok: false, message: '目标位置和现在一样，没有需要调整的' };
    }
    return {
      ok: true,
      plan: {
        scope: 'weekly',
        scheduleId: schedule.id,
        finalDate: input.newDate,
        dayOfWeek: targetDay,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        week: null,
      },
    };
  }

  // 这一次 / 指定周 / 指定日期：都只改原日期这一次课
  let finalDate = input.newDate;
  if (input.scope === 'week') {
    const wanted = Number(input.targetWeek);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > semester.total_weeks) {
      return { ok: false, message: `目标周要在 1–${semester.total_weeks} 周之间` };
    }
    finalDate = weekDateOf(semester, wanted, targetDay);
    const overflow = semesterDateError(semester, finalDate, '目标周');
    if (overflow !== null) {
      const range = dayRangeOf(semester);
      return { ok: false, message: `目标周超出学期范围（${range.first} 至 ${range.last}）` };
    }
  }
  const sameWeek = weekOfDate(finalDate, semester.start_date) === weekOfDate(input.sourceDate, semester.start_date);
  if (input.scope === 'this' && !sameWeek) {
    return { ok: false, message: '「这一次」只改本周；跨周改用「指定日期」' };
  }
  if (finalDate === input.sourceDate && input.periodStart === schedule.periodStart && input.periodEnd === schedule.periodEnd) {
    return { ok: false, message: '目标位置和现在一样，没有需要调整的' };
  }
  return {
    ok: true,
    plan: {
      scope: input.scope,
      scheduleId: schedule.id,
      finalDate,
      dayOfWeek: dayOfWeek(finalDate),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      week: weekOfDate(finalDate, semester.start_date),
    },
  };
}

export interface MoveWriteInput {
  userId: string;
  semesterId: string;
  courseName: string;
  /** 被调整的那一次课的原日期 */
  sourceDate: string;
  room?: string | null;
}

/** 落库：每周改排课本身，其余记一条 move 调课。 */
export async function applyMove(storage: Storage, plan: MovePlan, input: MoveWriteInput): Promise<void> {
  if (plan.scope === 'weekly') {
    await updateSchedule(storage, plan.scheduleId, {
      day_of_week: plan.dayOfWeek,
      period_start: plan.periodStart,
      period_end: plan.periodEnd,
    });
    return;
  }
  await createReschedule(storage, {
    userId: input.userId,
    semesterId: input.semesterId,
    refScheduleId: plan.scheduleId,
    onDate: input.sourceDate,
    action: 'move',
    title: `调课：${input.courseName}`,
    newDate: plan.finalDate,
    newPeriodStart: plan.periodStart,
    newPeriodEnd: plan.periodEnd,
    newRoom: input.room ?? null,
    asDayOfWeek: plan.dayOfWeek,
  });
}

/** 停课校验：只看原日期是否落在学期内。 */
export function planCancel(input: {
  semester: SemesterRow | null;
  schedule: ManagedSchedule | undefined;
  sourceDate: string;
}): MovePlanResult {
  if (input.semester === null || input.schedule === undefined) {
    return { ok: false, message: '请先选课程与要停的课次' };
  }
  const error = semesterDateError(input.semester, input.sourceDate, '原日期');
  if (error !== null) return { ok: false, message: error };
  return {
    ok: true,
    plan: {
      scope: 'this',
      scheduleId: input.schedule.id,
      finalDate: input.sourceDate,
      dayOfWeek: input.schedule.dayOfWeek,
      periodStart: input.schedule.periodStart,
      periodEnd: input.schedule.periodEnd,
      week: null,
    },
  };
}

/** 落库：在原日期记一条停课。 */
export async function applyCancel(
  storage: Storage,
  plan: MovePlan,
  input: MoveWriteInput,
): Promise<void> {
  await createReschedule(storage, {
    userId: input.userId,
    semesterId: input.semesterId,
    refScheduleId: plan.scheduleId,
    onDate: input.sourceDate,
    action: 'cancel',
    title: `停课：${input.courseName}`,
  });
}

export interface SwapPlan {
  from: string;
  to: string;
}

/** 调休校验：两个日期都要在学期内。 */
export function planSwap(input: {
  semester: SemesterRow | null;
  restFrom: string;
  restTo: string;
}): { ok: true; plan: SwapPlan } | { ok: false; message: string } {
  if (input.semester === null) return { ok: false, message: '还没有学期' };
  const fromError = semesterDateError(input.semester, input.restFrom, '原日期课表');
  if (fromError !== null) return { ok: false, message: fromError };
  const toError = semesterDateError(input.semester, input.restTo, '目标上课日');
  if (toError !== null) return { ok: false, message: toError };
  return { ok: true, plan: { from: input.restFrom, to: input.restTo } };
}

/** 落库：把原日期那天的课表整体搬到目标上课日。 */
export async function applySwap(
  storage: Storage,
  plan: SwapPlan,
  input: { userId: string; semesterId: string },
): Promise<void> {
  await createEvent(storage, {
    userId: input.userId,
    semesterId: input.semesterId,
    type: 'makeup',
    title: `${plan.from} 的课表调到 ${plan.to}`,
    onDate: plan.to,
    asDayOfWeek: dayOfWeek(plan.from),
  });
}

export interface ExtraPlan {
  /** 用已有课程时非空 */
  courseId: string;
  /** 用自定义名称新建课程时非空 */
  newCourseName: string;
  date: string;
  dayOfWeek: number;
  week: number;
  periodStart: number;
  periodEnd: number;
}

/** 临时加课校验：要么选已有课程，要么给新课程名。 */
export function planExtra(input: {
  semester: SemesterRow | null;
  courseId: string;
  courseName: string;
  date: string;
  periodStart: number;
  periodEnd: number;
}): { ok: true; plan: ExtraPlan } | { ok: false; message: string } {
  if (input.semester === null) return { ok: false, message: '还没有学期' };
  const name = input.courseName.trim();
  if (input.courseId === '' && name.length === 0) {
    return { ok: false, message: '请选择课程或填写课程名称' };
  }
  if (!periodsValid(input.periodStart, input.periodEnd)) {
    return { ok: false, message: '节次需要是 1 起、且结束不小于开始' };
  }
  const error = semesterDateError(input.semester, input.date, '加课日期');
  if (error !== null) return { ok: false, message: error };
  return {
    ok: true,
    plan: {
      courseId: input.courseId,
      newCourseName: name,
      date: input.date,
      dayOfWeek: dayOfWeek(input.date),
      week: weekOfDate(input.date, input.semester.start_date),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
  };
}

/** 落库：新建课程（给了新名字时）并只加这一次的一节课。 */
export async function applyExtra(
  storage: Storage,
  plan: ExtraPlan,
  input: { semesterId: string },
): Promise<void> {
  let targetCourseId = plan.courseId;
  if (plan.newCourseName.length > 0) {
    const created = await createCourse(storage, {
      semesterId: input.semesterId,
      name: plan.newCourseName,
      shortName: plan.newCourseName.slice(0, 4),
    });
    targetCourseId = String(created['id']);
  }
  await createSchedule(storage, {
    courseId: targetCourseId,
    dayOfWeek: plan.dayOfWeek,
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
    weeks: [plan.week],
  });
}
