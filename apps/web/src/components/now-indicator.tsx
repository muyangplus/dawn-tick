import { cn } from '../lib/cn.ts';

export interface NowIndicatorProps {
  ratio: number;
  className?: string;
  label?: string;
}

/** 当前时间指示线；ratio 为在课表纵向范围内的比例。 */
export function NowIndicator({ ratio, className, label }: NowIndicatorProps) {
  return (
    <div
      className={cn('pointer-events-none absolute inset-x-0 z-10 flex items-center', className)}
      style={{ top: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
      aria-hidden
    >
      <span className="size-2 rounded-full bg-danger" />
      <span className="h-px flex-1 bg-danger" />
      {label !== undefined && <span className="px-1 text-[10px] text-danger-strong">{label}</span>}
    </div>
  );
}
