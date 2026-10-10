import { useEffect, useRef, useState } from 'react';
import {
  addDays,
  computeReminders,
  formatDate,
  loadReminderData,
  type ReminderOccurrence,
  type Storage,
} from '@dawn-tick/core';
import {
  currentNotifyPermission,
  ensureNotifyPermission,
  notifyNow,
  scheduleNotify,
  type NotifyPermission,
} from './notify.ts';

const SCAN_INTERVAL_MS = 30_000;
const LOOKAHEAD_DAYS = 7;
const SCHEDULE_AHEAD_MS = 60 * 60 * 1000;

export interface ReminderView {
  upcoming: ReminderOccurrence[];
  permission: NotifyPermission;
  request: () => Promise<void>;
}

function hashKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 2_000_000_000;
  }
  return hash;
}

async function collect(storage: Storage, semesterId: string, timeZone: string): Promise<ReminderOccurrence[]> {
  const today = formatDate(Date.now(), timeZone);
  const data = await loadReminderData(storage, semesterId, today, addDays(today, LOOKAHEAD_DAYS));
  if (data === undefined) return [];
  return computeReminders({
    occurrences: data.occurrences,
    reminders: data.reminders,
    events: data.events,
    dayKinds: data.dayKinds,
    timeZone: data.timeZone,
    now: Date.now(),
    horizonMs: LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
  });
}

/**
 * 提醒调度：
 * - Android 用原生排定，应用关闭后仍可送达；
 * - Web 与 Windows 由页面内循环触发（页面关闭后 Web 端无法提醒，见 D71）。
 */
export function useReminders(
  storage: Storage | null,
  semesterId: string | null,
  timeZone: string,
): ReminderView {
  const [upcoming, setUpcoming] = useState<ReminderOccurrence[]>([]);
  const [permission, setPermission] = useState<NotifyPermission>(currentNotifyPermission);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (storage === null || semesterId === null) return;
    let cancelled = false;

    async function tick(current: Storage, id: string): Promise<void> {
      const items = await collect(current, id, timeZone);
      if (cancelled) return;
      setUpcoming(items);

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
  }, [storage, semesterId, timeZone]);

  return {
    upcoming,
    permission,
    request: async () => {
      setPermission(await ensureNotifyPermission());
    },
  };
}
