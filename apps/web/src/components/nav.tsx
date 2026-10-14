import { CalendarDays, ListChecks, Settings, Sun, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn.ts';

export type NavId = 'timetable' | 'schedule' | 'settings' | 'mine';

export interface NavItem {
  id: NavId;
  label: string;
  icon: LucideIcon;
}

/** 导入已并入设置；「我的」排在设置后面。 */
export const DESKTOP_NAV: readonly NavItem[] = [
  { id: 'timetable', label: '课表', icon: CalendarDays },
  { id: 'schedule', label: '日程', icon: ListChecks },
  { id: 'settings', label: '设置', icon: Settings },
  { id: 'mine', label: '我的', icon: UserRound },
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
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold text-ink">{appName}</span>
        <span className="text-xs text-muted">{subtitle}</span>
      </div>
      <nav className="flex flex-col gap-1" aria-label="主导航">
        {DESKTOP_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === current;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active}
              onClick={() => onSelect(item.id)}
              className={cn(
                'flex min-h-tap items-center gap-3 rounded-md px-3 text-sm',
                active ? 'bg-surface-muted font-medium text-primary-strong' : 'text-ink hover:bg-surface-muted',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center gap-1 text-xs text-muted">
        <Sun className="size-3" aria-hidden />
        快捷键 ← → 切周，T 回今天，/ 搜索
      </div>
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
