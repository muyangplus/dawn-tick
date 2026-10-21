import { toBase64Bytes } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from './capabilities.ts';
import { invokeNative } from './native.ts';
import { PLUGIN_NAMES, loadPlugin, type ApkInstallerPlugin } from './plugins.ts';
import type { UpdateDownloadHost, UpdatePlatform } from './update-download.ts';

/**
 * 自动更新（I-03）的平台出口：按渠道把下载好的安装包写盘并交给系统安装器。
 *
 * 边界：
 * - 只做「写盘 + 启动安装器 + 读校验文件」，渠道选择、校验与状态机在 `update-download.ts`；
 * - 桌面走 Tauri 命令（`tempDir` + `write_binary_file` / `run_installer`），
 *   Android 走 Capacitor `Filesystem` + `ApkInstaller`，Web 不下载；
 * - 这些函数都经 `UpdateDownloadHost` 注入，单测用假 host 即可，不加载原生模块。
 */

/** 当前运行环境对应的更新渠道：桌面取 Windows 安装包、Android 取 APK、Web 只提示刷新。 */
export function updatePlatform(): UpdatePlatform {
  if (isDesktopApp()) return 'windows';
  if (isAndroidApp()) return 'android';
  return 'web';
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
    };
  }
  return {
    ...(effectiveFetch === undefined ? {} : { fetchImpl: effectiveFetch }),
    readChecksum,
    write: writeAndroidPackage,
    install: installOnAndroid,
  };
}
