import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export type EmptyStateSize = 'sm' | 'md' | 'lg';
export type EmptyStateTone = 'default' | 'muted' | 'danger';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** 默认 md 保持原有留白；卡片内嵌用 sm，整页空态用 lg */
  size?: EmptyStateSize;
  /** 语气：默认中性，muted 弱化，danger 用于失败/不可用 */
  tone?: EmptyStateTone;
}

const SIZE_CLASS: Record<EmptyStateSize, { wrap: string; icon: string; title: string; description: string }> = {
  sm: { wrap: 'gap-1 py-4', icon: 'size-6', title: 'text-xs', description: 'text-[11px]' },
  md: { wrap: 'gap-2 py-12', icon: 'size-8', title: 'text-sm', description: 'text-xs' },
  lg: { wrap: 'gap-3 py-16', icon: 'size-10', title: 'text-base', description: 'text-sm' },
};

const TONE_CLASS: Record<EmptyStateTone, { icon: string; title: string }> = {
  default: { icon: 'text-muted', title: 'text-ink' },
  muted: { icon: 'text-muted', title: 'text-muted' },
  danger: { icon: 'text-danger-strong', title: 'text-danger-strong' },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'md',
  tone = 'default',
  className,
  ...props
}: EmptyStateProps) {
  const sizeClass = SIZE_CLASS[size];
  const toneClass = TONE_CLASS[tone];
  return (
    <div
      className={cn('flex flex-col items-center justify-center text-center', sizeClass.wrap, className)}
      {...props}
    >
      {Icon !== undefined && <Icon className={cn(sizeClass.icon, toneClass.icon)} aria-hidden />}
      <p className={cn(sizeClass.title, toneClass.title)}>{title}</p>
      {description !== undefined && (
        <p className={cn('max-w-xs text-muted', sizeClass.description)}>{description}</p>
      )}
      {action}
    </div>
  );
}
