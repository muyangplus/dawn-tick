import type { WidgetBackground, WidgetVariant } from '@dawn-tick/core';

/**
 * 悬浮窗外壳类名：`mini-bg-*` 决定「浅色 / 深色 / 透明」覆盖（配色见 styles.css），
 * `mini-*` 是样式变体。抽成纯函数，便于单测类名与设置值一一对应。
 */
export function miniShellClassName(variant: WidgetVariant, background: WidgetBackground): string {
  return `mini mini-${variant} mini-bg-${background}`;
}
