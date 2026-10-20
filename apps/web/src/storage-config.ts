import { canConfigureStorage, isDesktopApp } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage } from './lib/native.ts';
import { logInfo, logWarn } from './log.ts';

export { canConfigureStorage };

/** 原生存储位置信息（Rust 侧 StorageInfo，camelCase）。 */
export interface StorageInfo {
  /** 实际使用的数据目录 */
  dir: string;
  /** 没设置自定义位置时使用的目录 */
  defaultDir: string;
  /** 已保存的自定义位置（原样，便于回填输入框） */
  customPath: string;
  /** 便携版：exe 同目录 */
  portable: boolean;
  /** 引导文件路径 */
  configFile: string;
  /** 数据目录当前是否可写 */
  writable: boolean;
  /** 自定义位置不可用时的提示 */
  fallbackReason: string | null;
  dbFile: string;
  dbExists: boolean;
  dbBytes: number;
  /** 数据库旁边的 -wal / -shm / -journal 文件 */
  sidecars: string[];
  logDir: string;
  /** 上一次改位置时复制过去的文件名 */
  copied: string[];
}

/** 存储状态行上的回退标记：设备页把它拼在真实存储类型后面。 */
export const STORAGE_FALLBACK_LABEL = '临时回退';

/** 设置/设备页的存储类型文案：回退时一定要让用户看出「现在不是原生库」。 */
export function storageStatusLabel(label: string, fallback: boolean): string {
  return fallback ? `${label} · ${STORAGE_FALLBACK_LABEL}` : label;
}

function describe(cause: unknown): string {
  return nativeErrorMessage(cause);
}

export async function readStorageInfo(): Promise<StorageInfo | null> {
  if (!canConfigureStorage()) return null;
  try {
    return (await invokeNative<StorageInfo>('storage_info')) ?? null;
  } catch (cause: unknown) {
    logWarn('storage', '读取存储位置失败', { message: describe(cause) });
    return null;
  }
}

export interface StoragePathResult {
  info: StorageInfo | null;
  error: string | null;
}

/** 保存自定义存储位置；传空字符串表示恢复默认。 */
export async function saveStoragePath(path: string): Promise<StoragePathResult> {
  if (!canConfigureStorage()) return { info: null, error: '当前平台不支持修改存储位置' };
  try {
    const info = await invokeNative<StorageInfo>('set_storage_path', { path });
    if (info === undefined) return { info: null, error: '当前平台不支持修改存储位置' };
    logInfo('storage', '存储位置已保存', { dir: info.dir, custom: info.customPath, copied: info.copied.length });
    return { info, error: null };
  } catch (cause: unknown) {
    const message = describe(cause);
    logWarn('storage', '保存存储位置失败', { path, message });
    return { info: null, error: message };
  }
}

export async function openDataDirectory(): Promise<string | null> {
  if (!canConfigureStorage()) return null;
  try {
    return (await invokeNative<string>('open_data_dir')) ?? null;
  } catch (cause: unknown) {
    logWarn('storage', '打开数据目录失败', { message: describe(cause) });
    return null;
  }
}

export async function relaunchApplication(): Promise<boolean> {
  if (!canConfigureStorage()) return false;
  try {
    await invokeNative('relaunch_app');
    logInfo('storage', '已请求重启应用');
    return true;
  } catch (cause: unknown) {
    logWarn('storage', '重启应用失败', { message: describe(cause) });
    return false;
  }
}

/** 托盘状态（`tray_status`）：与存储位置、重启同属桌面壳环境诊断，视图只拿结果不碰原生命令。 */
export interface TrayStatus {
  created: boolean;
  detail: string;
}

export interface TrayStatusResult {
  status: TrayStatus | null;
  error: string | null;
}

export async function readTrayStatus(): Promise<TrayStatusResult> {
  if (!isDesktopApp()) return { status: null, error: '当前平台没有托盘' };
  try {
    const status = await invokeNative<TrayStatus>('tray_status');
    return { status: status ?? null, error: status === undefined ? '当前平台没有托盘' : null };
  } catch (cause: unknown) {
    const message = describe(cause);
    logWarn('desktop', '读取托盘状态失败', { message });
    return { status: null, error: message };
  }
}
