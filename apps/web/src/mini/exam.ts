import { formatDate } from '@dawn-tick/core';
import { formatMonthDayRange } from '../lib/dates.ts';
import { formatDayCountdown } from '../lib/format.ts';

/** 悬浮窗考试样式只需要条目里的这三个字段；用结构类型便于冒烟传桩数据。 */
export interface ExamWidgetSource {
  title: string;
  on_date: string | null;
  start_at: number | null;
}

/** 一场要在悬浮窗里展示的考试。 */
export interface ExamWidgetEntry {
  title: string;
  /** 展示用日期：`10/25`（优先用条目自己的日期，缺了按开考时间换算）。 */
  date: string;
  startAt: number;
}

export interface ExamWidgetView {
  /** 最近一场未过期考试；没有则为 null。 */
  next: ExamWidgetEntry | null;
  /** 未过期考试总场数：超过 1 场时悬浮窗额外标注「共 N 场」。 */
  total: number;
}

/** 无考试时的空态文案（悬浮窗与冒烟同源）。 */
export const EXAM_EMPTY_TEXT = '暂无考试';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 考试倒计时数据：按开考时间升序取最近一场；已过当天（按用户时区判断，
 * 考试当天仍保留）的不再算「下一场」。日期优先用条目自带的 `on_date`。
 */
export function examWidgetView(
  exams: readonly ExamWidgetSource[],
  now: number,
  timeZone: string,
): ExamWidgetView {
  const today = formatDate(now, timeZone);
  const upcoming = exams
    .filter(
      (exam): exam is ExamWidgetSource & { start_at: number } =>
        typeof exam.start_at === 'number' && Number.isFinite(exam.start_at) && exam.start_at > 0,
    )
    .filter((exam) => formatDate(exam.start_at, timeZone) >= today)
    .sort((left, right) => left.start_at - right.start_at)
    .map((exam) => ({
      title: exam.title,
      date: formatMonthDayRange(
        exam.on_date !== null && DATE_ONLY.test(exam.on_date)
          ? exam.on_date
          : formatDate(exam.start_at, timeZone),
      ),
      startAt: exam.start_at,
    }));
  return { next: upcoming[0] ?? null, total: upcoming.length };
}

/** 倒计时文案：`还有 N 天`；考试当天 `formatDayCountdown` 给「今天」，换成「就是今天」。 */
export function examCountdownText(startAt: number, now: number): string {
  const days = formatDayCountdown(startAt, now);
  return days === '今天' ? '就是今天' : `还有 ${days}`;
}
