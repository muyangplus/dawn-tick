import { formatDate, formatTime, type EventRow } from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import type { AdjustTarget } from '../../components/adjust-dialog.tsx';
import { formatDayCountdown } from '../../lib/format.ts';

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export interface TimelineItem {
  key: string;
  /** 所属日期；null 表示未排期 */
  date: string | null;
  /** 当天排序用的分钟数 */
  minute: number;
  /** 同一天内的先后：课程 → 调课/调休 → 待办 */
  rank: number;
  kind: 'lesson' | 'adjust' | 'todo';
  title: string;
  detail: string;
  /** 课程的上课时间区间（开始–结束），如 08:00–08:45 */
  timeRange?: string;
  color?: string;
  done?: boolean;
  event?: EventRow;
  lessonTarget?: AdjustTarget;
}

export function dateLabel(date: string | null, timeZone: string): string {
  if (date === null) return '未排期';
  const [year, month, day] = date.split('-').map(Number);
  const weekday =
    WEEKDAYS[(new Date(Date.UTC(year as number, (month as number) - 1, day as number)).getUTCDay() + 6) % 7];
  void timeZone;
  return `${month} 月 ${day} 日 ${weekday}`;
}

function minuteOf(epoch: number | null, timeZone: string): number {
  if (epoch === null) return 0;
  const [hour, minute] = formatTime(epoch, timeZone).split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** 把某一天的课程、调课与待办合成一条时间线 */
export function buildTimeline(data: AppData, date: string): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const lesson of data.lessonsByDate.get(date) ?? []) {
    items.push({
      key: `lesson-${lesson.scheduleId}-${lesson.startAt}`,
      date: lesson.date,
      minute: minuteOf(lesson.startAt, data.timeZone),
      rank: 0,
      kind: 'lesson',
      title: lesson.courseName,
      detail: `第 ${lesson.periodStart}${lesson.periodEnd > lesson.periodStart ? `-${lesson.periodEnd}` : ''} 节${
        lesson.room === null ? '' : ` · ${lesson.room}`
      }`,
      timeRange: `${formatTime(lesson.startAt, data.timeZone)}–${formatTime(lesson.endAt, data.timeZone)}`,
      color: lesson.color,
      lessonTarget: {
        scheduleId: lesson.scheduleId,
        courseId: lesson.courseId,
        courseName: lesson.courseName,
        date: lesson.date,
        periodStart: lesson.periodStart,
        periodEnd: lesson.periodEnd,
      },
    });
  }

  for (const item of data.reschedules) {
    const itemDate = item.on_date ?? null;
    if (itemDate !== null && itemDate !== date) continue;
    const detail =
      item.type === 'makeup'
        ? '调休'
        : item.action === 'cancel'
          ? '停课'
          : item.new_date !== null
            ? `改至 ${item.new_date} 第 ${item.new_period_start ?? ''}-${item.new_period_end ?? ''} 节`
            : '调课';
    items.push({
      key: `adjust-${item.id}`,
      date: itemDate,
      minute: 0,
      rank: 1,
      kind: 'adjust',
      title: item.title,
      detail,
      event: item,
    });
  }

  for (const todo of data.todos) {
    const todoDate =
      todo.on_date ?? (todo.due_at === null || todo.due_at === undefined ? null : formatDate(todo.due_at, data.timeZone));
    // 选中日期的日程：当天条目 + 未排期条目
    if (todoDate !== null && todoDate !== date) continue;
    const linkedCourse = data.courses.find((course) => course.id === todo.subject);
    const parts: string[] = [];
    if (linkedCourse !== undefined) parts.push(linkedCourse.name);
    if (todo.due_at !== null && todo.due_at !== undefined && todo.due_at > Date.now()) {
      parts.push(formatDayCountdown(todo.due_at, Date.now()));
    }
    if (todo.note !== null && todo.note.length > 0) parts.push(todo.note);
    items.push({
      key: `todo-${todo.id}`,
      date: todoDate,
      minute: minuteOf(todo.due_at ?? null, data.timeZone),
      rank: 2,
      kind: 'todo',
      title: todo.title,
      detail: parts.join(' · '),
      done: todo.done === 1,
      event: todo,
    });
  }

  return items.sort((left, right) => {
    const leftDate = left.date ?? '9999-99-99';
    const rightDate = right.date ?? '9999-99-99';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (left.rank !== right.rank) return left.rank - right.rank;
    return left.minute - right.minute;
  });
}

/** 按日期把时间线切成若干组 */
export function groupTimeline(items: readonly TimelineItem[]): Array<{ date: string | null; items: TimelineItem[] }> {
  const groups: Array<{ date: string | null; items: TimelineItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }
  return groups;
}
