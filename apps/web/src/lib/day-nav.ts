import { addDays, diffDays, nextWorkday, previousWorkday, weekStart, type SemesterRow } from '@dawn-tick/core';

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

/**
 * 翻页边界判定：候选目标存在且落在学期首/末周之内才算翻得动。
 * 日模式按天翻、周模式按屏翻，两种模式共用这一份口径。
 */
export function canStep(candidate: string | null, range: DayRange): boolean {
  return candidate !== null && candidate >= range.first && candidate <= range.last;
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
  if (!canStep(candidate, options.range)) return null;
  return candidate;
}

/**
 * 周视图窗口起点的可停范围：第一周周一 … 最后一周周一。
 * 最后一周周一起再往前翻一屏就会把窗口带出最后一周，所以周模式在这里停住。
 */
export function windowStartRange(range: DayRange): DayRange {
  return { first: range.first, last: addDays(range.last, -6) };
}

/** 把窗口起点夹进学期：早于第 1 周落到第一周周一，晚于最后一周落到最后一周周一。 */
export function clampWindowStart(start: string, range: DayRange): string {
  const bounds = windowStartRange(range);
  if (start < bounds.first) return bounds.first;
  if (start > bounds.last) return bounds.last;
  return start;
}

/** 窗口起点所在周次：第 1 周为 1，早于学期为 0 或负数。 */
export function weekOfWindow(start: string, range: DayRange): number {
  return Math.floor(diffDays(weekStart(start), range.first) / 7) + 1;
}

/** 学期总周数（由首末日期反推，两端口径与 weekOfWindow 一致）。 */
export function weeksOf(range: DayRange): number {
  return Math.floor(diffDays(range.last, range.first) / 7) + 1;
}

/**
 * 周模式前后翻一屏：第 1 周不能再往前、最后一周不能再往后（Q6：停在学期边界）；
 * 窗口已在学期外时只允许往学期内翻。翻不动返回 null，调用方据此置灰 ‹ ›。
 */
export function stepWindow(
  start: string,
  direction: -1 | 1,
  options: { days: number; range: DayRange; hideWeekends: boolean },
): string | null {
  const week = weekOfWindow(start, options.range);
  const weeks = weeksOf(options.range);
  // 学期内：第 1 周不再往前、最后一周不再往后（Q6：停在学期边界）
  if (week >= 1 && week <= weeks) {
    if (direction > 0 ? week >= weeks : week <= 1) return null;
    const candidate = addDays(start, direction * options.days);
    const shifted = options.hideWeekends
      ? direction > 0
        ? nextWorkday(candidate)
        : previousWorkday(candidate)
      : candidate;
    if (!canStep(shifted, options.range)) return null;
    return clampWindowStart(shifted, options.range);
  }
  // 学期外（学期数据刚被换掉时会短暂出现）：只允许朝学期方向翻，并直接停在边界
  if (direction > 0 ? week >= weeks : week <= 1) return null;
  return clampWindowStart(addDays(start, direction * options.days), options.range);
}
