import { useEffect, useRef, useState } from 'react';
import {
  addDays,
  computeReminders,
  formatDate,
  loadReminderData,
  type ReminderOccurrence,
  type Storage,
} from '@dawn-tick/core';

const SCAN_INTERVAL_MS = 30_000;
const LOOKAHEAD_DAYS = 7;

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export interface ReminderView {
  upcoming: ReminderOccurrence[];
  permission: PermissionState;
  request: () => Promise<void>;
}

function currentPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as PermissionState;
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

/** 页面打开期间按时刻触发系统通知；页面关闭后 Web 端无法提醒（见 D71）。 */
export function useReminders(
  storage: Storage | null,
  semesterId: string | null,
  timeZone: string,
): ReminderView {
  const [upcoming, setUpcoming] = useState<ReminderOccurrence[]>([]);
  const [permission, setPermission] = useState<PermissionState>(currentPermission);
  const fired = useRef(new Set<string>());

  useEffect(() => {
    if (storage === null || semesterId === null) return;
    let cancelled = false;

    async function tick(): Promise<void> {
      const items = await collect(storage as Storage, semesterId as string, timeZone);
      if (cancelled) return;
      setUpcoming(items);
      const now = Date.now();
      for (const item of items) {
        const key = `${item.reminderId}-${item.startsAt}`;
        if (item.triggerAt > now || fired.current.has(key)) continue;
        fired.current.add(key);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(item.title, { body: item.detail, tag: key });
        }
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), SCAN_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [storage, semesterId, timeZone]);

  return {
    upcoming,
    permission,
    request: async () => {
      if (typeof Notification === 'undefined') {
        setPermission('unsupported');
        return;
      }
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
    },
  };
}
