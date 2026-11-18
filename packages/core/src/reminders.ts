import type { ExpandDayKind, Occurrence } from './expand.ts';
import { applyQuietHours, type QuietHours } from './quiet-hours.ts';
import { DEFAULT_TIME_ZONE, formatDate } from './time.ts';
import type { EventRow, ReminderRow, ReminderTargetType } from './types.ts';

export interface ReminderOccurrence {
  reminderId: string;
  targetType: ReminderTargetType;
  targetId: string;
  source: 'schedule' | 'course' | 'event';
  title: string;
  detail: string;
  startsAt: number;
  triggerAt: number;
  advanceMinutes: number;
  sound: number;
  vibrate: number;
  dnd: number;
  snoozeMinutes: number | null;
}

export interface ReminderInput {
  occurrences: readonly Occurrence[];
  reminders: readonly ReminderRow[];
  events: readonly EventRow[];
  dayKinds?: readonly ExpandDayKind[];
  now: number;
  /**
   * 下界（不含）：只保留 `triggerAt > since` 的提醒，用于补上两次扫描之间到点的提醒。
   * 缺省时只保留 `triggerAt >= now`。
   */
  since?: number;
  horizonMs?: number;
  timeZone?: string;
  /** 勿扰时段：落在时段里的提醒顺延或跳过，`triggerAt` 是判定后的时刻 */
  quietHours?: QuietHours;
}

const DEFAULT_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** 可设置提醒的条目类型：表单为这些类型提供「提前提醒」。 */
const REMINDABLE_EVENT_TYPES: ReadonlySet<EventRow['type']> = new Set(['exam', 'temp', 'todo', 'homework', 'lab']);
const EVENT_DETAIL: Partial<Record<EventRow['type'], string>> = {
  exam: '考试',
  temp: '日程',
  todo: '待办',
  homework: '作业',
  lab: '实验',
};

function active(reminder: ReminderRow): boolean {
  return reminder.enabled === 1 && reminder.deleted_at === null;
}

function findRule(
  reminders: readonly ReminderRow[],
  targetType: ReminderTargetType,
  targetId: string,
): ReminderRow | undefined {
  return reminders.find((row) => active(row) && row.target_type === targetType && row.target_id === targetId);
}

function holidayDates(dayKinds: readonly ExpandDayKind[]): Set<string> {
  const out = new Set<string>();
  for (const kind of dayKinds) {
    if (kind.type === 'holiday') out.add(kind.on_date);
  }
  return out;
}

function toOccurrence(
  reminder: ReminderRow,
  source: ReminderOccurrence['source'],
  targetId: string,
  title: string,
  detail: string,
  startsAt: number,
): ReminderOccurrence {
  return {
    reminderId: reminder.id,
    targetType: reminder.target_type,
    targetId,
    source,
    title,
    detail,
    startsAt,
    triggerAt: startsAt - reminder.advance_minutes * 60_000,
    advanceMinutes: reminder.advance_minutes,
    sound: reminder.sound,
    vibrate: reminder.vibrate,
    dnd: reminder.dnd,
    snoozeMinutes: reminder.snooze_minutes,
  };
}

/** 计算窗口内需要触发的提醒。课表课次优先用排课级提醒，其次课程级；日程用事件级。 */
export function computeReminders(input: ReminderInput): ReminderOccurrence[] {
  const horizon = input.now + (input.horizonMs ?? DEFAULT_HORIZON_MS);
  const inWindow = (triggerAt: number): boolean =>
    (input.since === undefined ? triggerAt >= input.now : triggerAt > input.since) && triggerAt <= horizon;
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const out: ReminderOccurrence[] = [];
  /** 先过勿扰再看窗口：顺延后才到点的提醒也要排上 */
  const place = (item: ReminderOccurrence): void => {
    const triggerAt =
      input.quietHours === undefined
        ? item.triggerAt
        : applyQuietHours(item.triggerAt, item.startsAt, input.quietHours, timeZone);
    if (triggerAt !== null && inWindow(triggerAt)) out.push({ ...item, triggerAt });
  };

  for (const occurrence of input.occurrences) {
    if (occurrence.cancelled) continue;
    const rule =
      findRule(input.reminders, 'schedule', occurrence.scheduleId) ??
      findRule(input.reminders, 'course', occurrence.courseId);
    if (rule === undefined) continue;
    const source: ReminderOccurrence['source'] = rule.target_type === 'schedule' ? 'schedule' : 'course';
    const item = toOccurrence(
      rule,
      source,
      occurrence.courseId,
      occurrence.courseName,
      [occurrence.room, `第 ${occurrence.periodStart} 节`].filter((part) => part !== null && part.length > 0).join(' · '),
      occurrence.startAt,
    );
    place(item);
  }

  const holidays = holidayDates(input.dayKinds ?? []);
  for (const event of input.events) {
    if (event.deleted_at !== null) continue;
    if (!REMINDABLE_EVENT_TYPES.has(event.type)) continue;
    // 作业/待办常常只有截止时刻：没有开始时刻时以截止时刻为准
    const anchor = event.start_at ?? event.due_at;
    if (anchor === null) continue;
    const rule = findRule(input.reminders, 'event', event.id);
    if (rule === undefined) continue;
    const date = event.on_date ?? formatDate(anchor, timeZone);
    if (rule.skip_holidays === 1 && holidays.has(date)) continue;
    const item = toOccurrence(
      rule,
      'event',
      event.id,
      event.title,
      event.location ?? EVENT_DETAIL[event.type] ?? '日程',
      anchor,
    );
    place(item);
  }

  return out.sort((left, right) =>
    left.triggerAt === right.triggerAt ? left.title.localeCompare(right.title) : left.triggerAt - right.triggerAt,
  );
}

export function nextReminder(
  items: readonly ReminderOccurrence[],
  now: number,
): ReminderOccurrence | undefined {
  return items.find((item) => item.triggerAt >= now);
}

/** 贪睡后的再次触发时刻；未设置贪睡返回 null。 */
export function snoozeUntil(item: ReminderOccurrence, now: number): number | null {
  if (item.snoozeMinutes === null) return null;
  return now + item.snoozeMinutes * 60_000;
}
