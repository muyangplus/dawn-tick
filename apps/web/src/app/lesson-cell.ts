import { dayOfWeek as nextDayOfWeek } from '@dawn-tick/core';
import { formatMonthDayRange } from '../lib/dates.ts';
import type { AdjustTarget } from '../components/adjust-dialog.tsx';
import type { AppData, CourseDetail, LessonCell } from '../data.ts';

/** 课程详情：格子 + 详情数据 + 这一课次所在日期（详情页的「调课」用它作原日期） */
export interface DetailState {
  cell: LessonCell;
  detail: CourseDetail;
  /** 这一课次所在的日期：详情页的「调课」把它作为原日期 */
  date: string;
}

/** 窗口覆盖的日期区间文案，例如 8/19–8/23。 */
export function formatWindowRange(data: AppData): string {
  const last = data.windowDates[data.windowDates.length - 1] ?? data.windowStart;
  return formatMonthDayRange(data.windowStart, last);
}

/** 按当天课次还原课程卡信息：时间线课次不是周视图格子，详情与周视图共用同一份数据。 */
export function lessonCellOf(data: AppData, target: AdjustTarget): LessonCell {
  const occurrence = (data.lessonsByDate.get(target.date) ?? []).find(
    (item) => item.scheduleId === target.scheduleId,
  );
  const periodStart = occurrence?.periodStart ?? target.periodStart;
  const periodEnd = occurrence?.periodEnd ?? target.periodEnd;
  const slotOf = (period: number): string =>
    data.slots.find((slot) => slot.period_no === period)?.start_time ?? '';
  const endSlotOf = (period: number): string =>
    data.slots.find((slot) => slot.period_no === period)?.end_time ?? '';
  return {
    scheduleId: target.scheduleId,
    courseId: target.courseId,
    name: occurrence?.shortName ?? occurrence?.courseName ?? target.courseName,
    teacher: null,
    room: occurrence?.room ?? null,
    color: occurrence?.color ?? 'var(--dt-primary)',
    dayOfWeek: nextDayOfWeek(target.date),
    date: target.date,
    periodStart,
    periodEnd,
    startTime: slotOf(periodStart),
    endTime: endSlotOf(periodEnd),
    inWeek: true,
    holiday: data.holidayLabels.has(target.date),
    cancelled: false,
    movedOut: false,
    movedIn: false,
    lab: false,
  };
}
