import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/button.tsx';

export interface ScanOverlayProps {
  onCancel: () => void;
  title?: string;
  hint?: string;
}

/**
 * 通用扫码覆盖层：相机预览由 Capacitor 插件放在 WebView 后面，这里画一层透明操作区。
 *
 * 挂到 body 的独立容器并临时隐藏 `#root`，否则相机预览会被应用界面挡住；
 * 卸载时原样恢复。组件只在扫码期间渲染。
 */
export function ScanOverlay({ onCancel, title = '扫一扫', hint = '把二维码放入取景框，识别后自动停止' }: ScanOverlayProps) {
  const [host] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.createElement('div'),
  );

  useEffect(() => {
    if (host === null) return;
    host.setAttribute('data-role', 'scan-host');
    document.body.append(host);
    const root = document.getElementById('root');
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      html: html.style.background,
      body: body.style.background,
      root: root?.style.visibility ?? '',
    };
    html.style.background = 'transparent';
    body.style.background = 'transparent';
    if (root !== null) root.style.visibility = 'hidden';
    return () => {
      html.style.background = previous.html;
      body.style.background = previous.body;
      if (root !== null) root.style.visibility = previous.root;
      host.remove();
    };
  }, [host]);

  if (host === null) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-transparent p-4"
      data-role="scan-overlay"
      role="dialog"
      aria-label={title}
      aria-modal="true"
    >
      <div className="mt-10 rounded-md bg-black/60 px-3 py-2 text-sm text-white">{hint}</div>
      <div className="mb-6 flex w-full max-w-xs flex-col items-center gap-2 rounded-md bg-black/60 p-3">
        <span className="text-center text-xs text-white">扫到第一条内容会自动停止</span>
        <Button size="sm" variant="secondary" aria-label="取消扫码" onClick={onCancel}>
          取消扫码
        </Button>
      </div>
    </div>,
    host,
  );
}
