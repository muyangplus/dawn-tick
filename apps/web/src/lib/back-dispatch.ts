import { uiCopy } from '../copy/ui.ts';
import { detectPlatform } from '../platform-detect.ts';
import { logWarn } from '../log.ts';
import { handlePageBack } from './back-stack.ts';
import { busySnapshot, cancelBusy } from './busy.ts';
import { toast } from './toast.ts';

/**
 * Esc / 安卓返回键的统一入口，按这个顺序只做一件事：
 * 1. 有操作进行中：只读的取消，写入的提示不能中断（不再往下传，免得顺手关掉弹窗）；
 * 2. 有弹窗：交给弹窗自己（先退弹窗里的步骤，再关弹窗）；
 * 3. 页面返回栈：设置分组回列表、帮助页回来源、其他页回课表；
 * 4. 都没有：安卓退到后台，桌面与网页不动。
 */

/** 进行中的操作遇到返回：返回 true 表示已处理。 */
export function backOnBusy(): boolean {
  if (busySnapshot() === null) return false;
  const outcome = cancelBusy();
  if (outcome === 'cancelled') toast(uiCopy.back.cancelled);
  else if (outcome === 'locked') toast(uiCopy.back.writing);
  return outcome !== 'idle';
}

function dialogOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[role="dialog"]') !== null;
}

function editableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

/** 捕获阶段：操作进行中先截住 Esc，弹窗看不到它。 */
function onKeyDownCapture(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (backOnBusy()) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

/** 冒泡阶段：弹窗没处理、焦点不在输入框里时，退页面一级。 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (dialogOpen() || editableTarget(event.target)) return;
  if (handlePageBack()) event.preventDefault();
}

/**
 * 安卓返回键：借一次合成的 Esc 走同一条路径（Radix 弹窗靠 Esc 关闭），
 * 没有任何一级处理时退到后台。
 */
function onHardwareBack(minimize: () => void): void {
  if (backOnBusy()) return;
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  if (!event.defaultPrevented) minimize();
}

/** 挂上 Esc 与安卓返回键，返回卸载函数。 */
export function installBackHandlers(): () => void {
  window.addEventListener('keydown', onKeyDownCapture, true);
  window.addEventListener('keydown', onKeyDown);
  let removeNative: (() => void) | null = null;
  let disposed = false;
  if (detectPlatform() === 'capacitor') {
    void import('@capacitor/app')
      .then(async ({ App }) => {
        const handle = await App.addListener('backButton', () => {
          onHardwareBack(() => void App.minimizeApp());
        });
        if (disposed) void handle.remove();
        else removeNative = () => void handle.remove();
      })
      .catch((error: unknown) => {
        logWarn('app', '返回键监听挂载失败', { error: String(error) });
      });
  }
  return () => {
    disposed = true;
    window.removeEventListener('keydown', onKeyDownCapture, true);
    window.removeEventListener('keydown', onKeyDown);
    removeNative?.();
  };
}
