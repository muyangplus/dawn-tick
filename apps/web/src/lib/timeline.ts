export interface TimelineSlot {
  periodNo: number;
  startTime: string;
  endTime: string;
}

export function minutesOfDay(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (match === null) throw new Error(`非法时间: ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export interface TimelineBounds {
  start: number;
  end: number;
}

export function timelineBounds(slots: readonly TimelineSlot[]): TimelineBounds | null {
  if (slots.length === 0) return null;
  const starts = slots.map((slot) => minutesOfDay(slot.startTime));
  const ends = slots.map((slot) => minutesOfDay(slot.endTime));
  return { start: Math.min(...starts), end: Math.max(...ends) };
}

/** 当前时刻在课表纵向范围内的比例；范围外返回 null。 */
export function nowRatio(
  slots: readonly TimelineSlot[],
  nowMinuteOfDay: number,
): number | null {
  const bounds = timelineBounds(slots);
  if (bounds === null) return null;
  const span = bounds.end - bounds.start;
  if (span <= 0) return null;
  if (nowMinuteOfDay < bounds.start || nowMinuteOfDay > bounds.end) return null;
  return (nowMinuteOfDay - bounds.start) / span;
}

/** 某节次区间在纵向范围内的起止比例。 */
export function slotRangeRatio(
  slots: readonly TimelineSlot[],
  startTime: string,
  endTime: string,
): { top: number; height: number } | null {
  const bounds = timelineBounds(slots);
  if (bounds === null) return null;
  const span = bounds.end - bounds.start;
  if (span <= 0) return null;
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  return {
    top: Math.max(0, (start - bounds.start) / span),
    height: Math.max(0, Math.min(1, (end - start) / span)),
  };
}

/** 第几节包含给定时刻；用于高亮当前节次。 */
export function currentPeriod(slots: readonly TimelineSlot[], nowMinuteOfDay: number): number | null {
  for (const slot of slots) {
    const start = minutesOfDay(slot.startTime);
    const end = minutesOfDay(slot.endTime);
    if (nowMinuteOfDay >= start && nowMinuteOfDay <= end) return slot.periodNo;
  }
  return null;
}

export function localMinuteOfDay(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
  return minutesOfDay(parts);
}
