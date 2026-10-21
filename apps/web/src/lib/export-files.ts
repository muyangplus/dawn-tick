import { toBase64Bytes } from '@dawn-tick/core';
import { logInfo, logWarn } from '../log.ts';
import { isAndroidApp, isDesktopApp } from './capabilities.ts';
import { nativeErrorMessage } from './native.ts';
import { PLUGIN_NAMES, loadPlugin, type FileSharePlugin } from './plugins.ts';

/**
 * 导出文件的平台出口（I-12）：Android 真实落盘、分享与「打开所在位置」。
 *
 * 边界：
 * - 只做 Android 私有目录写入与 FileShare 插件调用，选择保存位置与文案留在 `system-actions.ts`、
 *   `screens/settings/file-export.ts`；
 * - 写进应用缓存目录（`FileProvider` 只暴露缓存与外部私有下载目录），返回绝对路径；
 * - 桌面走 `reveal_path`，Web 没有本地路径，两者都不在这里。
 */

/**
 * 导出成功后的原生动作能力：桌面用资源管理器定位文件，
 * Android 用分享面板或文件应用打开目录，Web 没有本地路径。
 */
export type SavedFileActions = 'desktop' | 'android' | 'none';

export function savedFileActions(): SavedFileActions {
  if (isDesktopApp()) return 'desktop';
  if (isAndroidApp()) return 'android';
  return 'none';
}

/** `file:///data/user/0/…` → `/data/user/0/…`：展示与 FileShare 都接受绝对路径。 */
function pathFromFileUri(uri: string): string {
  const withoutScheme = uri.replace(/^file:\/\//i, '');
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

/**
 * Android 落盘：文本按 UTF-8 写，二进制按 Base64 交给插件解码；返回文件绝对路径。
 */
export async function writeAndroidFile(name: string, content: string | Uint8Array): Promise<string> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  if (typeof content === 'string') {
    await Filesystem.writeFile({
      path: name,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } else {
    await Filesystem.writeFile({
      path: name,
      data: toBase64Bytes(content),
      directory: Directory.Cache,
      recursive: true,
    });
  }
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  if (typeof uri !== 'string' || uri === '') throw new Error('文件写入后找不到路径');
  return pathFromFileUri(uri);
}

async function loadFileShare(): Promise<FileSharePlugin | null> {
  try {
    return await loadPlugin<FileSharePlugin>(PLUGIN_NAMES.fileShare);
  } catch (cause: unknown) {
    logWarn('export', '文件分享插件不可用', { message: nativeErrorMessage(cause) });
    return null;
  }
}

/** Android：把导出的文件交给系统分享面板；返回是否已弹出。 */
export async function shareExportedFile(path: string): Promise<boolean> {
  const plugin = await loadFileShare();
  if (plugin === null) return false;
  try {
    const result = await plugin.shareFile({ path });
    const shared = result?.shared === true;
    logInfo('export', '已打开系统分享面板', { path, shared });
    return shared;
  } catch (cause: unknown) {
    logWarn('export', '打开系统分享面板失败', { path, message: nativeErrorMessage(cause) });
    return false;
  }
}

/** Android：打开导出文件所在目录（原生按 documents → content → 分享三级回退）。 */
export async function revealExportedFile(path: string): Promise<boolean> {
  const plugin = await loadFileShare();
  if (plugin === null) return false;
  try {
    const result = await plugin.revealFile({ path });
    logInfo('export', '已打开文件所在位置', { path, via: result?.via ?? null });
    return result?.opened === true;
  } catch (cause: unknown) {
    logWarn('export', '打开所在位置失败', { path, message: nativeErrorMessage(cause) });
    return false;
  }
}
