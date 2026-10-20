import type { ReactNode } from 'react';
import type { WidgetBackground, WidgetVariant } from '@dawn-tick/core';

export interface MiniShellProps {
  variant: WidgetVariant;
  onHide: () => void;
  /** 双击整窗或点标题栏「打开」时打开主窗口；不传则不提供打开入口。 */
  onOpen?: (() => void) | undefined;
  /** 顶部左侧文案，默认应用名；上课中传「正在上课」 */
  label?: string | undefined;
  /** 小组件背景设置：浅色 / 深色 / 透明 */
  background?: WidgetBackground;
  children: ReactNode;
}

/**
 * 悬浮窗外壳：`data-tauri-drag-region="deep"` 让整窗（含文字）可拖动；
 * 双击整窗或点标题栏「打开」打开主窗口，关闭按钮仍只隐藏。
 * 底色与 Android 小组件三态同口径。
 */
export function MiniShell({
  variant,
  onHide,
  onOpen,
  label = '晓刻 DawnTick',
  background = 'light',
  children,
}: MiniShellProps) {
  return (
    <main
      className={`mini mini-${variant} mini-bg-${background}`}
      data-tauri-drag-region="deep"
      data-background={background}
      onDoubleClick={onOpen}
    >
      <div className="mini-head">
        <span className="mini-label">{label}</span>
        {/* 按钮区拦下双击，避免双击关闭/打开按钮时又冒泡到整窗的「打开主窗口」 */}
        <div className="mini-actions" onDoubleClick={(event) => event.stopPropagation()}>
          {onOpen !== undefined && (
            <button type="button" className="mini-open" data-role="mini-open" onClick={onOpen} title="打开主窗口">
              打开
            </button>
          )}
          <button type="button" className="mini-close" onClick={onHide} title="隐藏">
            ×
          </button>
        </div>
      </div>
      <div className="mini-body">{children}</div>
    </main>
  );
}
