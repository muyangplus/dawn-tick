import { useEffect, useSyncExternalStore } from 'react';
import { toBase64Bytes } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from './capabilities.ts';
import { invokeNative } from './native.ts';
import { PLUGIN_NAMES, loadPlugin, type ApkInstallerPlugin } from './plugins.ts';
import type { UpdateDownloadHost, UpdatePlatform, WindowsInstallKind } from './update-download.ts';
import { desktopHttpFetch } from './update-fetch.ts';
import { updateTaskCopy } from '../copy/update-task.ts';

/**
 * 自动更新（I-03）的平台出口：按渠道把下载好的安装包写盘并交给系统安装器/便携替换脚本。
 *
 * 边界：
 * - 只做「写盘 + 启动安装器 + 读校验文件」，渠道选择、校验与状态机在 `update-download.ts`；
 * - 桌面走 Tauri 命令（`stage_update` 暂存 + `run_installer` / `prepare_portable_update` 复核哈希后启动
 *   / `exit_for_update`），Android 走 Capacitor `Filesystem` + `ApkInstaller`，Web 不下载；
 * - Windows 运行形态（便携版/安装版）由 Rust 判定，这里只缓存并与界面共享检测结果；
 * - 这些函数都经 `UpdateDownloadHost` 注入，单测用假 host 即可，不加载原生模块。
 */

/** 当前运行环境对应的更新渠道：桌面取 Windows 安装包、Android 取 APK、Web 只提示刷新。 */
export function updatePlatform(): UpdatePlatform {
  if (isDesktopApp()) return 'windows';
  if (isAndroidApp()) return 'android';
  return 'web';
}

/**
 * 已检测到的 Windows 运行形态；null 表示还没检测（界面先按安装版渲染，拿到结果再切）。
 * 检测失败或识别不到时 Rust 会返回 portable（用户确认按便携版处理）。
 */
let detectedInstallKind: WindowsInstallKind | null = null;
let pendingInstallKind: Promise<WindowsInstallKind> | null = null;
const installKindListeners = new Set<() => void>();

function publishInstallKind(next: WindowsInstallKind): WindowsInstallKind {
  if (detectedInstallKind !== next) {
    detectedInstallKind = next;
    for (const listener of installKindListeners) listener();
  }
  return next;
}

function subscribeInstallKind(listener: () => void): () => void {
  installKindListeners.add(listener);
  return () => {
    installKindListeners.delete(listener);
  };
}

/** 同步快照：弹窗与设备页在同一个检测结果上渲染。 */
export function windowsInstallKindSnapshot(): WindowsInstallKind | null {
  return detectedInstallKind;
}

/** 检测失败时的兜底：按便携版处理（用户已确认），不让更新入口整个不可用。 */
export async function detectWindowsInstallKind(): Promise<WindowsInstallKind> {
  if (detectedInstallKind !== null) return detectedInstallKind;
  if (pendingInstallKind !== null) return pendingInstallKind;
  pendingInstallKind = (async () => {
    try {
      const raw = await invokeNative<string>('windows_install_kind');
      return publishInstallKind(raw === 'installed' ? 'installed' : 'portable');
    } catch {
      return publishInstallKind('portable');
    } finally {
      pendingInstallKind = null;
    }
  })();
  return pendingInstallKind;
}

/** 界面读取检测结果：第一步可能还是 null（检测中）。 */
export function useWindowsInstallKind(): WindowsInstallKind | null {
  return useSyncExternalStore(subscribeInstallKind, windowsInstallKindSnapshot, windowsInstallKindSnapshot);
}

/** 冒烟/单测注入检测结果：正常界面不调用，避免依赖真实机器布局。 */
export function setWindowsInstallKindForTests(kind: WindowsInstallKind | null): void {
  if (kind === null) {
    detectedInstallKind = null;
    pendingInstallKind = null;
    return;
  }
  publishInstallKind(kind);
}

/** Windows 渠道上自动触发一次检测；其它渠道返回 null。 */
export function useDetectedWindowsInstallKind(platform: UpdatePlatform): WindowsInstallKind | null {
  const kind = useWindowsInstallKind();
  useEffect(() => {
    if (platform === 'windows' && kind === null) void detectWindowsInstallKind();
  }, [platform, kind]);
  return platform === 'windows' ? kind : null;
}

/** 「便携版 / 安装版」的中文说明：检测中单独给一句，避免闪成错误结论。 */
export function windowsInstallKindLabel(kind: WindowsInstallKind | null): string {
  if (kind === null) return updateTaskCopy.installKindDetecting;
  return kind === 'portable' ? updateTaskCopy.installKindPortable : updateTaskCopy.installKindInstaller;
}

/** 拼接目录与文件名：Windows 路径用反斜杠，其它平台用正斜杠。 */
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith('\\') || dir.endsWith('/')) return `${dir}${name}`;
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`;
}

/** 读 `.sha256` 文本：与安装包同一个下载源，失败给可读原因。 */
async function fetchChecksumText(
  url: string,
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error(updateTaskCopy.checksumOffline);
  const response = await doFetch(url, signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(updateTaskCopy.checksumHttp(response.status));
  return await response.text();
}

const STAGED_PREFIX = 'staged:';

/** 暂存句柄：`staged:<文件名>:<sha256>`，可随下载任务持久化，安装时原样交回 Rust 复核。 */
export function stagedHandle(name: string, sha256: string): string {
  return `${STAGED_PREFIX}${name}:${sha256}`;
}

export function parseStagedHandle(handle: string): { name: string; sha256: string } | null {
  if (!handle.startsWith(STAGED_PREFIX)) return null;
  const rest = handle.slice(STAGED_PREFIX.length);
  const split = rest.lastIndexOf(':');
  if (split <= 0) return null;
  return { name: rest.slice(0, split), sha256: rest.slice(split + 1) };
}

/** 桌面写盘：交给 Rust 写进应用私有的更新暂存目录，返回暂存句柄（不再由前端指定路径）。 */
async function writeDesktopInstaller(fileName: string, bytes: Uint8Array): Promise<string> {
  const staged = await invokeNative<{ name: string; sha256: string }>('stage_update', {
    name: fileName,
    base64: toBase64Bytes(bytes),
  });
  if (staged === undefined) throw new Error(updateTaskCopy.writeUnsupported);
  return stagedHandle(staged.name, staged.sha256);
}

function requireStaged(handle: string): { name: string; sha256: string } {
  const staged = parseStagedHandle(handle);
  if (staged === null) throw new Error(updateTaskCopy.stagedOutside);
  return staged;
}

async function installOnWindows(handle: string): Promise<{ needsPermission: boolean }> {
  const launched = await invokeNative<string>('run_installer', requireStaged(handle));
  if (launched === undefined) throw new Error(updateTaskCopy.launchUnsupported);
  return { needsPermission: false };
}

/** 便携版：解压 zip 并生成替换脚本，返回脚本路径（应用退出后才真正覆盖 exe）。 */
async function preparePortableOnWindows(handle: string): Promise<string> {
  const script = await invokeNative<string>('prepare_portable_update', requireStaged(handle));
  if (script === undefined) throw new Error(updateTaskCopy.portableUnsupported);
  return script;
}

/** 便携版：退出应用，让替换脚本接手（先重启旧进程会重新占用 exe）。 */
async function exitForUpdate(): Promise<void> {
  await invokeNative('exit_for_update');
}

/** Android 写盘：写进应用缓存目录（`FileProvider` 只暴露缓存与外部私有下载目录）。 */
async function writeAndroidPackage(fileName: string, bytes: Uint8Array): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  await Filesystem.writeFile({
    path: fileName,
    data: toBase64Bytes(bytes),
    directory: Directory.Cache,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
  if (typeof uri !== 'string' || uri === '') throw new Error(updateTaskCopy.writtenPathMissing);
  return uri;
}

async function installOnAndroid(path: string): Promise<{ needsPermission: boolean }> {
  const plugin = await loadPlugin<ApkInstallerPlugin>(PLUGIN_NAMES.apkInstaller);
  if (plugin === null) throw new Error(updateTaskCopy.autoInstallUnsupported);
  const result = await plugin.installApk({ path });
  if (result?.needsPermission === true) return { needsPermission: true };
  if (result?.opened !== true) throw new Error(updateTaskCopy.installerNotOpened);
  return { needsPermission: false };
}

/** 按渠道创建默认出口：桌面写数据目录并调 `run_installer`，Android 写 Cache 并调 `ApkInstaller`。 */
export function createUpdateHost(
  platform: 'windows' | 'android',
  fetchImpl?: typeof fetch,
): UpdateDownloadHost {
  // 桌面默认走原生 HTTP（GitHub 资产下载不受 WebView CORS 限制）；
  // Android 的 CapacitorHttp 已在 capacitor.config.ts 里全局接管 fetch，这里用默认实现即可。
  const effectiveFetch = fetchImpl ?? (platform === 'windows' ? desktopHttpFetch : undefined);
  const readChecksum = (url: string, signal?: AbortSignal): Promise<string | null> =>
    fetchChecksumText(url, effectiveFetch, signal);
  if (platform === 'windows') {
    return {
      ...(effectiveFetch === undefined ? {} : { fetchImpl: effectiveFetch }),
      readChecksum,
      write: writeDesktopInstaller,
      install: installOnWindows,
      installPortable: preparePortableOnWindows,
      exitForUpdate,
    };
  }
  return {
    ...(effectiveFetch === undefined ? {} : { fetchImpl: effectiveFetch }),
    readChecksum,
    write: writeAndroidPackage,
    install: installOnAndroid,
  };
}
