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
  /** 状态来源：Android 原生六态；桌面插件与浏览器只能报运行时三态 */
  source: 'android' | 'tauri' | 'web';
  /** 系统设置里应用级通知开关：只有 Android 原生能报；其它平台只作近似值，界面按 source 忽略 */
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

function statusBase(asked: boolean): Omit<NotifyStatus, 'source' | 'runtime'> {
  return {
    appEnabled: true,
    channelMuted: false,
    channelName: null,
    channelId: null,
    asked,
  };
}

/**
 * 桌面端（Windows / Tauri）只查插件能报的运行时状态：
 * `isPermissionGranted` 是布尔值，没有渠道 / 应用级开关；没问过时按「未申请」。
 */
async function readTauriNotifyStatus(asked: boolean): Promise<NotifyStatus> {
  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    const granted = await plugin.isPermissionGranted();
    return {
      ...statusBase(asked),
      source: 'tauri',
      runtime: granted ? 'granted' : asked ? 'denied' : 'prompt',
    };
  } catch (cause: unknown) {
    logWarn('permission', '桌面通知状态不可读', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
    // 取不到就明确报「不支持查询」，不假装成未申请
    return { ...statusBase(asked), source: 'tauri', runtime: 'unsupported' };
  }
}

/** 通知状态：Android 走原生精确查询，桌面走通知插件，浏览器按 Notification.permission。 */
export async function readNotifyStatus(storage: Storage | null): Promise<NotifyStatus> {
  const asked = storage === null ? false : await readNotifyAsked(storage);
  const platform = detectPlatform();

  if (platform === 'capacitor') {
    const native = await readNativeNotifyStatus(asked);
    if (native !== null) {
      return { ...native, source: 'android', asked };
    }
    return { ...statusBase(asked), source: 'android', runtime: 'unsupported' };
  }
  if (platform === 'tauri') return readTauriNotifyStatus(asked);

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
    ...statusBase(asked),
    source: 'web',
    runtime,
    // appEnabled 只有 Android 原生能报；这里保留浏览器权限的近似值，界面按 source 忽略它
    appEnabled: permission === 'granted' || permission === 'default',
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
