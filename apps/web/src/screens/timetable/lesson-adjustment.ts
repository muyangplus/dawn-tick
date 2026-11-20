import type { EventRow, ManagedCourse } from '@dawn-tick/core';
import type { LessonCell } from '../../data.ts';
import { formatPeriodRange } from '../../lib/format.ts';
import { lessonCopy } from '../../copy/timetable-lesson.ts';
import type { AdjustTarget } from './move-controller.ts';

/** 课表单击已停课 / 调走 / 调入的课次时，详情顶部那句调整说明。 */
export function adjustmentSummary(cell: LessonCell, event: EventRow): string {
  const sourceDate = event.on_date ?? cell.date;
  if (event.action === 'cancel') return lessonCopy.adjustCancelled(sourceDate);
  const period =
    event.new_period_start === null ? null : formatPeriodRange(event.new_period_start, event.new_period_end ?? event.new_period_start);
  if (cell.movedIn) return lessonCopy.adjustMovedIn(sourceDate);
  return lessonCopy.adjustMovedOut(sourceDate, event.new_date ?? '', period);
}

/**
 * 「修改」：把已有的停课 / 调课记录还原成调课弹窗的预填目标；保存时新记录替换旧记录。
 * 找不到对应排课（课程或排课已删）返回 null。
 */
export function adjustmentEditTarget(event: EventRow, courses: readonly ManagedCourse[]): AdjustTarget | null {
  const scheduleId = event.ref_schedule_id;
  const date = event.on_date;
  if (scheduleId === null || scheduleId === undefined || date === null || date === undefined) return null;
  for (const course of courses) {
    const schedule = course.schedules.find((row) => row.id === scheduleId);
    if (schedule === undefined) continue;
    const moved = event.action === 'move' && event.new_date !== null;
    return {
      scheduleId,
      courseId: course.id,
      courseName: course.name,
      date,
      periodStart: schedule.periodStart,
      periodEnd: schedule.periodEnd,
      mode: event.action === 'cancel' ? 'cancel' : 'move',
      drop: moved
        ? {
            date: event.new_date as string,
            periodStart: event.new_period_start ?? schedule.periodStart,
            periodEnd: event.new_period_end ?? event.new_period_start ?? schedule.periodEnd,
          }
        : undefined,
      room: event.new_room ?? null,
      replaceEventId: event.id,
    };
  }
  return null;
}
