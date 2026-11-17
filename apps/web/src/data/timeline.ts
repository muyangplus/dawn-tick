// 今天/明天的课与当前、下一节。
import { addDays, currentOccurrence, nextOccurrence, type Occurrence } from '@dawn-tick/core';

/** 时间线数据：按日期归档的课次与「正在上 / 下一节」。纯计算，不读 storage。 */
export interface TimelineData {
  lessonsByDate: Map<string, Occurrence[]>;
  todayLessons: Occurrence[];
  tomorrowLessons: Occurrence[];
  currentLesson: Occurrence | undefined;
  nextLesson: Occurrence | undefined;
}

export function buildTimelineData(input: {
  occurrences: readonly Occurrence[];
  today: string;
  now: number;
}): TimelineData {
  const lessonsByDate = new Map<string, Occurrence[]>();
  for (const item of input.occurrences) {
    if (item.cancelled) continue;
    const list = lessonsByDate.get(item.date) ?? [];
    list.push(item);
    lessonsByDate.set(item.date, list);
  }
  return {
    lessonsByDate,
    todayLessons: lessonsByDate.get(input.today) ?? [],
    tomorrowLessons: lessonsByDate.get(addDays(input.today, 1)) ?? [],
    currentLesson: currentOccurrence(input.occurrences, input.now),
    nextLesson: nextOccurrence(input.occurrences, input.now),
  };
}
