import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';
import type { SchoolEntry } from '@dawn-tick/core';

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

const SCHOOLS_KEY = 'dt.import.schools';

/** 本地保存的学校，与内置列表合并后使用。 */
export function loadCustomSchools(): SchoolEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(SCHOOLS_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SchoolEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SchoolEntry).id === 'string' &&
        typeof (item as SchoolEntry).name === 'string',
    );
  } catch {
    return [];
  }
}

export function saveCustomSchool(school: SchoolEntry): SchoolEntry[] {
  const next = [
    ...loadCustomSchools().filter((item) => item.id !== school.id),
    { ...school, source: 'user' as const },
  ];
  try {
    globalThis.localStorage?.setItem(SCHOOLS_KEY, JSON.stringify(next));
  } catch {
    // 本地存储不可用时仅本次生效
  }
  return next;
}
