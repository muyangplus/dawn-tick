import type { LessonCell } from '../../data.ts';
import { CourseCard } from '../../components/course-card.tsx';
import { cn } from '../../lib/cn.ts';
import { formatPeriodRange } from '../../lib/format.ts';
import { minuteOf, minuteToY, type GridMetrics, type GridSlot } from '../../lib/grid-metrics.ts';
import { LESSON_TOUCH_ACTION, lessonDraggable } from './drag-session.ts';
import type { DragState } from './use-lesson-drag.ts';

export interface LessonBlockProps {
  lesson: LessonCell;
  /** 所在列的星期与周次，用于读屏播报 */
  weekday: string;
  week: number | null;
  holidayFirstDay: boolean;
  holidayName: string | undefined;
  slots: GridSlot[];
  metrics: GridMetrics;
  rowHeight: number;
  gridHeight: number;
  /** 正被拖动的课次半透明显示 */
  dimmed: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, lesson: LessonCell) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>, lesson: LessonCell) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onClick: () => void;
}

/** 周视图里一张定位好的课程卡：按节次或自定义时间算位置，外层承接拖动指针事件。 */
export function LessonBlock({
  lesson,
  weekday,
  week,
  holidayFirstDay,
  holidayName,
  slots,
  metrics,
  rowHeight,
  gridHeight,
  dimmed,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
}: LessonBlockProps) {
  // 自定义时间的条目按真实时间定位：分钟直接映射到网格（含头部补白）
  const startMinute = minuteOf(lesson.customStart);
  const endMinute = minuteOf(lesson.customEnd);
  const custom = startMinute !== null && endMinute !== null;
  const customTop = custom ? minuteToY(startMinute, slots, rowHeight, metrics) : 0;
  const customBottom = custom ? minuteToY(endMinute, slots, rowHeight, metrics) : 0;
  const rawTop = custom ? customTop + 2 : metrics.padTop + (lesson.periodStart - 1) * rowHeight + 2;
  const rawHeight = custom
    ? Math.max(24, customBottom - customTop - 4)
    : (lesson.periodEnd - lesson.periodStart + 1) * rowHeight - 4;
  // 补白已按分钟展开，这里只兜底：极端值仍保证卡片落在网格内可见
  const height = Math.min(rawHeight, gridHeight);
  const top = Math.max(0, Math.min(rawTop, gridHeight - height));
  // 读屏播报：星期 + 节次 + 课程名 + 周次 + 地点（有则加）
  const ariaParts = [weekday, formatPeriodRange(lesson.periodStart, lesson.periodEnd), lesson.name];
  if (week !== null) ariaParts.push(`第 ${week} 周`);
  if (lesson.room !== null && lesson.room !== '') ariaParts.push(lesson.room);
  return (
    <div
      className={cn('absolute inset-x-1 min-w-0', dimmed && 'opacity-40')}
      data-role="lesson-cell"
      data-span={Math.max(1, lesson.periodEnd - lesson.periodStart + 1)}
      data-custom-time={custom ? 'true' : undefined}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        // 留纵向滚动；拖起来后由 section 上的 touchmove 监听拦下滚动
        touchAction: LESSON_TOUCH_ACTION,
      }}
      onPointerDown={(event) => onPointerDown(event, lesson)}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerUp(event, lesson)}
      onPointerCancel={onPointerCancel}
    >
      <CourseCard
        name={lesson.name}
        color={lesson.color}
        room={lesson.room}
        teacher={lesson.teacher}
        ariaLabel={ariaParts.join(' ')}
        meta={
          lesson.lab
            ? [lesson.courseLabel, custom ? `${lesson.customStart}-${lesson.customEnd}` : `${lesson.startTime}-${lesson.endTime}`]
                .filter((item) => item !== null && item !== undefined && item !== '')
                .join(' · ')
            : custom
              ? `${lesson.customStart}-${lesson.customEnd}`
              : `${lesson.startTime}-${lesson.endTime}`
        }
        // 停课优先于调课，调课优先于放假与非本周
        tone={
          lesson.cancelled
            ? 'cancelled'
            : lesson.movedOut
              ? 'movedOut'
              : lesson.holiday
                ? 'holiday'
                : lesson.inWeek
                  ? 'solid'
                  : 'ghost'
        }
        badge={
          lesson.lab ? (
            <span className="inline-block rounded-sm bg-surface px-1 text-[10px] text-accent-strong" data-role="lab-label">
              {lesson.eventLabel ?? '日程'}
            </span>
          ) : lesson.movedIn ? (
            <span
              className="inline-block rounded-sm bg-surface px-1 text-[10px] text-primary-strong"
              data-role="moved-in-label"
            >
              调课
            </span>
          ) : undefined
        }
        holidayLabel={lesson.holiday && holidayFirstDay ? holidayName ?? '放假' : '放假'}
        onClick={onClick}
        className={cn('h-full', lessonDraggable(lesson) && 'cursor-grab select-none')}
      />
    </div>
  );
}

/** 跟随指针的拖动鬼影 */
export function DragGhost({ drag }: { drag: DragState }) {
  return (
    <div
      aria-hidden
      data-role="drag-ghost"
      className="pointer-events-none fixed z-50 w-32 opacity-70 shadow-lg"
      style={{ left: `${drag.x + 12}px`, top: `${drag.y + 12}px` }}
    >
      <CourseCard
        name={drag.cell.name}
        color={drag.cell.color}
        meta={formatPeriodRange(drag.cell.periodStart, drag.cell.periodEnd)}
      />
    </div>
  );
}
