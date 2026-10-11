import { MapPin, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export interface CourseCardProps {
  name: string;
  color: string;
  room?: string | null;
  teacher?: string | null;
  meta?: string;
  badge?: ReactNode;
  /**
   * solid：本周正常课；ghost：非本周课程（虚线框 + 更浅底色）；
   * holiday：放假日课（灰显）。
   */
  tone?: 'solid' | 'ghost' | 'holiday';
  /** 兼容旧调用：等价于 tone="ghost" */
  dashed?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * 课程块：左侧课程色条 + 以表面色混入课程色的底色，块内文字保持达标对比度。
 * 宽度统一由外层决定，内部一律 min-w-0 + truncate，长课名不会把卡片撑宽。
 */
export function CourseCard({
  name,
  color,
  room,
  teacher,
  meta,
  badge,
  tone,
  dashed = false,
  onClick,
  className,
}: CourseCardProps) {
  const resolvedTone = tone ?? (dashed ? 'ghost' : 'solid');
  const label =
    badge ??
    (resolvedTone === 'ghost' ? (
      <span className="shrink-0 rounded-sm bg-surface px-1 text-[10px] text-muted">非本周</span>
    ) : resolvedTone === 'holiday' ? (
      <span className="shrink-0 rounded-sm bg-surface px-1 text-[10px] text-muted">放假</span>
    ) : undefined);
  const content = (
    <>
      <span className="flex w-full min-w-0 items-start justify-between gap-1">
        <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs font-semibold text-ink">{name}</span>
        {label}
      </span>
      {meta !== undefined && <span className="tabular w-full text-[11px] text-ink/80">{meta}</span>}
      {room !== undefined && room !== null && (
        <span className="flex w-full min-w-0 items-start gap-1 text-[11px] text-ink/80">
          <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span data-field="room" className="line-clamp-2 min-w-0 flex-1 break-words">
            {room}
          </span>
        </span>
      )}
      {teacher !== undefined && teacher !== null && (
        <span className="flex w-full min-w-0 items-start gap-1 text-[11px] text-ink/80">
          <User className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span data-field="teacher" className="line-clamp-2 min-w-0 flex-1 break-words">
            {teacher}
          </span>
        </span>
      )}
    </>
  );

  const style = {
    borderLeftColor: resolvedTone === 'holiday' ? 'var(--dt-muted)' : color,
    backgroundColor:
      resolvedTone === 'holiday'
        ? 'color-mix(in srgb, var(--dt-surface) 88%, var(--dt-muted))'
        : resolvedTone === 'ghost'
          ? `color-mix(in srgb, var(--dt-surface) 93%, ${color})`
          : `color-mix(in srgb, var(--dt-surface) 82%, ${color})`,
    ...(resolvedTone === 'ghost' ? { borderWidth: '1px', borderStyle: 'dashed', borderLeftWidth: '4px' } : {}),
  } as const;

  const base = 'flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-sm border-l-4 px-2 py-1.5';
  const toneClass =
    resolvedTone === 'ghost' ? 'border-line-strong opacity-70' : resolvedTone === 'holiday' ? 'opacity-60' : '';

  if (onClick === undefined) {
    return (
      <div
        className={cn(base, toneClass, className)}
        style={style}
        data-tone={resolvedTone}
        data-dashed={resolvedTone === 'ghost' ? 'true' : undefined}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        'min-h-tap text-left transition-transform',
        'hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
        toneClass,
        className,
      )}
      style={style}
      data-tone={resolvedTone}
      data-dashed={resolvedTone === 'ghost' ? 'true' : undefined}
    >
      {content}
    </button>
  );
}
