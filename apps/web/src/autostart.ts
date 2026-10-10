import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';

export interface AutoStartStatus {
  user: boolean;
  machine: boolean;
}

export function isAutoStartSupported(): boolean {
  return detectPlatform() === 'tauri';
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(command, args);
}

/** 注册状态：用户级或机器级任一存在即为已注册。 */
export async function readAutoStart(): Promise<boolean | null> {
  if (!isAutoStartSupported()) return null;
  try {
    const status = await invoke<AutoStartStatus>('autostart_status');
    return status.user || status.machine;
  } catch (cause: unknown) {
    logWarn('autostart', '读取开机自启状态失败', { message: String(cause) });
    return null;
  }
}

export interface AutoStartResult {
  ok: boolean;
  error?: string;
}

export async function writeAutoStart(enabled: boolean): Promise<AutoStartResult> {
  if (!isAutoStartSupported()) return { ok: false, error: '当前平台不支持' };
  try {
    const status = await invoke<AutoStartStatus>('set_autostart', { enabled });
    logInfo('autostart', enabled ? '已注册开机自启' : '已取消开机自启', status as unknown as Record<string, unknown>);
    return { ok: true };
  } catch (cause: unknown) {
    const error = cause instanceof Error ? cause.message : String(cause);
    logWarn('autostart', '设置开机自启失败', { message: error });
    return { ok: false, error };
  }
}

/** 申请管理员权限重启，由提权实例写入机器级启动项。 */
export async function elevateAutoStart(): Promise<boolean> {
  if (!isAutoStartSupported()) return false;
  try {
    await invoke('relaunch_elevated_autostart');
    logInfo('autostart', '已请求提权注册');
    return true;
  } catch (cause: unknown) {
    logWarn('autostart', '申请管理员权限失败', { message: String(cause) });
    return false;
  }
}

/** 持久化「启动时隐藏窗口」，供原生层在下次启动时读取。 */
export async function saveStartupPrefs(hidden: boolean): Promise<void> {
  if (!isAutoStartSupported()) return;
  try {
    await invoke('save_startup_prefs', { hidden });
    logInfo('autostart', '保存启动偏好', { hidden });
  } catch (cause: unknown) {
    logWarn('autostart', '保存启动偏好失败', { message: String(cause) });
  }
}
