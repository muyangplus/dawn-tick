// 学期上下文：查看窗口、周次与假期。
import {
  addDays,
  builtinHolidayName,
  builtinHolidays,
  builtinWorkdayName,
  builtinWorkdays,
  dayOfWeek,
  isWeekend,
  maskToWeeks,
  nextWorkday,
  weekOfDate,
  weekStart,
  type AppSettings,
  type EventRow,
  type SemesterRow,
} from '@dawn-tick/core';
import { clampWindowStart, dayRangeOf } from '../lib/day-nav.ts';
import { formatCopy } from '../copy/format.ts';

export function weekDateOf(semester: SemesterRow, week: number, dayOfWeek: number): string {
  return addDays(weekStart(semester.start_date), (week - 1) * 7 + (dayOfWeek - 1));
}

/** 没指定窗口起点时的默认起点：今天为第一天，或本周周一；跳过周末时顺延到下一个工作日。 */
export function defaultWindowStart(today: string, settings: AppSettings): string {
  return resolveWindowStart(settings.weekStartsToday ? today : weekStart(today), settings);
}

/** 窗口起点落到周末时顺延到下一个工作日；没开「不显示周末」时原样返回。 */
export function resolveWindowStart(date: string, settings: AppSettings): string {
  return settings.hideWeekends ? nextWorkday(date) : date;
}

/** 排课落在哪些周次：没有位图时只有 fallback 那一周。 */
export function weeksOf(mask: number | null, totalWeeks: number, fallback: number): number[] {
  if (mask === null || mask === undefined) return [fallback];
  return maskToWeeks(mask, totalWeeks);
}

/** 学期上下文：查看窗口覆盖哪几天、每天属于第几周。纯计算，不读 storage。 */
export interface SemesterContext {
  /** 今天所在周次（早于第 1 周时为 1） */
  currentWeek: number;
  /** 窗口第一天所在周次，夹在 1–总周数之间 */
  viewWeek: number;
  /** 窗口第一天的日期 */
  windowStart: string;
  /** 窗口里的每一天 */
  windowDates: string[];
  /** 窗口里每天所属的周次，与 `windowDates` 一一对应；早于第 1 周为 0，晚于总周数为溢出值 */
  weekOfDay: number[];
  /** 查看窗口的周一起点：用于「本周」标签与调课预填 */
  weekStartDate: string;
  windowSpansWeeks: boolean;
}

/**
 * 算查看窗口：显式起点优先，其次指定周次的周一，都没有按设置取今天或本周周一；
 * 最后夹进学期（Q6：今天落在学期外时窗口停在边界）。
 */
export function loadSemesterContext(input: {
  semester: SemesterRow;
  today: string;
  settings: AppSettings;
  options?: { viewWeek?: number; windowStart?: string | null };
}): SemesterContext {
  const { semester, today, settings } = input;
  const options = input.options ?? {};
  const currentWeek = Math.max(1, weekOfDate(today, semester.start_date));
  const windowStart = clampWindowStart(
    resolveWindowStart(
      options.windowStart ??
        (options.viewWeek === undefined ? defaultWindowStart(today, settings) : weekDateOf(semester, options.viewWeek, 1)),
      settings,
    ),
    dayRangeOf(semester),
  );
  const viewDays = Math.max(1, settings.viewDays);
  const windowDates: string[] = [];
  for (let offset = 0; windowDates.length < viewDays && offset < viewDays * 3 + 7; offset += 1) {
    const date = addDays(windowStart, offset);
    if (settings.hideWeekends && isWeekend(date)) continue;
    windowDates.push(date);
  }
  const weekOfDay = windowDates.map((date) => weekOfDate(date, semester.start_date));
  const viewWeek = Math.min(Math.max(1, weekOfDay[0] ?? currentWeek), semester.total_weeks);
  return {
    currentWeek,
    viewWeek,
    windowStart,
    windowDates,
    weekOfDay,
    weekStartDate: weekDateOf(semester, viewWeek, 1),
    windowSpansWeeks: new Set(weekOfDay).size > 1,
  };
}

/** 放假与调休：内置节假日表 + 手工「设为假日 / 非假日」，纯计算。 */
export interface HolidayContext {
  /** 放假日 → 名称 */
  holidayLabels: Map<string, string>;
  /** 放假日集合（判定灰色课次用） */
  holidayDates: Set<string>;
  /** 调休上班日，升序 */
  workdays: string[];
}

export function loadHolidays(events: readonly EventRow[]): HolidayContext {
  const holidayLabels = new Map<string, string>();
  for (const date of builtinHolidays()) holidayLabels.set(date, builtinHolidayName(date) ?? formatCopy.holidayFallback);
  const workdays = new Set(builtinWorkdays().filter((date) => builtinWorkdayName(date) !== null));
  for (const row of events) {
    const date = row.on_date;
    if (typeof date !== 'string') continue;
    if (row.type === 'holiday') holidayLabels.set(date, row.title);
    if (row.type === 'workday') {
      holidayLabels.delete(date);
      workdays.add(date);
    }
  }
  return { holidayLabels, holidayDates: new Set(holidayLabels.keys()), workdays: [...workdays].sort() };
}
