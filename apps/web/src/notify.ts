import { detectPlatform } from './platform-detect.ts';

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

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
