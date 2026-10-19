import { useEffect, useRef, useState } from 'react';
import {
  addDays,
  computeReminders,
  formatDate,
  loadReminderData,
  type ReminderOccurrence,
  type ReminderRow,
  type Storage,
} from '@dawn-tick/core';
import {
  currentNotifyPermission,
  ensureNotifyPermission,
  markNotifyAsked,
  notifyNow,
  scheduleNotify,
  type NotifyPermission,
} from './notify.ts';
import { logDebug } from './log.ts';

const SCAN_INTERVAL_MS = 30_000;
const LOOKAHEAD_DAYS = 7;
const SCHEDULE_AHEAD_MS = 60 * 60 * 1000;

export interface ReminderView {
  upcoming: ReminderOccurrence[];
  permission: NotifyPermission;
  request: () => Promise<void>;
}

/** 全局课前提醒默认值。 */
export interface ClassReminderDefaults {
  enabled: boolean;
  minutes: number;
}

function hashKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 2_000_000_000;
  }
  return hash;
}

/** 未单独设置提醒的课程按全局默认提醒；有任意一条提醒记录（即使已关闭）就不再套用默认。 */
function withGlobalDefaults(rows: readonly ReminderRow[], defaults: ClassReminderDefaults, courseIds: Set<string>): ReminderRow[] {
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

async function collect(
  storage: Storage,
  semesterId: string,
  timeZone: string,
  defaults: ClassReminderDefaults,
): Promise<ReminderOccurrence[]> {
  const today = formatDate(Date.now(), timeZone);
  const data = await loadReminderData(storage, semesterId, today, addDays(today, LOOKAHEAD_DAYS));
  if (data === undefined) return [];
  const courseIds = new Set(data.occurrences.map((item) => item.courseId));
  return computeReminders({
    occurrences: data.occurrences,
    reminders: withGlobalDefaults(data.reminders, defaults, courseIds),
    events: data.events,
    dayKinds: data.dayKinds,
    timeZone: data.timeZone,
    now: Date.now(),
    horizonMs: LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
  });
}

/** 提醒调度：Android 用原生排定，应用关闭后仍可送达；Web 与 Windows 由页面内循环触发。 */
export function useReminders(
  storage: Storage | null,
  semesterId: string | null,
  timeZone: string,
  defaults: ClassReminderDefaults,
): ReminderView {
  const [upcoming, setUpcoming] = useState<ReminderOccurrence[]>([]);
  const [permission, setPermission] = useState<NotifyPermission>(currentNotifyPermission);
  const handled = useRef(new Set<string>());
  const defaultKey = `${defaults.enabled ? 1 : 0}-${defaults.minutes}`;

  useEffect(() => {
    if (storage === null || semesterId === null) return;
    let cancelled = false;

    async function tick(current: Storage, id: string): Promise<void> {
      const items = await collect(current, id, timeZone, defaults);
      if (cancelled) return;
      setUpcoming(items);
      logDebug('reminder', '提醒扫描', {
        upcoming: items.length,
        enabled: defaults.enabled,
        minutes: defaults.minutes,
        next: items[0] === undefined ? null : { title: items[0].title, triggerAt: items[0].triggerAt },
      });

      const now = Date.now();
      for (const item of items) {
        const key = `${item.reminderId}-${item.startsAt}`;
        if (handled.current.has(key)) continue;
        if (item.triggerAt <= now) {
          handled.current.add(key);
          await notifyNow(item.title, item.detail);
          continue;
        }
        if (item.triggerAt - now < SCHEDULE_AHEAD_MS) {
          const scheduled = await scheduleNotify(hashKey(key), item.title, item.detail, item.triggerAt);
          if (scheduled) handled.current.add(key);
        }
      }
    }

    void tick(storage, semesterId);
    const timer = setInterval(() => {
      if (storage !== null && semesterId !== null) void tick(storage, semesterId);
    }, SCAN_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // defaultKey 覆盖 enabled 与 minutes，改设置后重新调度
  }, [storage, semesterId, timeZone, defaultKey]);

  return {
    upcoming,
    permission,
    request: async () => {
      const next = await ensureNotifyPermission();
      setPermission(next);
      if (storage !== null) await markNotifyAsked(storage);
    },
  };
}
