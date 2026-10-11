import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';

export function canUseWidget(): boolean {
  return detectPlatform() === 'tauri';
}

/** 显示 Windows 悬浮窗（无边框、置顶、不占任务栏）。 */
export async function showWidget(): Promise<boolean> {
  if (!canUseWidget()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('show_widget');
    logInfo('widget', '显示悬浮窗');
    return true;
  } catch (cause: unknown) {
    logWarn('widget', '显示悬浮窗失败', { message: cause instanceof Error ? cause.message : String(cause) });
    return false;
  }
}

export async function hideWidget(): Promise<void> {
  if (!canUseWidget()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('hide_widget');
    logInfo('widget', '隐藏悬浮窗');
  } catch {
    // 窗口不存在时忽略
  }
}
