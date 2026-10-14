import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

/** 同一时刻只允许一个菜单展开：打开自己时收起其它菜单（不含设置页卡片收纳）。 */
const MENU_SELECTOR = 'details[data-action-menu][open]';

export interface MenuItem {
  /** 菜单项文案（中文） */
  label: string;
  onSelect: () => void;
  /** 当前项是否处于禁用状态 */
  disabled?: boolean;
}

export interface ActionMenuProps {
  /** 触发按钮的无障碍标签 */
  label: string;
  icon: LucideIcon;
  /** 触发按钮是否为图标按钮（false 时显示 label 文案） */
  iconOnly?: boolean;
  items: readonly MenuItem[];
  className?: string;
}

/**
 * 顶部一行用的轻量下拉菜单：原生 details/summary，无第三方依赖。
 * 选择任一项后自动收起。
 */
export function ActionMenu({ label, icon: Icon, iconOnly = true, items, className }: ActionMenuProps) {
  const root = useRef<HTMLDetailsElement>(null);

  // 同时只开一个菜单；点到别处也收起（仅作用于本组件渲染的菜单）
  useEffect(() => {
    const closeOthers = (): void => {
      const self = root.current;
      if (self === null || !self.open) return;
      for (const other of document.querySelectorAll<HTMLDetailsElement>(MENU_SELECTOR)) {
        if (other !== self) other.open = false;
      }
    };
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const self = root.current;
      if (self === null || !self.open) return;
      if (event.target instanceof Node && self.contains(event.target)) return;
      self.open = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      const self = root.current;
      if (self === null || !self.open) return;
      if (event.key === 'Escape') self.open = false;
    };
    const self = root.current;
    self?.addEventListener('toggle', closeOthers);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      const self = root.current;
      if (self !== null) self.removeEventListener('toggle', closeOthers);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <details ref={root} data-action-menu className={cn('relative', className)}>
      <summary
        aria-label={label}
        className={cn(
          'inline-flex min-h-tap cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-line bg-surface-muted px-3 text-sm font-medium text-ink',
          'hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
          '[&::-webkit-details-marker]:hidden',
          iconOnly && 'size-tap px-0',
        )}
      >
        <Icon className="size-4" aria-hidden />
        {!iconOnly && label}
      </summary>
      <div
        role="menu"
        aria-label={label}
        className="absolute right-0 z-30 mt-1 flex w-44 flex-col gap-1 rounded-md border border-line bg-surface p-1 shadow-md"
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="flex min-h-tap w-full items-center rounded-sm px-3 text-left text-sm text-ink hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-50"
            onClick={() => {
              if (root.current !== null) root.current.open = false;
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

