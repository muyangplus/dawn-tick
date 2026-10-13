import type { ReactNode } from 'react';
import type { WidgetBackground, WidgetVariant } from '@dawn-tick/core';

export interface MiniShellProps {
  variant: WidgetVariant;
  onHide: () => void;
  /** 顶部左侧文案，默认应用名；上课中传「正在上课」 */
  label?: string | undefined;
  /** 小组件背景设置：浅色 / 深色 / 透明 */
  background?: WidgetBackground;
  children: ReactNode;
}

/**
 * 悬浮窗外壳。
 * `data-tauri-drag-region="deep"` 让整窗（含文字节点）都能按住拖动；
 * 按钮等可点元素自身仍按普通点击处理，不触发拖动。
 * 背景按设置里的「小组件背景」切换，与 Android 小组件的三种底色同一口径。
 */
export function MiniShell({
  variant,
  onHide,
  label = '晓刻 DawnTick',
  background = 'light',
  children,
}: MiniShellProps) {  return (
    <main
      className={`mini mini-${variant} mini-bg-${background}`}
      data-tauri-drag-region="deep"
      data-background={background}
    >
      <div className="mini-head">
        <span className="mini-label">{label}</span>
        <button type="button" className="mini-close" onClick={onHide} title="隐藏">
          ×
        </button>
      </div>
      <div className="mini-body">{children}</div>
    </main>
  );
}
