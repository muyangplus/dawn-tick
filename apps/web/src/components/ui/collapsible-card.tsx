import { useState, type ReactNode } from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Card } from './card.tsx';
import { cn } from '../../lib/cn.ts';
import { isCollapsed, rememberCollapsed } from '../../lib/collapse-store.ts';

export interface CollapsibleCardProps {
  /** 收起状态在本地按该标识记住 */
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
}

export interface SectionCardProps {
  title: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
}

/** 卡内分段标题：不可折叠，用于替代「卡里再套折叠卡」的两级结构。 */
export function SectionCard({ title, icon: Icon, badge, children }: SectionCardProps) {
  return (
    <Card className="p-0">
      <div className="flex min-h-tap w-full items-center gap-2 px-4 py-3">
        {Icon !== undefined && <Icon className="size-4 text-ink" aria-hidden />}
        <span className="text-sm font-semibold text-ink">{title}</span>
        {badge !== undefined && <span className="text-xs font-normal text-muted">{badge}</span>}
      </div>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{children}</div>
    </Card>
  );
}

export function CollapsibleCard({ id, title, icon: Icon, badge, children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(() => !isCollapsed(id));

  return (
    <Card className="p-0">
      <CollapsiblePrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          rememberCollapsed(id, !next);
        }}
      >
        <CollapsiblePrimitive.Trigger
          aria-label={`${title}${open ? '：收起' : '：展开'}`}
          className="dt-nav-item flex min-h-tap w-full items-center gap-2 rounded-lg px-4 py-3 text-left hover:bg-surface-muted"
        >
          {Icon !== undefined && <Icon className="size-4 text-ink" aria-hidden />}
          <span className="text-sm font-semibold text-ink">{title}</span>
          {badge !== undefined && <span className="text-xs font-normal text-muted">{badge}</span>}
          <ChevronDown
            className={cn('dt-chevron ml-auto size-4 shrink-0 text-muted', open && 'rotate-180')}
            aria-hidden
          />
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Content className="dt-collapse" hidden={!open}>
          <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{children}</div>
        </CollapsiblePrimitive.Content>
      </CollapsiblePrimitive.Root>
    </Card>
  );
}
