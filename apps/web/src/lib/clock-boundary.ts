import { addDays, dateWallClockToEpoch } from '@dawn-tick/core';
import type { AppData } from '../data.ts';

/**
 * 下一次需要刷新「今天 / 正在上 / 下一节」的时刻：今天剩余课次的开始或结束，或当地午夜，取最早。
 * 返回值稍晚于边界（+1 秒），刷新时边界已过，状态能翻过去。
 */
export function nextRefreshAt(data: Pick<AppData, 'today' | 'timeZone' | 'todayLessons'>, now: number): number {
  let next = dateWallClockToEpoch(addDays(data.today, 1), '00:00', data.timeZone);
  for (const lesson of data.todayLessons) {
    for (const at of [lesson.startAt, lesson.endAt]) {
      if (at > now && at < next) next = at;
    }
  }
  return next + 1000;
}

/** 回到前台时是否值得重载：距上次载入超过一分钟，或日期已经变了。 */
export function shouldRefreshOnResume(loadedAt: number, loadedToday: string, now: number, today: string): boolean {
  return today !== loadedToday || now - loadedAt > 60_000;
}
