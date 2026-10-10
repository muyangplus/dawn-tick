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
  onClick?: () => void;
  className?: string;
}

/** 课程块：左侧课程色条 + 以表面色混入课程色的底色，块内文字保持达标对比度。 */
export function CourseCard({
  name,
  color,
  room,
  teacher,
  meta,
  badge,
  onClick,
  className,
}: CourseCardProps) {
  const content = (
    <>
      <span className="flex items-center justify-between gap-1">
        <span className="truncate text-xs font-semibold text-ink">{name}</span>
        {badge}
      </span>
      {meta !== undefined && <span className="tabular truncate text-[11px] text-ink/80">{meta}</span>}
      {(room !== undefined && room !== null) || (teacher !== undefined && teacher !== null) ? (
        <span className="flex items-center gap-1 truncate text-[11px] text-ink/80">
          {room !== undefined && room !== null && (
            <>
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{room}</span>
            </>
          )}
          {teacher !== undefined && teacher !== null && (
            <>
              <User className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{teacher}</span>
            </>
          )}
        </span>
      ) : null}
    </>
  );

  const style = {
    borderLeftColor: color,
    backgroundColor: `color-mix(in srgb, var(--dt-surface) 82%, ${color})`,
  } as const;

  if (onClick === undefined) {
    return (
      <div className={cn('flex flex-col gap-0.5 rounded-sm border-l-4 px-2 py-1.5', className)} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-tap flex-col gap-0.5 rounded-sm border-l-4 px-2 py-1.5 text-left transition-transform',
        'hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
        className,
      )}
      style={style}
    >
      {content}
    </button>
  );
}
