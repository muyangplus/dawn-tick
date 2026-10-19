import { addDays, nextWorkday, previousWorkday, weekStart, type SemesterRow } from '@dawn-tick/core';

/** 日模式能翻的日期范围：学期第一周周一至最后一周周日。 */
export interface DayRange {
  first: string;
  last: string;
}

export function dayRangeOf(semester: Pick<SemesterRow, 'start_date' | 'total_weeks'>): DayRange {
  const first = weekStart(semester.start_date);
  return { first, last: addDays(first, semester.total_weeks * 7 - 1) };
}

/** 日模式的默认日期：开了「不显示周末」时周末顺延到下一个工作日。 */
export function defaultDayDate(today: string, hideWeekends: boolean): string {
  return hideWeekends ? nextWorkday(today) : today;
}

/** 把日期夹到学期范围内。 */
export function clampDayDate(date: string, range: DayRange): string {
  if (date < range.first) return range.first;
  if (date > range.last) return range.last;
  return date;
}

/** 前后翻一天：跳过周末、停在学期边界；翻不动时返回 null。 */
export function stepDay(
  date: string,
  delta: -1 | 1,
  options: { hideWeekends: boolean; range: DayRange },
): string | null {
  const neighbor = addDays(date, delta);
  const candidate = options.hideWeekends
    ? delta > 0
      ? nextWorkday(neighbor)
      : previousWorkday(neighbor)
    : neighbor;
  if (candidate < options.range.first || candidate > options.range.last) return null;
  return candidate;
}
