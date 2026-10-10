import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';

export function isAutoStartSupported(): boolean {
  return detectPlatform() === 'tauri';
}

async function plugin(): Promise<{
  isEnabled: () => Promise<boolean>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}> {
  return import('@tauri-apps/plugin-autostart');
}

export async function readAutoStart(): Promise<boolean | null> {
  if (!isAutoStartSupported()) return null;
  try {
    return await (await plugin()).isEnabled();
  } catch (cause: unknown) {
    logWarn('autostart', '读取开机自启状态失败', { message: String(cause) });
    return null;
  }
}

export async function writeAutoStart(enabled: boolean): Promise<boolean> {
  if (!isAutoStartSupported()) return false;
  try {
    const api = await plugin();
    if (enabled) await api.enable();
    else await api.disable();
    logInfo('autostart', enabled ? '已注册开机自启' : '已取消开机自启');
    return true;
  } catch (cause: unknown) {
    logWarn('autostart', '设置开机自启失败', { message: String(cause) });
    return false;
  }
}

/** 持久化「启动时隐藏窗口」，供原生层在下次启动时读取。 */
export async function saveStartupPrefs(hidden: boolean): Promise<void> {
  if (!isAutoStartSupported()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_startup_prefs', { hidden });
    logInfo('autostart', '保存启动偏好', { hidden });
  } catch (cause: unknown) {
    logWarn('autostart', '保存启动偏好失败', { message: String(cause) });
  }
}
