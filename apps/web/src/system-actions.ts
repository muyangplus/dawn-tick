import { toBase64Bytes } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage } from './lib/native.ts';
import { PLUGIN_NAMES, loadPlugin, type SystemActionsPlugin } from './lib/plugins.ts';
import { writeAndroidFile } from './lib/export-files.ts';
import { logInfo, logWarn } from './log.ts';

/** 插件接口定义已集中到 `lib/plugins.ts`，这里保留原导出路径供旧调用方使用。 */
export type { SystemActionsPlugin } from './lib/plugins.ts';

/** 用系统默认浏览器打开链接：桌面端走原生命令，Android 走原生 ACTION_VIEW（WebView 的 window.open 会卡包可见性），Web 开新窗口。 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      await invokeNative('open_external_url', { url });
      logInfo('link', '用默认浏览器打开', { url });
      return true;
    } catch (cause: unknown) {
      logWarn('link', '打开默认浏览器失败', { url, message: nativeErrorMessage(cause) });
      return false;
    }
  }
  const plugin = await loadSystemActions();
  if (plugin !== null) {
    try {
      if (await openWithSystem(url)) {
        logInfo('link', '交给系统浏览器打开', { url });
        return true;
      }
    } catch (cause: unknown) {
      logWarn('link', '原生打开失败，改用新窗口', { url, message: nativeErrorMessage(cause) });
    }
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened === null) {
    logWarn('link', '新窗口被拦截', { url });
    return false;
  }
  logInfo('link', '在新窗口打开', { url });
  return true;
}

/** 原生读到的通知状态：应用级开关 + 运行时权限 + 渠道静音。 */export interface NotifyStatusDetail {
  appEnabled: boolean;
  runtime: 'granted' | 'denied' | 'prompt' | 'permanently-denied';
  channelId: string | null;
  channelName: string | null;
  channelMuted: boolean;
}

function runtimeOf(value: string | undefined): NotifyStatusDetail['runtime'] {
  if (value === 'granted' || value === 'denied' || value === 'prompt' || value === 'permanently-denied') {
    return value;
  }
  return 'granted';
}

/** 通知状态：安卓走原生精确查询，其它平台返回 null 由调用方兜底。 */
export async function readNativeNotifyStatus(asked: boolean): Promise<NotifyStatusDetail | null> {
  const plugin = await loadSystemActions();
  if (plugin === null) return null;
  try {
    const result = await plugin.notificationStatus({ asked });
    return {
      appEnabled: result?.appEnabled !== false,
      runtime: runtimeOf(result?.runtime),
      channelId: typeof result?.channelId === 'string' && result.channelId !== '' ? result.channelId : null,
      channelName: typeof result?.channelName === 'string' && result.channelName !== '' ? result.channelName : null,
      channelMuted: result?.channelMuted === true,
    };
  } catch (cause: unknown) {
    logWarn('permission', '读取通知状态失败', { message: nativeErrorMessage(cause) });
    return null;
  }
}

/** 跳系统通知设置页；给了渠道 id 就直达该渠道。 */
export async function openNotifySettings(channelId?: string | null): Promise<boolean> {
  const plugin = await loadSystemActions();
  if (plugin === null) return false;
  try {
    const result = await plugin.openNotificationSettings(channelId === null || channelId === undefined ? {} : { channelId });
    logInfo('permission', '已跳转通知设置页', { channelId: channelId ?? null, opened: result?.opened === true });
    return true;
  } catch (cause: unknown) {
    logWarn('permission', '跳转通知设置页失败', { message: nativeErrorMessage(cause) });
    return false;
  }
}

async function loadSystemActions(): Promise<SystemActionsPlugin | null> {
  try {
    return await loadPlugin<SystemActionsPlugin>(PLUGIN_NAMES.systemActions);
  } catch (cause: unknown) {
    logWarn('link', '系统动作插件不可用', { message: nativeErrorMessage(cause) });
    return null;
  }
}

async function openWithSystem(url: string): Promise<boolean> {
  const plugin = await loadSystemActions();
  if (plugin === null) return false;
  const result = await plugin.openExternal({ url });
  return result.opened === true;
}

/** 是否已在电池优化白名单：false 表示后台可能被系统限制，提醒会晚点送达。 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean | null> {
  const plugin = await loadSystemActions();
  if (plugin === null) return null;
  try {
    return (await plugin.isIgnoringBatteryOptimizations()).ignoring === true;
  } catch (cause: unknown) {
    logWarn('link', '读取电池优化状态失败', { message: nativeErrorMessage(cause) });
    return null;
  }
}

/** 跳系统设置页申请加入电池优化白名单；返回是否已发起跳转。 */
export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  const plugin = await loadSystemActions();
  if (plugin === null) return false;
  try {
    const result = await plugin.requestIgnoreBatteryOptimizations();
    logInfo('link', '已跳转电池优化设置页', {
      requested: result.requested === true,
      ignoring: result.ignoring === true,
    });
    return true;
  } catch (cause: unknown) {
    logWarn('link', '跳转电池优化设置页失败', { message: nativeErrorMessage(cause) });
    return false;
  }
}

/** 复制文本：剪贴板接口不可用时退回选区复制。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走选区回退
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    document.body.removeChild(area);
    if (!copied) logWarn('link', '复制链接失败', { length: text.length });
    return copied;
  } catch (cause: unknown) {
    logWarn('link', '复制链接异常', { message: nativeErrorMessage(cause) });
    return false;
  }
}

/** 在资源管理器中打开日志目录；返回目录路径，平台不支持时为 null。 */
export async function openLogDirectory(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  try {
    const dir = await invokeNative<string>('open_log_dir');
    if (dir === undefined) return null;
    logInfo('log', '打开日志目录', { dir });
    return dir;
  } catch (cause: unknown) {
    logWarn('log', '打开日志目录失败', { message: nativeErrorMessage(cause) });
    return null;
  }
}

/**
 * 在资源管理器中定位文件或目录（`reveal_path`）。
 *
 * 文件会在所在文件夹里选中，目录直接打开；平台不支持、路径不存在或调用失败返回 false。
 */
export async function revealPath(path: string): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const shown = await invokeNative<string>('reveal_path', { path });
    if (shown === undefined) return false;
    logInfo('export', '已在资源管理器中定位', { path: shown });
    return true;
  } catch (cause: unknown) {
    logWarn('export', '打开所在位置失败', { path, message: nativeErrorMessage(cause) });
    return false;
  }
}

export interface SaveTextResult {
  /** 是否写出成功；用户取消时为 false 且 `cancelled` 为 true */
  ok: boolean;
  cancelled: boolean;
  /** 实际写入的路径，浏览器下载时为 null */
  path: string | null;
  error: string | null;
}

/** 保存文本：桌面端弹系统保存对话框写入所选路径；浏览器与移动端退回浏览器下载。 */
export async function saveTextFile(
  name: string,
  content: string,
  options: { filterName?: string; extension?: string; mime?: string } = {},
): Promise<SaveTextResult> {
  const extension = options.extension ?? 'txt';
  if (isDesktopApp()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const chosen = await save({
        defaultPath: name,
        filters: [{ name: options.filterName ?? '文本文件', extensions: [extension] }],
      });
      if (chosen === null) {
        logInfo('export', '用户取消保存', { name });
        return { ok: false, cancelled: true, path: null, error: null };
      }
      const path = await invokeNative<string>('write_text_file', { path: chosen, content });
      if (path === undefined) throw new Error('当前平台不支持写入文件');
      logInfo('export', '已写入文件', { path, bytes: content.length });
      return { ok: true, cancelled: false, path, error: null };
    } catch (cause: unknown) {
      const message = nativeErrorMessage(cause);
      logWarn('export', '写入文件失败', { name, message });
      return { ok: false, cancelled: false, path: null, error: message };
    }
  }
  if (isAndroidApp()) {
    try {
      const path = await writeAndroidFile(name, content);
      logInfo('export', '已写入文件', { path, bytes: content.length });
      return { ok: true, cancelled: false, path, error: null };
    } catch (cause: unknown) {
      const message = nativeErrorMessage(cause);
      logWarn('export', '写入文件失败', { name, message });
      return { ok: false, cancelled: false, path: null, error: message };
    }
  }
  try {
    downloadInBrowser(name, content, options.mime);
    logInfo('export', '已交给浏览器下载', { name, bytes: content.length });
    return { ok: true, cancelled: false, path: null, error: null };
  } catch (cause: unknown) {
    const message = nativeErrorMessage(cause);
    logWarn('export', '浏览器下载失败', { name, message });
    return { ok: false, cancelled: false, path: null, error: message };
  }
}

/** 浏览器下载：生成 Blob 并触发一次 a[download]。 */
export function downloadInBrowser(
  name: string,
  content: string | Uint8Array,
  type = 'text/plain',
): void {
  const part: BlobPart = typeof content === 'string' ? content : new Uint8Array(content).buffer;
  const url = URL.createObjectURL(new Blob([part], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 保存二进制：桌面端弹系统保存对话框并按 Base64 交原生写盘；浏览器与移动端退回浏览器下载。 */
export async function saveBinaryFile(
  name: string,
  content: Uint8Array,
  options: { filterName?: string; extension?: string } = {},
): Promise<SaveTextResult> {
  const extension = options.extension ?? 'bin';
  if (isDesktopApp()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const chosen = await save({
        defaultPath: name,
        filters: [{ name: options.filterName ?? '文件', extensions: [extension] }],
      });
      if (chosen === null) {
        logInfo('export', '用户取消保存', { name });
        return { ok: false, cancelled: true, path: null, error: null };
      }
      const path = await invokeNative<string>('write_binary_file', {
        path: chosen,
        base64: toBase64Bytes(content),
      });
      if (path === undefined) throw new Error('当前平台不支持写入文件');
      logInfo('export', '已写入二进制文件', { path, bytes: content.length });
      return { ok: true, cancelled: false, path, error: null };
    } catch (cause: unknown) {
      const message = nativeErrorMessage(cause);
      logWarn('export', '写入二进制文件失败', { name, message });
      return { ok: false, cancelled: false, path: null, error: message };
    }
  }
  if (isAndroidApp()) {
    try {
      const path = await writeAndroidFile(name, content);
      logInfo('export', '已写入二进制文件', { path, bytes: content.length });
      return { ok: true, cancelled: false, path, error: null };
    } catch (cause: unknown) {
      const message = nativeErrorMessage(cause);
      logWarn('export', '写入二进制文件失败', { name, message });
      return { ok: false, cancelled: false, path: null, error: message };
    }
  }
  try {
    downloadInBrowser(name, content, 'application/octet-stream');
    logInfo('export', '已交给浏览器下载', { name, bytes: content.length });
    return { ok: true, cancelled: false, path: null, error: null };
  } catch (cause: unknown) {
    const message = nativeErrorMessage(cause);
    logWarn('export', '浏览器下载失败', { name, message });
    return { ok: false, cancelled: false, path: null, error: message };
  }
}
