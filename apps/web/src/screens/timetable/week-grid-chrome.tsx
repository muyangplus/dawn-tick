import { dayOfWeek as nextDayOfWeek, WEEKDAY_LABELS } from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import { cn } from '../../lib/cn.ts';
import { formatMonthDayRange } from '../../lib/dates.ts';
import { padLabel, type GridMetrics, type GridSlot } from '../../lib/grid-metrics.ts';
import { weekCopy } from '../../copy/timetable-week.ts';

/** 表头行：节次列 + 每列的星期、日期、今天/放假标记。 */
export function WeekHeaderRow({ data }: { data: AppData }) {
  return (
    <div
      className="grid border-b border-line"
      style={{ gridTemplateColumns: `var(--dt-axis) repeat(${data.windowDates.length}, minmax(0, 1fr))` }}
    >
      <div className="px-2 py-2 text-center text-xs text-muted">{weekCopy.periodColumn}</div>
      {data.windowDates.map((date) => {
        const label = WEEKDAY_LABELS[nextDayOfWeek(date) - 1] ?? '';
        const isToday = date === data.today;
        const isHoliday = data.holidayLabels.has(date);
        return (
          <div
            key={date}
            className={cn(
              'px-1 py-2 text-center text-[10px] tablet:px-2 tablet:text-xs',
              isToday ? 'font-semibold text-primary-strong' : isHoliday ? 'text-muted' : 'text-ink',
            )}
          >
            <span className="flex flex-col items-center gap-0.5">
              <span className="truncate">{label}</span>
              <span className="tabular text-[9px] text-muted tablet:text-[10px]">{formatMonthDayRange(date)}</span>
              {isToday && <span className="text-[9px] text-muted tablet:text-[10px]">{weekCopy.todayMark}</span>}
              {isHoliday && <span className="text-[9px] text-muted tablet:text-[10px]">{weekCopy.holidayMark}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface GridAxisProps {
  slots: GridSlot[];
  metrics: GridMetrics;
  rowHeight: number;
}

/** 左侧节次轴：每节显示节号与起止时间。 */
export function PeriodAxis({ slots, metrics, rowHeight }: GridAxisProps) {
  return (
    <div aria-hidden data-role="period-axis" className="relative border-r border-line">
      {slots.map((slot, index) => (
        <div
          key={slot.periodNo}
          className="absolute inset-x-0 flex flex-col items-center justify-center gap-0.5 border-b border-line text-[9px] text-muted tablet:text-[11px]"
          style={{ top: `${metrics.padTop + index * rowHeight}px`, height: `${rowHeight}px` }}
        >
          <span className="tabular font-semibold text-ink">{slot.periodNo}</span>
          <span className="tabular">{slot.startTime}</span>
          <span className="tabular">{slot.endTime}</span>
        </div>
      ))}
    </div>
  );
}

/** 头部/尾部补白：只有自定义时间条目超出节次范围时才出现，标出真实时间范围 */
export function GridPads({ metrics, rowHeight }: Omit<GridAxisProps, 'slots'>) {
  return (
    <>
      {metrics.padTop > 0 && (
        <div
          aria-hidden
          data-role="grid-pad-top"
          className="pointer-events-none absolute left-[var(--dt-axis)] right-0 top-0 flex items-center justify-center border-b border-dashed border-line bg-surface-muted/50 text-[9px] text-muted tablet:text-[10px]"
          style={{ height: `${metrics.padTop}px` }}
        >
          {padLabel(metrics.firstMinute - Math.round((metrics.padTop * metrics.minutesPerRow) / rowHeight), metrics.firstMinute)}
        </div>
      )}
      {metrics.padBottom > 0 && (
        <div
          aria-hidden
          data-role="grid-pad-bottom"
          className="pointer-events-none absolute bottom-0 left-[var(--dt-axis)] right-0 flex items-center justify-center border-t border-dashed border-line bg-surface-muted/50 text-[9px] text-muted tablet:text-[10px]"
          style={{ height: `${metrics.padBottom}px` }}
        >
          {padLabel(metrics.lastMinute, metrics.lastMinute + Math.round((metrics.padBottom * metrics.minutesPerRow) / rowHeight))}
        </div>
      )}
    </>
  );
}
