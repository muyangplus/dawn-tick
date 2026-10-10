import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', className)}>
      {Icon !== undefined && <Icon className="size-8 text-muted" aria-hidden />}
      <p className="text-sm text-ink">{title}</p>
      {description !== undefined && <p className="max-w-xs text-xs text-muted">{description}</p>}
      {action}
    </div>
  );
}
