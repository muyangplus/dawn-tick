import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

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

  return (
    <details ref={root} className={cn('relative', className)}>
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

