import { toBase64Bytes } from '@dawn-tick/core';
import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 用系统默认浏览器打开链接。
 * 桌面端交给原生命令；Android 交给原生 ACTION_VIEW——WebView 的 window.open 在 Android 11+
 * 会先卡在包可见性判断上，表现为「打开失败」；Web 交给新窗口。应用自身不导航到该地址。
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const platform = detectPlatform();
  if (platform === 'tauri') {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_url', { url });
      logInfo('link', '用默认浏览器打开', { url });
      return true;
    } catch (cause: unknown) {
      logWarn('link', '打开默认浏览器失败', { url, message: describe(cause) });
      return false;
    }
  }
  if (platform === 'capacitor') {
    try {
      if (await openWithSystem(url)) {
        logInfo('link', '交给系统浏览器打开', { url });
        return true;
      }
    } catch (cause: unknown) {
      logWarn('link', '原生打开失败，改用新窗口', { url, message: describe(cause) });
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

/** 安卓侧的原生系统动作插件（打开链接、电池优化白名单）。 */
export interface SystemActionsPlugin {
  openExternal(options: { url: string }): Promise<{ opened: boolean }>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring?: boolean; requested?: boolean }>;
}

async function loadSystemActions(): Promise<SystemActionsPlugin | null> {
  if (detectPlatform() !== 'capacitor') return null;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    return registerPlugin<SystemActionsPlugin>('SystemActions');
  } catch (cause: unknown) {
    logWarn('link', '系统动作插件不可用', { message: describe(cause) });
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
    logWarn('link', '读取电池优化状态失败', { message: describe(cause) });
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
    logWarn('link', '跳转电池优化设置页失败', { message: describe(cause) });
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
    logWarn('link', '复制链接异常', { message: describe(cause) });
    return false;
  }
}

/** 在资源管理器中打开日志目录；返回目录路径，平台不支持时为 null。 */
export async function openLogDirectory(): Promise<string | null> {
  if (detectPlatform() !== 'tauri') return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const dir = await invoke<string>('open_log_dir');
    logInfo('log', '打开日志目录', { dir });
    return dir;
  } catch (cause: unknown) {
    logWarn('log', '打开日志目录失败', { message: describe(cause) });
    return null;
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

/**
 * 保存文本：桌面端弹系统保存对话框并写入用户选定的路径；
 * 浏览器与移动端退回浏览器下载（位置由浏览器决定）。
 */
export async function saveTextFile(
  name: string,
  content: string,
  options: { filterName?: string; extension?: string } = {},
): Promise<SaveTextResult> {
  const extension = options.extension ?? 'txt';
  if (detectPlatform() === 'tauri') {
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
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('write_text_file', { path: chosen, content });
      logInfo('export', '已写入文件', { path, bytes: content.length });
      return { ok: true, cancelled: false, path, error: null };
    } catch (cause: unknown) {
      const message = describe(cause);
      logWarn('export', '写入文件失败', { name, message });
      return { ok: false, cancelled: false, path: null, error: message };
    }
  }
  try {
    downloadInBrowser(name, content);
    logInfo('export', '已交给浏览器下载', { name, bytes: content.length });
    return { ok: true, cancelled: false, path: null, error: null };
  } catch (cause: unknown) {
    const message = describe(cause);
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

/**
 * 保存二进制：桌面端弹系统保存对话框并按 Base64 交给原生写盘；
 * 浏览器与移动端退回浏览器下载。
 */
export async function saveBinaryFile(
  name: string,
  content: Uint8Array,
  options: { filterName?: string; extension?: string } = {},
): Promise<SaveTextResult> {
  const extension = options.extension ?? 'bin';
  if (detectPlatform() === 'tauri') {
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
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('write_binary_file', {
        path: chosen,
        base64: toBase64Bytes(content),
      });
      logInfo('export', '已写入二进制文件', { path, bytes: content.length });
      return { ok: true, cancelled: false, path, error: null };
    } catch (cause: unknown) {
      const message = describe(cause);
      logWarn('export', '写入二进制文件失败', { name, message });
      return { ok: false, cancelled: false, path: null, error: message };
    }
  }
  try {
    downloadInBrowser(name, content, 'application/octet-stream');
    logInfo('export', '已交给浏览器下载', { name, bytes: content.length });
    return { ok: true, cancelled: false, path: null, error: null };
  } catch (cause: unknown) {
    const message = describe(cause);
    logWarn('export', '浏览器下载失败', { name, message });
    return { ok: false, cancelled: false, path: null, error: message };
  }
}
