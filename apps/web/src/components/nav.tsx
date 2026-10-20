import { useState } from 'react';
import {
  CalendarDays,
  ListChecks,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { isCollapsed, rememberCollapsed } from '../lib/collapse-store.ts';

export type NavId = 'timetable' | 'schedule' | 'settings' | 'devices';

export interface NavItem {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

/** 导入已并入设置；「设备与同步」排在设置后面，承载存储、同步、更新与关于。 */
export const DESKTOP_NAV: readonly NavItem[] = [
  { id: 'timetable', label: '课表', icon: CalendarDays },
  { id: 'schedule', label: '日程', icon: ListChecks },
  { id: 'settings', label: '设置', icon: Settings },
  { id: 'devices', label: '设备与同步', icon: MonitorSmartphone },
];

export const MOBILE_NAV: readonly NavItem[] = DESKTOP_NAV;

export function AppSidebar({
  current,
  onSelect,
  appName,
  subtitle,
}: {
  current: NavId;
  onSelect: (id: NavId) => void;
  appName: string;
  subtitle: string;
}) {
  // 折叠状态按设备记在本地，不进数据库与同步
  const [collapsed, setCollapsed] = useState(() => isCollapsed('sidebar'));
  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    rememberCollapsed('sidebar', next);
  };
  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col gap-4 border-r border-line bg-surface p-2 transition-[width] duration-150',
        collapsed ? 'w-16 items-center' : 'w-60 p-4',
      )}
      data-role="app-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className={cn('flex w-full items-center gap-2', collapsed && 'flex-col')}>
        {!collapsed && (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-base font-semibold text-ink">{appName}</span>
            <span className="truncate text-xs text-muted">{subtitle}</span>
          </div>
        )}
        <button
          type="button"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={!collapsed}
          onClick={toggle}
          className="flex size-tap shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-muted"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </button>
      </div>
      <nav className={cn('flex w-full flex-col gap-1', collapsed && 'items-center')} aria-label="主导航">
        {DESKTOP_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === current;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active}
              aria-label={collapsed ? item.label : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                'flex min-h-tap items-center gap-3 rounded-md px-3 text-sm',
                collapsed && 'w-11 justify-center px-0',
                active ? 'bg-surface-muted font-medium text-primary-strong' : 'text-ink hover:bg-surface-muted',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>
      {!collapsed && (
        <div className="mt-auto flex items-center gap-1 text-xs text-muted">
          <Sun className="size-3" aria-hidden />
          快捷键：/ 搜索 · ← → 平移一屏 · T 回到今天
        </div>
      )}
    </aside>
  );
}

export function BottomNav({ current, onSelect }: { current: NavId; onSelect: (id: NavId) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--dt-bottom-nav)+env(safe-area-inset-bottom))] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      aria-label="主导航"
      data-role="bottom-nav"
    >
      {MOBILE_NAV.map((item) => {
        const Icon = item.icon;
        const active = item.id === current;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active}
            onClick={() => onSelect(item.id)}
            className={cn(
              'flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px]',
              active ? 'text-primary-strong' : 'text-muted',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
