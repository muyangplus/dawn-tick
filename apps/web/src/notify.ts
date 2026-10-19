import { detectPlatform } from './platform-detect.ts';
import type { Storage } from '@dawn-tick/core';

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** 是否已向系统申请过通知权限：用来区分「没问过」与「问过但被拒绝」。 */
const ASKED_KEY = 'notify_permission_asked';

export async function markNotifyAsked(storage: Storage): Promise<void> {
  try {
    await storage.writeMeta(ASKED_KEY, '1');
  } catch {
    // 写标记失败不影响权限流程
  }
}

export async function readNotifyAsked(storage: Storage): Promise<boolean> {
  try {
    return (await storage.readMeta(ASKED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function ensureNotifyPermission(): Promise<NotifyPermission> {
  const platform = detectPlatform();

  if (platform === 'capacitor') {
    const local = await import('@capacitor/local-notifications');
    const result = await local.LocalNotifications.requestPermissions();
    return result.display === 'granted' ? 'granted' : 'denied';
  }

  if (platform === 'tauri') {
    const plugin = await import('@tauri-apps/plugin-notification');
    if (!(await plugin.isPermissionGranted())) {
      const granted = await plugin.requestPermission();
      return granted === 'granted' ? 'granted' : 'denied';
    }
    return 'granted';
  }

  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  const requested = await Notification.requestPermission();
  return requested as NotifyPermission;
}

export async function notifyNow(title: string, body: string): Promise<void> {
  const platform = detectPlatform();

  if (platform === 'capacitor') {
    const local = await import('@capacitor/local-notifications');
    await local.LocalNotifications.schedule({
      notifications: [{ id: Date.now() % 2_000_000_000, title, body }],
    });
    return;
  }

  if (platform === 'tauri') {
    const plugin = await import('@tauri-apps/plugin-notification');
    if (await plugin.isPermissionGranted()) plugin.sendNotification({ title, body });
    return;
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

/** Android 支持提前排定通知，应用关闭后仍可送达。 */
export async function scheduleNotify(id: number, title: string, body: string, at: number): Promise<boolean> {
  if (detectPlatform() !== 'capacitor') return false;
  const local = await import('@capacitor/local-notifications');
  await local.LocalNotifications.schedule({
    notifications: [{ id: id % 2_000_000_000, title, body, schedule: { at: new Date(at) } }],
  });
  return true;
}

export function currentNotifyPermission(): NotifyPermission {
  const platform = detectPlatform();
  if (platform !== 'web') return 'default';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyPermission;
}
