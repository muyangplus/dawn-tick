import { useEffect, useState } from 'react';
import { formatDateTime, type AppSettings } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from '../../lib/capabilities.ts';
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from '../../system-actions.ts';
import { exactAlarmState, requestExactAlarm, type ExactAlarmState } from '../../permissions.ts';
import type { ReminderView } from '../../useReminders.ts';
import { remindersCopy } from '../../copy/settings-reminders.ts';
import { HelpLink } from '../../components/help-link.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import type { NotifyPermissionApi } from './use-notify-permission.ts';
import { QuietHoursField } from './quiet-hours-field.tsx';

export interface RemindersCardProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  reminders: ReminderView;
  /** 通知权限状态由页面持有，顶部提示条与本卡角标看同一份 */
  notify: NotifyPermissionApi;
}

/**
 * 提醒卡：通知权限、精确闹钟与电池优化、课前提醒默认值、未来 7 天待提醒。
 *
 * 权限状态由 `useNotifyPermission` 提供；安卓两个系统权限的状态由卡自己读、
 * 自己申请，结果只影响本卡。
 */
export function RemindersCard({ settings, onPatch, reminders, notify }: RemindersCardProps) {
  const androidApp = isAndroidApp();
  /** 安卓权限状态：精确闹钟与电池优化白名单（通知状态全平台都读） */
  const [alarmState, setAlarmState] = useState<ExactAlarmState>('unsupported');
  const [batteryFree, setBatteryFree] = useState<boolean | null>(null);

  useEffect(() => {
    if (!androidApp) return;
    let cancelled = false;
    void (async () => {
      const [alarm, ignoring] = await Promise.all([exactAlarmState(), isIgnoringBatteryOptimizations()]);
      if (!cancelled) {
        setAlarmState(alarm);
        setBatteryFree(ignoring);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [androidApp]);

  /** 权限状态点：已允许绿色、异常红色、其余灰色 */
  const notifyDotClass =
    notify.view.state === 'granted' ? 'bg-success-strong' : notify.abnormal ? 'bg-danger-strong' : 'bg-line';
  const next = reminders.upcoming[0];

  return (
    <>
      <StatusLine
        dataRole="notify-permission"
        action={
          notify.view.action !== null && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={notify.view.action === 'request' ? remindersCopy.requestNotify : remindersCopy.openSystemSettings}
              onClick={() => void notify.act(notify.view.action as 'request' | 'settings')}
            >
              {notify.view.action === 'request' ? remindersCopy.requestNotify : remindersCopy.openSystemSettings}
            </Button>
          )
        }
      >
        <span className={`mr-1 inline-block size-2 rounded-full ${notifyDotClass}`} data-role="notify-status-dot" aria-hidden />
        {remindersCopy.notifyStatus(notify.view.label)}
      </StatusLine>
      <span className="text-xs text-muted">{remindersCopy.notifyOffHint}</span>
      {androidApp && (
        <>
          <StatusLine
            dataRole="exact-alarm-status"
            action={
              alarmState === 'denied' && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={remindersCopy.exactAlarmAria}
                  onClick={() =>
                    void (async () => {
                      await requestExactAlarm();
                      const nextState = await exactAlarmState();
                      setAlarmState(nextState);
                      if (nextState === 'granted') toast.success(remindersCopy.exactAlarmGranted);
                      else toast.info(remindersCopy.exactAlarmStillDenied);
                    })()
                  }
                >
                  {remindersCopy.exactAlarmButton}
                </Button>
              )
            }
          >
            {remindersCopy.exactAlarmLine(
              alarmState === 'granted'
                ? remindersCopy.exactAlarmStatus.granted
                : alarmState === 'denied'
                  ? remindersCopy.exactAlarmStatus.denied
                  : remindersCopy.exactAlarmStatus.unsupported,
            )}
          </StatusLine>
          <StatusLine
            dataRole="battery-optimization-status"
            action={
              batteryFree === false && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={remindersCopy.batteryAria}
                  onClick={() =>
                    void (async () => {
                      await requestIgnoreBatteryOptimizations();
                      const nextState = await isIgnoringBatteryOptimizations();
                      setBatteryFree(nextState);
                      if (nextState === true) toast.success(remindersCopy.batteryGranted);
                      else toast.info(remindersCopy.batteryStillLimited);
                    })()
                  }
                >
                  {remindersCopy.batteryButton}
                </Button>
              )
            }
          >
            {remindersCopy.batteryLine(
              batteryFree === null
                ? remindersCopy.batteryStatus.loading
                : batteryFree
                  ? remindersCopy.batteryStatus.free
                  : remindersCopy.batteryStatus.limited,
            )}
          </StatusLine>
        </>
      )}
      <SwitchField
        label={remindersCopy.classReminderLabel}
        description={remindersCopy.classReminderDescription}
        checked={settings.classReminderEnabled}
        onCheckedChange={(checked) => void onPatch({ classReminderEnabled: checked })}
        ariaLabel={remindersCopy.classReminderLabel}
      />
      <Field label={remindersCopy.leadLabel}>
        <div className="flex flex-wrap items-center gap-2">
          {[5, 10, 15, 20, 30].map((minutes) => (
            <Button
              key={minutes}
              size="sm"
              variant={settings.classReminderMinutes === minutes ? 'primary' : 'secondary'}
              aria-label={remindersCopy.leadAria(minutes)}
              disabled={!settings.classReminderEnabled}
              onClick={() => void onPatch({ classReminderMinutes: minutes })}
            >
              {remindersCopy.leadOption(minutes)}
            </Button>
          ))}
          <Input
            type="number"
            min={1}
            max={180}
            className="w-24"
            aria-label={remindersCopy.leadCustomAria}
            disabled={!settings.classReminderEnabled}
            value={String(settings.classReminderMinutes)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 1 && value <= 180) {
                void onPatch({ classReminderMinutes: Math.round(value) });
              }
            }}
          />
        </div>
      </Field>
      <QuietHoursField value={settings.quietHours} onChange={(quietHours) => onPatch({ quietHours })} />
      <span className="text-xs text-muted">
        {remindersCopy.upcoming(
          reminders.upcoming.length,
          next === undefined
            ? undefined
            : { time: formatDateTime(next.triggerAt, settings.timeZone), title: next.title },
        )}
      </span>
      {(androidApp || isDesktopApp()) && (
        <HelpLink entryId="notify-actions" />
      )}
    </>
  );
}
