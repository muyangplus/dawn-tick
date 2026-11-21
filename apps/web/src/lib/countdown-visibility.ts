import { addDays, dateWallClockToEpoch, formatDate } from '@dawn-tick/core';

/** 倒计时去留只看这几列：首页卡片、桌面小窗与安卓小组件共用。 */
export interface CountdownSource {
  on_date?: string | null;
  start_at?: number | null;
  end_at?: number | null;
  due_at?: number | null;
  done?: number | null;
  updated_at?: number | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nextDayStart(date: string, timeZone: string): number {
  return dateWallClockToEpoch(addDays(date, 1), '00:00', timeZone);
}

/**
 * 条目从倒计时里消失的时刻；null 表示没有可判断的时间，一直显示。
 * - 结束：结束时间 → 开始时间 → 截止时间 → 只有日期的过完当天；
 * - 完成：勾选完成那天（取修改时间）的次日 00:00。
 * 两者取先到的那个。
 */
export function countdownHideAt(row: CountdownSource, timeZone: string): number | null {
  let ended = finite(row.end_at) ?? finite(row.start_at) ?? finite(row.due_at);
  if (ended === null && typeof row.on_date === 'string' && DATE_ONLY.test(row.on_date)) {
    ended = nextDayStart(row.on_date, timeZone);
  }
  const doneAt = row.done === 1 ? finite(row.updated_at) : null;
  const doneHide = doneAt === null ? null : nextDayStart(formatDate(doneAt, timeZone), timeZone);
  if (ended === null) return doneHide;
  if (doneHide === null) return ended;
  return Math.min(ended, doneHide);
}

export function isCountdownVisible(row: CountdownSource, now: number, timeZone: string): boolean {
  const hideAt = countdownHideAt(row, timeZone);
  return hideAt === null || now < hideAt;
}
