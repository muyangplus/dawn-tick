import { detectPlatform } from './platform-detect.ts';
import { currentNotifyPermission, ensureNotifyPermission, readNotifyAsked, type NotifyPermission } from './notify.ts';
import { readNativeNotifyStatus } from './system-actions.ts';
import { logInfo, logWarn } from './log.ts';
import type { Storage } from '@dawn-tick/core';

export type ExactAlarmState = 'granted' | 'denied' | 'unsupported';

export interface PermissionReport {
  platform: 'capacitor' | 'tauri' | 'web';
  notifications: NotifyPermission | 'skipped';
  exactAlarm: ExactAlarmState;
}

/** 运行时通知权限：没问过、被拒绝（还能再弹）、被永久拒绝（只能去系统设置）。 */
export type NotifyRuntimeState = 'granted' | 'denied' | 'prompt' | 'permanently-denied' | 'unsupported';

export interface NotifyStatus {
  /** 系统设置里应用级通知开关：关掉就是静音，任何通知都发不出 */
  appEnabled: boolean;
  runtime: NotifyRuntimeState;
  /** 通知渠道被静音（Android 8+），与运行时权限是两回事 */
  channelMuted: boolean;
  /** 被静音的渠道名，界面提示用 */
  channelName: string | null;
  channelId: string | null;
  /** 是否已经向系统申请过通知权限 */
  asked: boolean;
}

/** 通知状态：安卓走原生查询；其它平台按浏览器权限近似。 */
export async function readNotifyStatus(storage: Storage | null): Promise<NotifyStatus> {
  const asked = storage === null ? false : await readNotifyAsked(storage);
  const native = await readNativeNotifyStatus(asked);
  if (native !== null) {
    return {
      appEnabled: native.appEnabled,
      runtime: native.runtime,
      channelMuted: native.channelMuted,
      channelName: native.channelName,
      channelId: native.channelId,
      asked,
    };
  }
  const permission = currentNotifyPermission();
  const runtime: NotifyRuntimeState =
    permission === 'granted'
      ? 'granted'
      : permission === 'denied'
        ? 'denied'
        : permission === 'unsupported'
          ? 'unsupported'
          : 'prompt';
  return {
    appEnabled: permission === 'granted' || permission === 'default',
    runtime,
    channelMuted: false,
    channelName: null,
    channelId: null,
    asked,
  };
}

/** 精确闹钟状态：Android 12+ 才有独立开关，其余平台按支持处理。 */
export async function exactAlarmState(): Promise<ExactAlarmState> {
  if (detectPlatform() !== 'capacitor') return 'unsupported';
  try {
    const local = await import('@capacitor/local-notifications');
    const status = await local.LocalNotifications.checkExactNotificationSetting();
    return status.exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch (cause: unknown) {
    logWarn('permission', '读取精确闹钟设置失败', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return 'unsupported';
  }
}

/** 跳系统页申请精确闹钟权限（Android 12+）；返回是否已发起跳转。 */
export async function requestExactAlarm(): Promise<boolean> {
  if (detectPlatform() !== 'capacitor') return false;
  try {
    const local = await import('@capacitor/local-notifications');
    await local.LocalNotifications.changeExactNotificationSetting();
    logInfo('permission', '已跳转精确闹钟设置页');
    return true;
  } catch (cause: unknown) {
    logWarn('permission', '跳转精确闹钟设置页失败', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

/** 启动时索取通知权限（Android 13+）；精确闹钟未开且开启课前提醒时跳系统页，否则提醒被降为大致时间。 */
export async function ensureStartupPermissions(options: { remindersEnabled: boolean }): Promise<PermissionReport> {
  const platform = detectPlatform();
  if (platform !== 'capacitor') {
    return { platform, notifications: 'skipped', exactAlarm: 'unsupported' };
  }

  const notifications = await ensureNotifyPermission();
  logInfo('permission', '启动权限检查', { notifications });

  let alarm = await exactAlarmState();
  if (alarm === 'denied' && options.remindersEnabled) {
    await requestExactAlarm();
    alarm = await exactAlarmState();
  }
  if (notifications === 'denied') {
    logWarn('permission', '通知权限未授予：课前提醒不会弹系统通知');
  }
  return { platform, notifications, exactAlarm: alarm };
}
