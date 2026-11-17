import { canUseWidget } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage, type WidgetLayout } from './lib/native.ts';
import { logInfo, logWarn } from './log.ts';

export { canUseWidget };
export type { WidgetLayout };

/**
 * 悬浮窗尺寸的 Web 侧接线（I-07）。
 *
 * - `measureWidget`：按内容行数让原生定高（不写记忆）；
 * - `rememberWidgetSize`：用户手动拉伸后把尺寸写进记忆；
 * - `watchWidgetResize`：监听窗口尺寸事件，200ms 防抖后记忆。
 *
 * 原生调整尺寸同样会触发窗口尺寸事件，所以这里用 `appliedSize` 记住自己刚应用的尺寸、
 * 并在一小段时间内忽略事件，避免「按内容定高 → 事件回灌 → 被记为手动尺寸」的死循环。
 */

/** 最近一次由 measure / resize 实际应用的尺寸（逻辑像素）。 */
let appliedSize: { width: number; height: number } | null = null;

/** 程序调整尺寸后短暂忽略窗口事件，等原生的回执落到 `appliedSize`。 */
let suppressResizeUntil = 0;
const RESIZE_SUPPRESS_MS = 600;

/** 用户拖动结束后等这么久再记忆，避免拖拽过程中每一步都写库。 */
const RESIZE_DEBOUNCE_MS = 200;

/** 尺寸比较容差（逻辑像素）：亚像素取整差异不算用户拉伸。 */
const SIZE_TOLERANCE = 1.5;

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

/**
 * 按内容让悬浮窗定高：行数按实际渲染条目算，minimal 不需要行数（传 undefined）。
 *
 * 返回原生实际应用的尺寸；平台不支持或失败返回 null（调用方保持原尺寸）。
 */
export async function measureWidget(
  variant: string,
  contentRows?: number,
): Promise<WidgetLayout | null> {
  if (!canUseWidget()) return null;
  suppressResizeUntil = Date.now() + RESIZE_SUPPRESS_MS;
  try {
    const layout = await invokeNative<WidgetLayout>('widget_measure', {
      variant,
      contentRows: contentRows ?? null,
    });
    if (layout === undefined) return null;
    appliedSize = { width: layout.width, height: layout.height };
    logInfo('widget', '悬浮窗已按内容定高', {
      variant,
      rows: contentRows ?? null,
      width: layout.width,
      height: layout.height,
      source: layout.source,
    });
    return layout;
  } catch (cause: unknown) {
    logWarn('widget', '悬浮窗按内容定高失败', { message: nativeErrorMessage(cause) });
    return null;
  }
}

/**
 * 记住用户拉伸后的悬浮窗尺寸：原生夹取后应用并写入 `app_meta`。
 *
 * 返回实际应用的尺寸；平台不支持或失败返回 null。
 */
export async function rememberWidgetSize(
  variant: string,
  width: number,
  height: number,
): Promise<WidgetLayout | null> {
  if (!canUseWidget()) return null;
  suppressResizeUntil = Date.now() + RESIZE_SUPPRESS_MS;
  try {
    const layout = await invokeNative<WidgetLayout>('widget_resize', { variant, width, height });
    if (layout === undefined) return null;
    appliedSize = { width: layout.width, height: layout.height };
    logInfo('widget', '已记住悬浮窗尺寸', {
      variant,
      width: layout.width,
      height: layout.height,
      source: layout.source,
    });
    return layout;
  } catch (cause: unknown) {
    logWarn('widget', '记住悬浮窗尺寸失败', { message: nativeErrorMessage(cause) });
    return null;
  }
}

/**
 * 监听悬浮窗尺寸变化（用户拖动边框），200ms 防抖后调 `widget_resize` 记忆。
 *
 * 返回取消监听的函数；非桌面端返回空函数。尺寸事件给的是物理像素，按窗口缩放换算成逻辑像素。
 */
export function watchWidgetResize(variant: string): () => void {
  if (!canUseWidget()) return () => {};
  let disposed = false;
  let stop: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 最近一次事件的物理尺寸，等防抖结束再换算、记忆 */
  let pending: { width: number; height: number } | null = null;

  const flush = (): void => {
    timer = null;
    const physical = pending;
    pending = null;
    if (physical === null || disposed) return;
    // 自己调用 measure / resize 引起的事件：等回执把 appliedSize 更新完再恢复监听
    if (Date.now() < suppressResizeUntil) return;
    void (async () => {
      let scale = 1;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        scale = await getCurrentWindow().scaleFactor();
      } catch {
        // 取不到缩放就按 1:1 处理，尺寸可能偏大但不会崩
      }
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;
      const width = physical.width / scale;
      const height = physical.height / scale;
      if (
        appliedSize !== null &&
        Math.abs(width - appliedSize.width) < SIZE_TOLERANCE &&
        Math.abs(height - appliedSize.height) < SIZE_TOLERANCE
      ) {
        return;
      }
      await rememberWidgetSize(variant, width, height);
    })();
  };

  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const window_ = getCurrentWindow();
      const off = await window_.onResized(({ payload }) => {
        if (disposed) return;
        pending = { width: payload.width, height: payload.height };
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(flush, RESIZE_DEBOUNCE_MS);
      });
      if (disposed) off();
      else stop = off;
    } catch (cause: unknown) {
      logWarn('widget', '监听悬浮窗尺寸失败', { message: nativeErrorMessage(cause) });
    }
  })();

  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    stop?.();
    stop = null;
  };
}
