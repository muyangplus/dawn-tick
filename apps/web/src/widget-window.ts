import { canUseWidget } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage } from './lib/native.ts';
import { logInfo, logWarn } from './log.ts';

export { canUseWidget };

/** 显示 Windows 悬浮窗（无边框、置顶、不占任务栏）。 */
export async function showWidget(variant?: string): Promise<boolean> {
  if (!canUseWidget()) return false;
  try {
    await invokeNative('show_widget', { variant: variant ?? null });
    logInfo('widget', '显示悬浮窗', { variant: variant ?? 'bar' });
    return true;
  } catch (cause: unknown) {
    logWarn('widget', '显示悬浮窗失败', { message: nativeErrorMessage(cause) });
    return false;
  }
}

export async function hideWidget(): Promise<void> {
  if (!canUseWidget()) return;
  try {
    await invokeNative('hide_widget');
    logInfo('widget', '隐藏悬浮窗');
  } catch {
    // 窗口不存在时忽略
  }
}

/** 从悬浮窗打开主窗口：还原最小化、前置并聚焦；未在桌面端时忽略。 */
export async function openMainWindow(): Promise<void> {
  if (!canUseWidget()) return;
  try {
    await invokeNative('show_main');
    logInfo('widget', '从悬浮窗打开主窗口');
  } catch (cause: unknown) {
    logWarn('widget', '打开主窗口失败', { message: nativeErrorMessage(cause) });
  }
}
