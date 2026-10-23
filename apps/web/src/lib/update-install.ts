import { useEffect, useSyncExternalStore } from 'react';
import { toBase64Bytes } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from './capabilities.ts';
import { invokeNative } from './native.ts';
import { PLUGIN_NAMES, loadPlugin, type ApkInstallerPlugin } from './plugins.ts';
import type { UpdateDownloadHost, UpdatePlatform, WindowsInstallKind } from './update-download.ts';

/**
 * 自动更新（I-03）的平台出口：按渠道把下载好的安装包写盘并交给系统安装器/便携替换脚本。
 *
 * 边界：
 * - 只做「写盘 + 启动安装器 + 读校验文件」，渠道选择、校验与状态机在 `update-download.ts`；
 * - 桌面走 Tauri 命令（`tempDir` + `write_binary_file` / `run_installer` / `prepare_portable_update`
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

/** 订阅检测结果（非 React 场景用）。 */
export function subscribeWindowsInstallKind(listener: () => void): () => void {
  return subscribeInstallKind(listener);
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
  if (kind === null) return '检测中';
  return kind === 'portable' ? '便携版' : '安装版';
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
  if (typeof doFetch !== 'function') throw new Error('当前环境无法联网读取校验文件');
  const response = await doFetch(url, signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(`读取校验文件失败：更新源返回 ${response.status}`);
  return await response.text();
}

/** 桌面写盘：安装包写进系统临时目录（`run_installer` 只允许临时目录与数据目录）。 */
async function writeDesktopInstaller(fileName: string, bytes: Uint8Array): Promise<string> {
  const { tempDir } = await import('@tauri-apps/api/path');
  const dir = await tempDir();
  if (dir === '') throw new Error('无法定位系统临时目录');
  const written = await invokeNative<string>('write_binary_file', {
    path: joinPath(dir, fileName),
    base64: toBase64Bytes(bytes),
  });
  if (written === undefined) throw new Error('当前平台不支持写入安装包');
  return written;
}

async function installOnWindows(path: string): Promise<{ needsPermission: boolean }> {
  const launched = await invokeNative<string>('run_installer', { path });
  if (launched === undefined) throw new Error('当前平台不支持启动安装程序');
  return { needsPermission: false };
}

/** 便携版：解压 zip 并生成替换脚本，返回脚本路径（应用退出后才真正覆盖 exe）。 */
async function preparePortableOnWindows(zipPath: string): Promise<string> {
  const script = await invokeNative<string>('prepare_portable_update', { zipPath });
  if (script === undefined) throw new Error('当前平台不支持便携版自动替换，请到发布页手动下载');
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
  if (typeof uri !== 'string' || uri === '') throw new Error('安装包写入后找不到路径');
  return uri;
}

async function installOnAndroid(path: string): Promise<{ needsPermission: boolean }> {
  const plugin = await loadPlugin<ApkInstallerPlugin>(PLUGIN_NAMES.apkInstaller);
  if (plugin === null) throw new Error('当前平台不支持自动安装，请到发布页手动下载');
  const result = await plugin.installApk({ path });
  if (result?.needsPermission === true) return { needsPermission: true };
  if (result?.opened !== true) throw new Error('系统安装器没有启动');
  return { needsPermission: false };
}

/** 桌面用原生 HTTP 下载：绕过 WebView 的 CORS，仍支持流式进度与取消（与 webdav 同口径）。 */
function desktopHttpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return import('@tauri-apps/plugin-http').then(({ fetch: nativeFetch }) => nativeFetch(input, init));
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
