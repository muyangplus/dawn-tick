import type { ReactNode } from 'react';
import type { WidgetVariant } from '@dawn-tick/core';

export interface MiniShellProps {
  variant: WidgetVariant;
  onHide: () => void;
  children: ReactNode;
}

/**
 * 悬浮窗外壳。
 * `data-tauri-drag-region="deep"` 让整窗（含文字节点）都能按住拖动；
 * 按钮等可点元素自身仍按普通点击处理，不触发拖动。
 */
export function MiniShell({ variant, onHide, children }: MiniShellProps) {
  return (
    <main className={`mini mini-${variant}`} data-tauri-drag-region="deep">
      <div className="mini-head">
        <span className="mini-label">晓刻 DawnTick</span>
        <button type="button" className="mini-close" onClick={onHide} title="隐藏">
          ×
        </button>
      </div>
      <div className="mini-body">{children}</div>
    </main>
  );
}
