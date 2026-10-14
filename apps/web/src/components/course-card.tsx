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
   * holiday：放假日课（灰显）；cancelled：当天停课；movedOut：这节课调走了。
   */
  tone?: 'solid' | 'ghost' | 'holiday' | 'cancelled' | 'movedOut';
  /** tone="holiday" 时卡片标签上的文案，默认「放假」；多天假期第一天传节次 */
  holidayLabel?: string;
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
  holidayLabel,
  dashed = false,
  onClick,
  className,
}: CourseCardProps) {
  const resolvedTone = tone ?? (dashed ? 'ghost' : 'solid');
  const label =
    badge ??
    (resolvedTone === 'ghost' ? (
      <span className="shrink-0 rounded-sm bg-surface px-1 text-[10px] text-muted">非本周</span>
    ) : resolvedTone === 'cancelled' ? (
      <span
        className="shrink-0 rounded-sm bg-surface px-1 text-[10px] text-muted"
        data-role="cancelled-label"
      >
        停课
      </span>
    ) : resolvedTone === 'movedOut' ? (
      <span className="shrink-0 rounded-sm bg-surface px-1 text-[10px] text-muted" data-role="moved-out-label">
        已调课
      </span>
    ) : resolvedTone === 'holiday' ? (
      // 假期名称可能较长（如「国庆节」），限制宽度并省略，避免挤掉课程名
      <span
        className="max-w-[65%] shrink-0 truncate rounded-sm bg-surface px-1 text-[10px] text-muted"
        data-role="holiday-label"
      >
        {holidayLabel ?? '放假'}
      </span>
    ) : undefined);
  const content = (
    <>
      <span className="flex w-full min-w-0 items-start justify-between gap-1">
        <span className="line-clamp-2 min-w-0 flex-1 break-words text-[10px] font-semibold text-ink tablet:text-xs">
          {name}
        </span>
        {label}
      </span>
      {meta !== undefined && (
        <span className="tabular w-full truncate text-[9px] text-ink/80 tablet:text-[11px]">{meta}</span>
      )}
      {room !== undefined && room !== null && (
        <span className="flex w-full min-w-0 items-start gap-1 text-[9px] text-ink/80 tablet:text-[11px]">
          <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span data-field="room" className="line-clamp-2 min-w-0 flex-1 break-words">
            {room}
          </span>
        </span>
      )}
      {teacher !== undefined && teacher !== null && (
        <span className="flex w-full min-w-0 items-start gap-1 text-[9px] text-ink/80 tablet:text-[11px]">
          <User className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span data-field="teacher" className="line-clamp-2 min-w-0 flex-1 break-words">
            {teacher}
          </span>
        </span>
      )}
    </>
  );

  const style = {
    borderLeftColor:
      resolvedTone === 'holiday' || resolvedTone === 'cancelled' || resolvedTone === 'movedOut'
        ? 'var(--dt-muted)'
        : color,
    backgroundColor:
      resolvedTone === 'holiday' || resolvedTone === 'cancelled' || resolvedTone === 'movedOut'
        ? 'color-mix(in srgb, var(--dt-surface) 94%, var(--dt-muted))'
        : resolvedTone === 'ghost'
          ? `color-mix(in srgb, var(--dt-surface) 97%, ${color})`
          : `color-mix(in srgb, var(--dt-surface) 82%, ${color})`,
    // 放假优先于非本周：即使两种状态同时成立，也只按放假灰显，不出现非本周的虚线框
    ...(resolvedTone === 'ghost'
      ? { borderWidth: '1px', borderStyle: 'dashed' as const, borderLeftWidth: '4px' }
      : { borderStyle: 'solid' as const }),
  } as const;

  const base = 'flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-sm border-l-4 px-1.5 py-1.5 tablet:px-2';
  const toneClass =
    resolvedTone === 'ghost'
      ? 'border-line-strong text-muted opacity-55'
      : resolvedTone === 'holiday' || resolvedTone === 'cancelled' || resolvedTone === 'movedOut'
        ? 'opacity-45'
        : '';

  if (onClick === undefined) {
    return (
      <div
        className={cn(base, toneClass, className)}
        style={style}
        data-tone={resolvedTone}
        data-role="course-card"
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
      data-role="course-card"
      data-dashed={resolvedTone === 'ghost' ? 'true' : undefined}
    >
      {content}
    </button>
  );
}
