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
  /** 非本周课程：虚线框显示 */
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
  dashed = false,
  onClick,
  className,
}: CourseCardProps) {
  const content = (
    <>
      <span className="flex w-full min-w-0 items-center justify-between gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{name}</span>
        {badge}
      </span>
      {meta !== undefined && <span className="tabular w-full truncate text-[11px] text-ink/80">{meta}</span>}
      {(room !== undefined && room !== null) || (teacher !== undefined && teacher !== null) ? (
        <span className="flex w-full min-w-0 items-center gap-1 text-[11px] text-ink/80">
          {room !== undefined && room !== null && (
            <>
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{room}</span>
            </>
          )}
          {teacher !== undefined && teacher !== null && (
            <>
              <User className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{teacher}</span>
            </>
          )}
        </span>
      ) : null}
    </>
  );

  const style = {
    borderLeftColor: color,
    backgroundColor: `color-mix(in srgb, var(--dt-surface) 82%, ${color})`,
    ...(dashed ? { borderWidth: '1px', borderStyle: 'dashed', borderLeftWidth: '4px' } : {}),
  } as const;

  const base = 'flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-sm border-l-4 px-2 py-1.5';
  const dashedClass = dashed ? 'border-line-strong' : '';

  if (onClick === undefined) {
    return (
      <div className={cn(base, dashedClass, className)} style={style} data-dashed={dashed ? 'true' : undefined}>
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
        dashedClass,
        className,
      )}
      style={style}
      data-dashed={dashed ? 'true' : undefined}
    >
      {content}
    </button>
  );
}
