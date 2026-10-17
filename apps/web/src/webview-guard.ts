import { devFeaturesOn } from './dev-features.ts';

/** 桌面端 WebView 禁用网页右键菜单（开发者特性开启时保留），输入框与文本域始终保留。 */
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
