import { useEffect, useRef, useState } from 'react';
import type { ReminderOccurrence, Storage } from '@dawn-tick/core';
import {
  currentNotifyPermission,
  ensureNotifyPermission,
  markNotifyAsked,
  type NotifyPermission,
} from './notify.ts';
import { errorMessage } from './lib/errors.ts';
import { logWarn } from './log.ts';
import { toast } from './components/ui/toaster.tsx';
import { ReminderScheduler } from './reminder-scheduler.ts';
import type { ClassReminderDefaults } from './reminder-collect.ts';

export type { ClassReminderDefaults } from './reminder-collect.ts';

export interface ReminderView {
  upcoming: ReminderOccurrence[];
  permission: NotifyPermission;
  request: () => Promise<void>;
}

/**
 * 提醒调度入口：Android 用原生插件排定并带通知动作；Windows 用托盘菜单承载动作；
 * Web 仅页面内提醒。
 *
 * 边界：本文件只负责 React 生命周期与对外视图；扫描、投递、动作执行在
 * `reminder-scheduler.ts`，动作语义在 `lib/reminder-actions.ts`。
 */
export function useReminders(
  storage: Storage | null,
  semesterId: string | null,
  timeZone: string,
  defaults: ClassReminderDefaults,
): ReminderView {
  const [upcoming, setUpcoming] = useState<ReminderOccurrence[]>([]);
  const [permission, setPermission] = useState<NotifyPermission>(currentNotifyPermission);
  const schedulerRef = useRef<ReminderScheduler | null>(null);
  const defaultKey = `${defaults.enabled ? 1 : 0}-${defaults.minutes}`;

  useEffect(() => {
    if (storage === null || semesterId === null) return;
    const scheduler = new ReminderScheduler({
      storage,
      semesterId,
      timeZone,
      defaults,
      onUpcoming: setUpcoming,
      onPermission: setPermission,
    });
    schedulerRef.current = scheduler;
    void scheduler.start();
    return () => {
      scheduler.stop();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
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
      const scheduler = schedulerRef.current;
      if (scheduler === null) return;
      try {
        const native = await scheduler.refreshPermission();
        if (native === 'granted') setPermission('granted');
        else if (native === 'denied') {
          setPermission('denied');
          toast.error('通知权限未授予，提醒不会弹出');
        }
      } catch (cause: unknown) {
        logWarn('reminder', '读取提醒权限状态失败', { message: errorMessage(cause) });
      }
    },
  };
}
