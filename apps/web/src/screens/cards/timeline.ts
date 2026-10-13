import { formatDate, formatTime, type EventRow } from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import type { AdjustTarget } from '../../components/adjust-dialog.tsx';
import { formatDayCountdown } from '../../lib/format.ts';

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 条目性质标签，映射规则（都以现有数据字段为准）：
 * - `data.lessonsByDate` 里的课次（来自 schedule）→ 课程
 * - `data.reschedules` 里的调课 / 调休 / 停课 → 调整
 * - `data.todos` 里 `type === 'exam'` 的考试（没有开考时间，进不了考试倒计时卡）→ 考试
 * - `data.todos` 里 `type === 'todo' | 'temp'` 的待办 → 其他
 */
export type TimelineNature = '课程' | '调整' | '其他' | '考试';

export interface TimelineItem {
  key: string;
  /** 所属日期；null 表示未排期 */
  date: string | null;
  /** 当天排序用的分钟数 */
  minute: number;
  /** 同一天内的先后：课程 → 调课/调休 → 待办 */
  rank: number;
  /** 渲染用的粗分类；考试单独一种，便于用 data-kind 定位 */
  kind: 'lesson' | 'adjust' | 'todo' | 'exam';
  /** 类型标签文案（课程 / 调整 / 其他 / 考试） */
  nature: TimelineNature;
  title: string;
  /** 次要说明（关联课程、倒计时、备注）；课程条目为空，不再显示节次 */
  detail: string;
  /** 地点：课程取教室，事件取 location；null 表示不渲染地点行 */
  location: string | null;
  /** 左侧竖排时间列上半：开始时间；null 表示该条目没有开始时间 */
  startText: string | null;
  /** 左侧竖排时间列下半：结束时间（课程）或截止时间（待办/考试） */
  endText: string | null;
  /** 结束/截止时间戳；null 表示没有时间，永不自动完成 */
  endEpoch: number | null;
  /** 手动勾选（只有带事件行的待办/考试会有） */
  done: boolean;
  /** 到点自动完成：有结束/截止时间且已经过去；纯展示层判定，不写数据库 */
  autoDone: boolean;
  /** 正在进行：课程已经开始、还没结束；纯展示层判定 */
  running: boolean;
  /** 已完成 = 手动勾选 或 到点自动完成 */
  completed: boolean;
  /** 是否还允许手动勾选：自动完成的条目不再提供勾选框，避免与自动判定互相打架 */
  checkable: boolean;
  /** 该课程/条目的颜色；null 表示用主题主色 */
  color: string | null;
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

/**
 * 自动完成的阈值：有结束/截止时间、且这个时间已经过去（含正好等于当前时刻）。
 * 没有时间的条目永远不会自动完成；这里只做展示层判定，不回写数据库。
 */
function isOverdue(endEpoch: number | null, now: number): boolean {
  return endEpoch !== null && endEpoch <= now;
}

/** 把某一天的课程、调课与待办合成一条时间线 */
export function buildTimeline(data: AppData, date: string, now: number = Date.now()): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const lesson of data.lessonsByDate.get(date) ?? []) {
    const endEpoch = lesson.endAt;
    const autoDone = isOverdue(endEpoch, now);
    const running = lesson.startAt <= now && lesson.endAt > now;
    items.push({
      key: `lesson-${lesson.scheduleId}-${lesson.startAt}`,
      date: lesson.date,
      minute: minuteOf(lesson.startAt, data.timeZone),
      rank: 0,
      kind: 'lesson',
      nature: '课程',
      title: lesson.courseName,
      // 课程条目不再显示「第 X 节」：左侧时间列已经给出开始–结束时间
      detail: '',
      location: lesson.room,
      startText: formatTime(lesson.startAt, data.timeZone),
      endText: formatTime(lesson.endAt, data.timeZone),
      endEpoch,
      done: false,
      autoDone,
      running,
      completed: autoDone,
      checkable: false,
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
    // 停课只说明这节课不上了，不是待办：默认已完成，直接进「已完成」分组，不计入未完成安排
    const cancelled = item.action === 'cancel';
    const detail =
      item.type === 'makeup'
        ? '调休'
        : cancelled
          ? '停课'
          : item.new_date !== null
            ? `改至 ${item.new_date} 第 ${item.new_period_start ?? ''}-${item.new_period_end ?? ''} 节`
            : '调课';
    const startAt = item.start_at ?? null;
    const endEpoch = item.end_at ?? null;
    const done = item.done === 1 || cancelled;
    const autoDone = isOverdue(endEpoch, now);
    items.push({
      key: `adjust-${item.id}`,
      date: itemDate,
      minute: minuteOf(startAt, data.timeZone),
      rank: 1,
      kind: 'adjust',
      nature: '调整',
      title: item.title,
      detail,
      location: item.location ?? item.new_room ?? null,
      startText: startAt === null ? null : formatTime(startAt, data.timeZone),
      endText: endEpoch === null ? null : formatTime(endEpoch, data.timeZone),
      endEpoch,
      done,
      autoDone,
      running: false,
      completed: done || autoDone,
      checkable: false,
      color: null,
      event: item,
    });
  }

  for (const todo of data.todos) {
    const endEpoch = todo.due_at ?? todo.end_at ?? null;
    const todoDate = todo.on_date ?? (endEpoch === null ? null : formatDate(endEpoch, data.timeZone));
    // 选中日期的日程：当天条目 + 未排期条目
    if (todoDate !== null && todoDate !== date) continue;
    const linkedCourse = data.courses.find((course) => course.id === todo.subject);
    const isExam = todo.type === 'exam';
    const done = todo.done === 1;
    const autoDone = isOverdue(endEpoch, now);
    const parts: string[] = [];
    if (linkedCourse !== undefined) parts.push(linkedCourse.name);
    if (endEpoch !== null && endEpoch > now) {
      parts.push(formatDayCountdown(endEpoch, now));
    }
    if (todo.note !== null && todo.note.length > 0) parts.push(todo.note);
    items.push({
      key: `todo-${todo.id}`,
      date: todoDate,
      minute: minuteOf(endEpoch, data.timeZone),
      rank: 2,
      kind: isExam ? 'exam' : 'todo',
      nature: isExam ? '考试' : '其他',
      title: todo.title,
      detail: parts.join(' · '),
      location: todo.location,
      startText: null,
      endText: endEpoch === null ? null : formatTime(endEpoch, data.timeZone),
      endEpoch,
      done,
      autoDone,
      running: false,
      completed: done || autoDone,
      checkable: !autoDone,
      color: linkedCourse?.color ?? null,
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

export interface TimelineSections {
  /** 未完成的条目，按原顺序留在主时间线 */
  main: TimelineItem[];
  /** 已完成的条目（手动勾选 或 到点自动完成），单独成组并置顶 */
  completed: TimelineItem[];
}

/**
 * 已完成（手动勾选 或 到点自动完成）的条目从主时间线移出，单独成组。
 * 全部条目都已完成时 main 为空，调用方据此自动展开已完成分组。
 */
export function splitTimeline(items: readonly TimelineItem[]): TimelineSections {
  const main: TimelineItem[] = [];
  const completed: TimelineItem[] = [];
  for (const item of items) {
    if (item.completed) completed.push(item);
    else main.push(item);
  }
  return { main, completed };
}
