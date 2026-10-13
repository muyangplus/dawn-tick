import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 用系统默认浏览器打开链接。
 * 桌面端交给原生命令，Web 与 Android 交给新窗口，应用自身不导航到该地址。
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (detectPlatform() === 'tauri') {
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
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened === null) {
    logWarn('link', '新窗口被拦截', { url });
    return false;
  }
  logInfo('link', '在新窗口打开', { url });
  return true;
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
