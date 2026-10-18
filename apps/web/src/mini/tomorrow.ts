import { addDays, nextWorkday } from '@dawn-tick/core';

/** 悬浮窗的「明日课程预告」判定：设置开启 + 预告那天有课 + 今天没课或今天的课都上完了。 */
export interface TomorrowPreviewInput {
  /** 设置里的「空日程提示明日预告」 */
  enabled: boolean;
  /** 今天各节课的结束时刻（UTC 毫秒） */
  todayEnds: readonly number[];
  /** 预告那天的课程节数 */
  tomorrowCount: number;
  now: number;
}

export function shouldShowTomorrow(input: TomorrowPreviewInput): boolean {
  if (!input.enabled || input.tomorrowCount === 0) return false;
  return input.todayEnds.every((endAt) => endAt <= input.now);
}

/** 明日预告在给定样式的悬浮窗里显示哪些课：最多 4 节。 */
export function tomorrowPreviewLessons<T>(lessons: readonly T[]): T[] {
  return lessons.slice(0, 4);
}

/** 预告看哪一天：默认明天；开了「始终不显示周末」时周末顺延到下一个工作日。 */
export function previewDateFor(today: string, hideWeekends: boolean): string {
  const tomorrow = addDays(today, 1);
  return hideWeekends ? nextWorkday(tomorrow) : tomorrow;
}
