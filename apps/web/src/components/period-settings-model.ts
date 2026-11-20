import {
  durationBetween,
  PERIOD_BREAK_MAX,
  PERIOD_BREAK_MIN,
  PERIOD_DURATION_MAX,
  PERIOD_DURATION_MIN,
  sectionOf,
  type PeriodSection,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { periodsCopy } from '../copy/timetable-periods.ts';

/** 每节时长与课间的可输入范围：与 core 的生成/顺延算法同一口径 */
export const MIN_DURATION = PERIOD_DURATION_MIN;
export const MAX_DURATION = PERIOD_DURATION_MAX;
export const DEFAULT_DURATION = 45;
export const MIN_BREAK = PERIOD_BREAK_MIN;
export const MAX_BREAK = PERIOD_BREAK_MAX;
export const DEFAULT_BREAK = 10;

/** 刚完成的单节改动，以及这次重排要用的时长。 */
export interface RerollDraft {
  /** 被改动的那一节，用于文案定位，也是重排的锚点 */
  periodNo: number;
  /** 被改动的那一节所属时段 */
  section: PeriodSection;
  /** 改结束时间时推算出的每节时长；没改结束时间时沿用设置里的值 */
  durationMinutes: number;
  /** 时长是否由刚才手改的结束时间推算而来 */
  durationFromEdit: boolean;
}

export function within(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** 重排参数越界时的说明，null 表示可以顺延重排。 */
export function paramError(durationMinutes: number, breakMinutes: number): string | null {
  if (!within(durationMinutes, MIN_DURATION, MAX_DURATION)) {
    return periodsCopy.durationOutOfRange(MIN_DURATION, MAX_DURATION, durationMinutes);
  }
  if (!within(breakMinutes, MIN_BREAK, MAX_BREAK)) {
    return periodsCopy.breakOutOfRange(MIN_BREAK, MAX_BREAK, breakMinutes);
  }
  return null;
}

/** 输入框下方的字段级错误：只标越界的那一项，避免两条重复文案。 */
export function durationFieldError(value: number): string | undefined {
  return within(value, MIN_DURATION, MAX_DURATION) ? undefined : periodsCopy.durationRange(MIN_DURATION, MAX_DURATION);
}

export function breakFieldError(value: number): string | undefined {
  return within(value, MIN_BREAK, MAX_BREAK) ? undefined : periodsCopy.breakRange(MIN_BREAK, MAX_BREAK);
}

/** 按名称、id、来源过滤作息预设；空关键词返回全部。 */
export function filterPresets<T extends { id: string; name: string; source?: string | undefined }>(
  all: readonly T[],
  query: string,
): readonly T[] {
  const keyword = query.trim().toLowerCase();
  if (keyword === '') return all;
  return all.filter(
    (preset) =>
      preset.name.toLowerCase().includes(keyword) ||
      preset.id.toLowerCase().includes(keyword) ||
      (preset.source ?? '').toLowerCase().includes(keyword),
  );
}

/** 一次时间改动对应的重排参数：改了结束时间就用推算出的时长，否则沿用设置里的时长。 */
export function timeDraft(
  slot: Pick<TimeSlotRow, 'period_no' | 'start_time' | 'end_time'>,
  changes: { startTime?: string; endTime?: string },
  duration: number,
): RerollDraft {
  const nextStart = changes.startTime ?? slot.start_time;
  const nextEnd = changes.endTime ?? slot.end_time;
  const editedDuration = changes.endTime === undefined ? null : durationBetween(nextStart, nextEnd);
  return {
    periodNo: slot.period_no,
    section: sectionOf(nextStart),
    durationMinutes: editedDuration ?? duration,
    durationFromEdit: editedDuration !== null,
  };
}

/** 顺延结果写回整表：只换起止时间，原有时段与备注保留，缺时段的按开始时间推断。 */
export function reflowedSlots(
  rows: ReadonlyArray<Pick<TimeSlotRow, 'period_no' | 'start_time' | 'end_time' | 'section' | 'label'>>,
  planned: ReadonlyArray<{ periodNo: number; start: string; end: string }>,
): Array<{ periodNo: number; startTime: string; endTime: string; section: PeriodSection; label: string | null }> {
  const times = new Map(planned.map((period) => [period.periodNo, period] as const));
  return rows.map((row) => {
    const next = times.get(row.period_no);
    const startTime = next?.start ?? row.start_time;
    return {
      periodNo: row.period_no,
      startTime,
      endTime: next?.end ?? row.end_time,
      section: row.section ?? sectionOf(startTime),
      label: row.label,
    };
  });
}
