import { isAutoStartSupported } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage } from './lib/native.ts';
import { logInfo, logWarn } from './log.ts';

export { isAutoStartSupported };

export interface AutoStartStatus {
  user: boolean;
  machine: boolean;
}

/** 注册状态：用户级或机器级任一存在即为已注册。 */
export async function readAutoStart(): Promise<boolean | null> {
  if (!isAutoStartSupported()) return null;
  try {
    const status = await invokeNative<AutoStartStatus>('autostart_status');
    if (status === undefined) return null;
    return status.user || status.machine;
  } catch (cause: unknown) {
    logWarn('autostart', '读取开机自启状态失败', { message: nativeErrorMessage(cause) });
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
    const status = await invokeNative<AutoStartStatus>('set_autostart', { enabled });
    logInfo('autostart', enabled ? '已注册开机自启' : '已取消开机自启', status as unknown as Record<string, unknown>);
    return { ok: true };
  } catch (cause: unknown) {
    const error = nativeErrorMessage(cause);
    logWarn('autostart', '设置开机自启失败', { message: error });
    return { ok: false, error };
  }
}

/** 申请管理员权限重启，由提权实例执行需要提升权限的启动项操作。 */
export async function elevateAutoStart(): Promise<boolean> {
  if (!isAutoStartSupported()) return false;
  try {
    await invokeNative('relaunch_elevated');
    logInfo('autostart', '已请求提权注册');
    return true;
  } catch (cause: unknown) {
    logWarn('autostart', '申请管理员权限失败', { message: nativeErrorMessage(cause) });
    return false;
  }
}

/** 持久化「启动时隐藏窗口」，供原生层在下次启动时读取。 */
export async function saveStartupPrefs(hidden: boolean): Promise<void> {
  if (!isAutoStartSupported()) return;
  try {
    await invokeNative('save_startup_prefs', { hidden });
    logInfo('autostart', '保存启动偏好', { hidden });
  } catch (cause: unknown) {
    logWarn('autostart', '保存启动偏好失败', { message: nativeErrorMessage(cause) });
  }
}

export interface ElevationStatus {
  elevated: boolean;
}

export interface ElevationResult {
  ok: boolean;
  error: string | null;
}

/** 当前是否具备管理员权限；非桌面端或读取失败返回 null。 */
export async function readElevationStatus(): Promise<boolean | null> {
  if (!isAutoStartSupported()) return null;
  try {
    const status = await invokeNative<ElevationStatus>('elevation_status');
    return status === undefined ? null : status.elevated;
  } catch (cause: unknown) {
    logWarn('desktop', '读取运行权限失败', { message: nativeErrorMessage(cause) });
    return null;
  }
}

/** 申请管理员权限并重启（与开机自启提权同一条原生链路）；失败时带回一行原因。 */
export async function requestElevation(): Promise<ElevationResult> {
  if (!isAutoStartSupported()) return { ok: false, error: '当前平台不支持' };
  try {
    await invokeNative('relaunch_elevated');
    logInfo('desktop', '请求以管理员身份重新启动');
    return { ok: true, error: null };
  } catch (cause: unknown) {
    const error = nativeErrorMessage(cause);
    logWarn('desktop', '提权失败', { message: error });
    return { ok: false, error };
  }
}
