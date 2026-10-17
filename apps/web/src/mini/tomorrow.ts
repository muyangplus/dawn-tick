/** 悬浮窗的「明日课程预告」判定：设置开启 + 明天有课 + 今天没课或今天的课都上完了。 */
export interface TomorrowPreviewInput {
  /** 设置里的「空日程提示明日预告」 */
  enabled: boolean;
  /** 今天各节课的结束时刻（UTC 毫秒） */
  todayEnds: readonly number[];
  /** 明天的课程节数 */
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
