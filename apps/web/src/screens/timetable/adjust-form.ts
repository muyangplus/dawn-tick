import { weekOfDate } from '@dawn-tick/core';
import type { AdjustMode, AdjustScope, AdjustTarget } from './move-controller.ts';

/** 调课弹窗的全部输入：各模式共用一份，切换模式不丢已填内容。 */
export interface AdjustForm {
  mode: AdjustMode;
  scope: AdjustScope;
  // 改期 / 停课 / 改为考试共用
  courseId: string;
  scheduleId: string;
  sourceDate: string;
  // 改期（考试复用日期与节次）
  newDate: string;
  targetWeek: string;
  newStart: string;
  newEnd: string;
  newRoom: string;
  // 调休：把原日期课表整体搬到目标上课日
  restFrom: string;
  restTo: string;
  // 临时加课
  extraCourse: string;
  extraName: string;
  extraDate: string;
  extraStart: string;
  extraEnd: string;
  examNote: string;
}

export function blankAdjustForm(today: string): AdjustForm {
  return {
    mode: 'move',
    scope: 'this',
    courseId: '',
    scheduleId: '',
    sourceDate: today,
    newDate: today,
    targetWeek: '1',
    newStart: '1',
    newEnd: '2',
    newRoom: '',
    restFrom: today,
    restTo: today,
    extraCourse: '',
    extraName: '',
    extraDate: today,
    extraStart: '1',
    extraEnd: '2',
    examNote: '',
  };
}

export interface AdjustOpenContext {
  today: string;
  semesterStart: string | null;
  firstCourseId: string | undefined;
}

/**
 * 打开弹窗时要重置的字段：三个入口只传预填参数，弹窗不记忆上一次。
 * 带目标时按目标（及拖动落点）预填改期；落点跨周默认「指定日期」，同周按「这一次」。
 */
export function adjustFormOnOpen(target: AdjustTarget | null, context: AdjustOpenContext): Partial<AdjustForm> {
  const weekOf = (date: string): number =>
    context.semesterStart === null ? 1 : weekOfDate(date, context.semesterStart);
  if (target !== null) {
    const drop = target.drop;
    const newDate = drop?.date ?? target.date;
    const sameWeek = drop === undefined || context.semesterStart === null || weekOf(drop.date) === weekOf(target.date);
    return {
      mode: target.mode ?? 'move',
      courseId: target.courseId,
      scheduleId: target.scheduleId,
      sourceDate: target.date,
      newDate,
      newStart: String(drop?.periodStart ?? target.periodStart),
      newEnd: String(
        drop === undefined
          ? target.periodEnd
          : (drop.periodEnd ?? drop.periodStart + (target.periodEnd - target.periodStart)),
      ),
      newRoom: target.room ?? '',
      examNote: '',
      targetWeek: String(weekOf(newDate)),
      scope: sameWeek ? 'this' : 'date',
    };
  }
  return {
    mode: 'move',
    scope: 'this',
    sourceDate: context.today,
    newDate: context.today,
    newStart: '1',
    newEnd: '2',
    newRoom: '',
    examNote: '',
    targetWeek: String(weekOf(context.today)),
    extraDate: context.today,
    ...(context.firstCourseId === undefined ? {} : { courseId: context.firstCourseId }),
  };
}

/** 换课程后课次不在新课程里时，选第一个课次并带上它的节次；仍有效返回 null。 */
export function scheduleSelection(
  schedules: ReadonlyArray<{ id: string; periodStart: number; periodEnd: number }>,
  scheduleId: string,
): Partial<AdjustForm> | null {
  if (schedules.length === 0) return scheduleId === '' ? null : { scheduleId: '' };
  if (schedules.some((item) => item.id === scheduleId)) return null;
  const first = schedules[0];
  if (first === undefined) return null;
  return { scheduleId: first.id, newStart: String(first.periodStart), newEnd: String(first.periodEnd) };
}
