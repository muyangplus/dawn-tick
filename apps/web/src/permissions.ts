import { detectPlatform } from './platform-detect.ts';
import { ensureNotifyPermission, type NotifyPermission } from './notify.ts';
import { logInfo, logWarn } from './log.ts';

export type ExactAlarmState = 'granted' | 'denied' | 'unsupported';

export interface PermissionReport {
  platform: 'capacitor' | 'tauri' | 'web';
  notifications: NotifyPermission | 'skipped';
  exactAlarm: ExactAlarmState;
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

/**
 * 启动时主动索取必要权限：通知（Android 13+ 运行时权限）。
 * 精确闹钟没开且用户开着课前提醒时，顺带跳一次系统页——不跳的话提醒会被系统降到「大致时间」。
 */
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
