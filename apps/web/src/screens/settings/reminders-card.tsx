import { useEffect, useState } from 'react';
import { formatDateTime, type AppSettings } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from '../../lib/capabilities.ts';
import { ACTION_LABEL } from '../../lib/reminder-actions.ts';
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from '../../system-actions.ts';
import { exactAlarmState, requestExactAlarm, type ExactAlarmState } from '../../permissions.ts';
import type { ReminderView } from '../../useReminders.ts';
import { COUNT } from '../../copy/zh.ts';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import type { NotifyPermissionApi } from './use-notify-permission.ts';

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
              aria-label={notify.view.action === 'request' ? '申请通知权限' : '去系统设置'}
              onClick={() => void notify.act(notify.view.action as 'request' | 'settings')}
            >
              {notify.view.action === 'request' ? '申请通知权限' : '去系统设置'}
            </Button>
          )
        }
      >
        <span className={`mr-1 inline-block size-2 rounded-full ${notifyDotClass}`} data-role="notify-status-dot" aria-hidden />
        通知权限：{notify.view.label}
      </StatusLine>
      <span className="text-xs text-muted">关闭后不再提醒</span>
      {androidApp && (
        <>
          <StatusLine
            dataRole="exact-alarm-status"
            action={
              alarmState === 'denied' && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="开启精确闹钟"
                  onClick={() =>
                    void (async () => {
                      await requestExactAlarm();
                      const nextState = await exactAlarmState();
                      setAlarmState(nextState);
                      if (nextState === 'granted') toast.success('已开启精确闹钟');
                      else toast.info('精确闹钟仍未开启，请到系统设置里允许');
                    })()
                  }
                >
                  去开启
                </Button>
              )
            }
          >
            精确闹钟：{alarmState === 'granted' ? '已开启' : alarmState === 'denied' ? '未开启' : '不适用'}
          </StatusLine>
          <StatusLine
            dataRole="battery-optimization-status"
            action={
              batteryFree === false && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="申请加入电池优化白名单"
                  onClick={() =>
                    void (async () => {
                      await requestIgnoreBatteryOptimizations();
                      const nextState = await isIgnoringBatteryOptimizations();
                      setBatteryFree(nextState);
                      if (nextState === true) toast.success('已加入电池优化白名单');
                      else toast.info('仍未加入白名单，提醒可能延后');
                    })()
                  }
                >
                  去设置
                </Button>
              )
            }
          >
            后台运行：{batteryFree === null ? '读取中…' : batteryFree ? '已加入电池优化白名单' : '受电池优化限制，提醒可能延后'}
          </StatusLine>
        </>
      )}
      <SwitchField
        label="课前提醒"
        description="所有课程默认提醒，可在课程详情里单独设置"
        checked={settings.classReminderEnabled}
        onCheckedChange={(checked) => void onPatch({ classReminderEnabled: checked })}
        ariaLabel="课前提醒"
      />
      <Field label="默认提前">
        <div className="flex flex-wrap items-center gap-2">
          {[5, 10, 15, 20, 30].map((minutes) => (
            <Button
              key={minutes}
              size="sm"
              variant={settings.classReminderMinutes === minutes ? 'primary' : 'secondary'}
              aria-label={`提前 ${COUNT('minute', minutes)}`}
              disabled={!settings.classReminderEnabled}
              onClick={() => void onPatch({ classReminderMinutes: minutes })}
            >
              {COUNT('minute', minutes)}
            </Button>
          ))}
          <Input
            type="number"
            min={1}
            max={180}
            className="w-24"
            aria-label="自定义提前分钟"
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
      <span className="text-xs text-muted">
        接下来 7 天待提醒 {COUNT('reminder', reminders.upcoming.length)}
        {next !== undefined && ` · 最近 ${formatDateTime(next.triggerAt, settings.timeZone)} ${next.title}`}
      </span>
      {(androidApp || isDesktopApp()) && (
        <span className="text-xs text-muted" data-role="reminder-actions">
          {androidApp ? '通知动作' : '托盘提醒动作'}：{ACTION_LABEL.snooze} · {ACTION_LABEL.mute}
          ；待办/作业/考试/实验另有「{ACTION_LABEL.done}」；课前提醒没有「{ACTION_LABEL.done}」
        </span>
      )}
    </>
  );
}
