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
  /** tone：solid 本周正常；ghost 非本周；holiday 放假；cancelled 当天停课；movedOut 已调走。 */
  tone?: 'solid' | 'ghost' | 'holiday' | 'cancelled' | 'movedOut';
  /** tone="holiday" 时卡片标签上的文案，默认「放假」；多天假期第一天传节次 */
  holidayLabel?: string;
  /** 兼容旧调用：等价于 tone="ghost" */
  dashed?: boolean;
  /** 读屏播报用的完整描述（星期、节次、课程名、周次、地点）；不传则按卡片正文播报 */
  ariaLabel?: string;
  onClick?: () => void;
  className?: string;
}

/** 底色为表面色混课程色，左侧内阴影色条标课程色；宽度由外层决定，文字换行不截断。 */
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
  ariaLabel,
  onClick,
  className,
}: CourseCardProps) {
  const resolvedTone = tone ?? (dashed ? 'ghost' : 'solid');
  const label =
    badge ??
    (resolvedTone === 'ghost' ? (
      <span className="inline-block rounded-sm bg-surface px-1 text-[10px] text-muted">非本周</span>
    ) : resolvedTone === 'cancelled' ? (
      <span
        className="inline-block rounded-sm bg-surface px-1 text-[10px] text-muted"
        data-role="cancelled-label"
      >
        停课
      </span>
    ) : resolvedTone === 'movedOut' ? (
      <span className="inline-block rounded-sm bg-surface px-1 text-[10px] text-muted" data-role="moved-out-label">
        已调课
      </span>
    ) : resolvedTone === 'holiday' ? (
      // 假期名称完整显示，长名称换行，不省略
      <span className="inline-block rounded-sm bg-surface px-1 text-[10px] text-muted" data-role="holiday-label">
        {holidayLabel ?? '放假'}
      </span>
    ) : undefined);
  const content = (
    <>
      {/* 标签跟在课程名后面：列窄时名字先占满整行、标签自己折到下一行，不会被挤成一竖列 */}
      <span className="w-full min-w-0 whitespace-normal break-words text-[10px] font-semibold text-ink [overflow-wrap:anywhere] tablet:text-xs">
        {name}
        {label !== undefined && <> {label}</>}
      </span>
      {meta !== undefined && (
        <span className="tabular w-full whitespace-normal break-words text-[9px] text-ink/80 [overflow-wrap:anywhere] tablet:text-[11px]">
          {meta}
        </span>
      )}
      {room !== undefined && room !== null && (
        <span className="flex w-full min-w-0 items-start gap-1 text-[9px] text-ink/80 tablet:text-[11px]">
          <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span data-field="room" className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
            {room}
          </span>
        </span>
      )}
      {teacher !== undefined && teacher !== null && (
        <span className="flex w-full min-w-0 items-start gap-1 text-[9px] text-ink/80 tablet:text-[11px]">
          <User className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span data-field="teacher" className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
            {teacher}
          </span>
        </span>
      )}
    </>
  );

  // 不画边框：靠底色区分课程，左侧用内阴影色条保留课程色
  const accent =
    resolvedTone === 'holiday' || resolvedTone === 'cancelled' || resolvedTone === 'movedOut'
      ? 'var(--dt-muted)'
      : color;
  const style = {
    backgroundColor:
      resolvedTone === 'holiday' || resolvedTone === 'cancelled' || resolvedTone === 'movedOut'
        ? 'color-mix(in srgb, var(--dt-surface) 94%, var(--dt-muted))'
        : resolvedTone === 'ghost'
          ? `color-mix(in srgb, var(--dt-surface) 97%, ${color})`
          : `color-mix(in srgb, var(--dt-surface) 80%, ${color})`,
    boxShadow: `inset 3px 0 0 0 ${accent}`,
  } as const;

  const base = 'flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-sm px-1.5 py-1 tablet:px-2';
  const toneClass =
    resolvedTone === 'ghost'
      ? 'text-muted opacity-55'
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
        role={ariaLabel === undefined ? undefined : 'group'}
        aria-label={ariaLabel}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
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
