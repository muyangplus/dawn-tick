import type { Storage } from './storage.ts';
import type { CourseRow, CourseScheduleRow, EventRow } from './types.ts';
import { WEEKDAY_LABELS } from './time.ts';

export type SearchKind = 'course' | 'schedule' | 'event';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  score: number;
  courseId?: string | undefined;
  dayOfWeek?: number | undefined;
  periodStart?: number | undefined;
  periodEnd?: number | undefined;
  startAt?: number | undefined;
  /** 日程命中的日期（YYYY-MM-DD）：搜索后直接定位到这一天 */
  date?: string | undefined;
  /** 排课命中的周次位图：调用方按学期总周数换算命中周 */
  weeksMask?: number | undefined;
}

/** 前缀命中给 3 分，中间命中给 2 分，未命中 0 分。 */
export function matchScore(text: string | null | undefined, keyword: string): number {
  if (text === null || text === undefined) return 0;
  const needle = keyword.trim().toLowerCase();
  if (needle.length === 0) return 0;
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return 0;
  return index === 0 ? 3 : 2;
}

function bestScore(values: readonly (string | null | undefined)[], keyword: string): number {
  let best = 0;
  for (const value of values) best = Math.max(best, matchScore(value, keyword));
  return best;
}

export async function searchAll(
  storage: Storage,
  semesterId: string,
  keyword: string,
  limit = 30,
): Promise<SearchHit[]> {
  if (keyword.trim().length === 0) return [];

  const [courses, schedules, events] = await Promise.all([
    storage.collection<CourseRow>('courses').getAll(),
    storage.collection<CourseScheduleRow>('course_schedules').getAll(),
    storage.collection<EventRow>('events').getAll(),
  ]);

  const activeCourses = courses.filter((row) => row.deleted_at === null && row.semester_id === semesterId);
  const courseById = new Map(activeCourses.map((row) => [row.id, row]));
  const hits: SearchHit[] = [];

  for (const course of activeCourses) {
    const score = bestScore(
      [course.name, course.short_name, course.teacher, course.location, course.note],
      keyword,
    );
    if (score === 0) continue;
    hits.push({
      kind: 'course',
      id: course.id,
      title: course.name,
      subtitle: [course.teacher, course.location].filter((item) => item !== null).join(' · '),
      score,
      courseId: course.id,
    });
  }

  for (const schedule of schedules) {
    if (schedule.deleted_at !== null) continue;
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    const score = bestScore([schedule.room ?? course.location, schedule.weeks_raw, course.name], keyword);
    if (score === 0) continue;
    hits.push({
      kind: 'schedule',
      id: schedule.id,
      title: course.name,
      subtitle: `${WEEKDAY_LABELS[schedule.day_of_week - 1] ?? ''} 第 ${schedule.period_start}-${schedule.period_end} 节 · ${schedule.weeks_raw ?? ''}`.trim(),
      score,
      courseId: course.id,
      dayOfWeek: schedule.day_of_week,
      periodStart: schedule.period_start,
      periodEnd: schedule.period_end,
      ...(schedule.weeks_mask === null ? {} : { weeksMask: schedule.weeks_mask }),
    });
  }

  for (const event of events) {
    if (event.deleted_at !== null || event.semester_id !== semesterId) continue;
    const score = bestScore([event.title, event.location, event.note, event.subject], keyword);
    if (score === 0) continue;
    hits.push({
      kind: 'event',
      id: event.id,
      title: event.title,
      subtitle: [event.on_date, event.location].filter((item) => item !== null && item !== undefined).join(' · '),
      score,
      startAt: event.start_at ?? undefined,
      ...(event.on_date === null ? {} : { date: event.on_date }),
    });
  }

  return hits
    .sort((left, right) => (right.score === left.score ? left.title.localeCompare(right.title) : right.score - left.score))
    .slice(0, limit);
}
