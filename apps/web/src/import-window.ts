import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';

const URL_KEY = 'dt.import.url';

export function canOpenImportWindow(): boolean {
  return detectPlatform() === 'tauri';
}

export function rememberedImportUrl(): string {
  try {
    return globalThis.localStorage?.getItem(URL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberImportUrl(url: string): void {
  try {
    globalThis.localStorage?.setItem(URL_KEY, url);
  } catch {
    // 本地存储不可用时仅本次生效
  }
}

export async function openImportWindow(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!canOpenImportWindow()) return { ok: false, error: '当前平台不支持内嵌窗口' };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_import_window', { url });
    rememberImportUrl(url);
    logInfo('import-window', '打开教务窗口', { url });
    return { ok: true };
  } catch (cause: unknown) {
    const error = cause instanceof Error ? cause.message : String(cause);
    logWarn('import-window', '打开教务窗口失败', { message: error });
    return { ok: false, error };
  }
}

export async function closeImportWindow(): Promise<void> {
  if (!canOpenImportWindow()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('close_import_window');
  } catch {
    // 窗口已关闭时忽略
  }
}

/** 监听内嵌窗口回传的页面内容，返回取消监听函数。 */
export async function listenImportPayload(handler: (payload: string) => void): Promise<() => void> {
  if (!canOpenImportWindow()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>('import-payload', (event) => handler(event.payload));
}
