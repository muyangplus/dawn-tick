import { devFeaturesOn } from './dev-features.ts';

/**
 * 桌面端 WebView 体验约束：禁用网页右键菜单（开发时保留，便于检查元素）。
 * dev 渠道关掉开发者特性后同样禁用，与正式版一致。
 */
export function installWebviewGuards(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'contextmenu',
    (event) => {
      if (devFeaturesOn()) return;
      const target = event.target;
      // 输入框与文本域保留系统菜单，方便复制粘贴
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
    },
    { capture: true },
  );
}
