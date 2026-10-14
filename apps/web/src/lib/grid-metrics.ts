import type { LessonCell } from '../data.ts';

/**
 * 课表网格的分钟换算：节次行统一行高，头部/尾部补白按真实分钟展开。
 * 单独放在这里便于用 node:test 直接量算（jsdom 量不到真实布局）。
 */

/** 头部/尾部补白最多各三行：个别写错的作息或时间不会把网格撑得离谱。 */
export const PAD_MAX_ROWS = 3;

export interface GridSlot {
  periodNo: number;
  startTime: string;
  endTime: string;
}

export interface GridMetrics {
  /** 头部补白高度（像素） */
  padTop: number;
  /** 尾部补白高度（像素） */
  padBottom: number;
  /** 第一节开始、最后一节结束的分钟数 */
  firstMinute: number;
  lastMinute: number;
  /** 一行行高对应的分钟数（各节时长取平均），补白与课间按它折算 */
  minutesPerRow: number;
}

/** 墙钟 HH:MM → 当天分钟数；空值与非法值返回 null。 */
export function minuteOf(clock: string | null | undefined): number | null {
  if (clock === null || clock === undefined || clock === '') return null;
  const [hour, minute] = clock.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour as number) * 60 + (minute as number);
}

/**
 * 网格按真实分钟向上/向下扩展：头部与尾部补白的多少只由自定义时间条目的伸缩决定，
 * 节次行本身仍是统一的 rowHeight。
 */
export function gridMetrics(
  slots: readonly GridSlot[],
  lessons: readonly Pick<LessonCell, 'customStart' | 'customEnd'>[],
  rowHeight: number,
): GridMetrics {
  const first = slots[0];
  const last = slots[slots.length - 1];
  const firstMinute = (first === undefined ? 0 : minuteOf(first.startTime)) ?? 0;
  const lastMinute = (last === undefined ? firstMinute : minuteOf(last.endTime)) ?? firstMinute;
  const durations = slots
    .map((slot) => (minuteOf(slot.endTime) ?? 0) - (minuteOf(slot.startTime) ?? 0))
    .filter((value) => value > 0);
  const minutesPerRow =
    durations.length === 0 ? 45 : durations.reduce((total, value) => total + value, 0) / durations.length;
  const pxPerMinute = rowHeight / minutesPerRow;
  let extendStart = firstMinute;
  let extendEnd = lastMinute;
  for (const lesson of lessons) {
    const start = minuteOf(lesson.customStart);
    const end = minuteOf(lesson.customEnd);
    if (start !== null) extendStart = Math.min(extendStart, start);
    if (end !== null) extendEnd = Math.max(extendEnd, end);
  }
  const maxPad = rowHeight * PAD_MAX_ROWS;
  return {
    padTop: Math.round(Math.min(maxPad, Math.max(0, (firstMinute - extendStart) * pxPerMinute))),
    padBottom: Math.round(Math.min(maxPad, Math.max(0, (extendEnd - lastMinute) * pxPerMinute))),
    firstMinute,
    lastMinute,
    minutesPerRow,
  };
}

/** 墙钟分钟 → 网格内纵向像素（含头部补白）：节内行内线性，课间与补白按分钟折算。 */
export function minuteToY(
  minute: number,
  slots: readonly GridSlot[],
  rowHeight: number,
  metrics: GridMetrics,
): number {
  const pxPerMinute = rowHeight / metrics.minutesPerRow;
  if (slots.length === 0) return metrics.padTop;
  if (minute <= metrics.firstMinute) {
    return metrics.padTop - (metrics.firstMinute - minute) * pxPerMinute;
  }
  if (minute >= metrics.lastMinute) {
    return metrics.padTop + slots.length * rowHeight + (minute - metrics.lastMinute) * pxPerMinute;
  }
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot === undefined) continue;
    const from = minuteOf(slot.startTime) ?? 0;
    const to = minuteOf(slot.endTime) ?? from;
    if (to > from && minute >= from && minute <= to) {
      return metrics.padTop + index * rowHeight + ((minute - from) / (to - from)) * rowHeight;
    }
  }
  for (let index = 0; index < slots.length - 1; index += 1) {
    const end = minuteOf(slots[index]?.endTime) ?? 0;
    const nextStart = minuteOf(slots[index + 1]?.startTime) ?? end;
    if (nextStart > end && minute > end && minute < nextStart) {
      return metrics.padTop + (index + (minute - end) / (nextStart - end)) * rowHeight;
    }
  }
  return metrics.padTop;
}

/** 补白区的起止时间文案，例如 07:00–08:00。 */
export function padLabel(fromMinute: number, toMinute: number): string {
  const text = (value: number): string =>
    `${`${Math.floor(value / 60)}`.padStart(2, '0')}:${`${value % 60}`.padStart(2, '0')}`;
  return `${text(fromMinute)}–${text(toMinute)}`;
}
