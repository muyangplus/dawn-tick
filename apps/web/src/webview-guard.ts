/**
 * 桌面端 WebView 体验约束。
 * 非 dev 渠道禁用网页右键菜单（开发时保留，便于检查元素）。
 */
export function installWebviewGuards(): void {
  if (__DT_CHANNEL__ === 'dev') return;
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'contextmenu',
    (event) => {
      const target = event.target;
      // 输入框与文本域保留系统菜单，方便复制粘贴
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
    },
    { capture: true },
  );
}
