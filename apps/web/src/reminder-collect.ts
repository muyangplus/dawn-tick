import {
  addDays,
  computeReminders,
  formatDate,
  loadReminderData,
  type ReminderOccurrence,
  type ReminderRow,
  type Storage,
} from '@dawn-tick/core';
import { reminderKindOf, type ReminderKind } from './lib/reminder-actions.ts';

/** 全局课前提醒默认值。 */
export interface ClassReminderDefaults {
  enabled: boolean;
  minutes: number;
}

/** 一次可投递的提醒：通知 id 稳定，动作触发后靠 key 找回条目。 */
export interface DeliveryItem {
  key: string;
  notificationId: number;
  kind: ReminderKind;
  targetId: string;
  title: string;
  detail: string;
  triggerAt: number;
  startsAt: number;
  occurrence: ReminderOccurrence;
}

/** 贪睡队列（非 Android 平台由页面循环再次投递）。 */
export interface SnoozedDelivery {
  key: string;
  notificationId: number;
  kind: ReminderKind;
  targetId: string;
  title: string;
  detail: string;
  triggerAt: number;
}

const LOOKAHEAD_DAYS = 7;

export function hashKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 2_000_000_000;
  }
  return hash;
}

/** 未单独设置提醒的课程按全局默认提醒；有任意一条提醒记录（即使已关闭）就不再套用默认。 */
function withGlobalDefaults(
  rows: readonly ReminderRow[],
  defaults: ClassReminderDefaults,
  courseIds: Set<string>,
): ReminderRow[] {
  if (!defaults.enabled) return [...rows];
  const decided = new Set(rows.map((row) => row.target_id));
  const now = Date.now();
  const synthetic: ReminderRow[] = [];
  for (const courseId of courseIds) {
    if (decided.has(courseId)) continue;
    synthetic.push({
      id: `global-${courseId}`,
      user_id: 'u1',
      target_type: 'course',
      target_id: courseId,
      advance_minutes: defaults.minutes,
      enabled: 1,
      skip_holidays: 1,
      sound: 1,
      vibrate: 1,
      dnd: 0,
      snooze_minutes: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      rev: 0,
      dirty: 0,
    });
  }
  return [...rows, ...synthetic];
}

function deliveryOf(occurrence: ReminderOccurrence, eventTypes: Map<string, string>): DeliveryItem {
  const key = `${occurrence.reminderId}-${occurrence.startsAt}`;
  return {
    key,
    notificationId: hashKey(key),
    kind: reminderKindOf(occurrence.source, eventTypes.get(occurrence.targetId) ?? null),
    targetId: occurrence.targetId,
    title: occurrence.title,
    detail: occurrence.detail,
    triggerAt: occurrence.triggerAt,
    startsAt: occurrence.startsAt,
    occurrence,
  };
}

/** 扫描未来 7 天要投递的提醒；已完成条目（events.done = 1）直接过滤掉。 */
export async function collect(
  storage: Storage,
  semesterId: string,
  timeZone: string,
  defaults: ClassReminderDefaults,
): Promise<DeliveryItem[]> {
  const today = formatDate(Date.now(), timeZone);
  const data = await loadReminderData(storage, semesterId, today, addDays(today, LOOKAHEAD_DAYS));
  if (data === undefined) return [];
  const courseIds = new Set(data.occurrences.map((item) => item.courseId));
  const events = new Map(data.events.map((event) => [event.id, event]));
  const eventTypes = new Map(data.events.map((event) => [event.id, event.type]));
  return computeReminders({
    occurrences: data.occurrences,
    reminders: withGlobalDefaults(data.reminders, defaults, courseIds),
    events: data.events,
    dayKinds: data.dayKinds,
    timeZone: data.timeZone,
    now: Date.now(),
    horizonMs: LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
  })
    .filter((item) => {
      // 已完成条目当天（以及之后）都不再提醒；写回 events.done 后重启仍生效
      if (item.source !== 'event') return true;
      return events.get(item.targetId)?.done !== 1;
    })
    .map((item) => deliveryOf(item, eventTypes));
}
