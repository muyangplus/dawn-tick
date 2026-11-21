import { useEffect, useMemo, useRef, useState } from 'react';
import { dayOfWeek as nextDayOfWeek, WEEKDAY_LABELS, weekOfDate } from '@dawn-tick/core';
import type { AppData, LessonCell } from '../data.ts';
import { NowIndicator } from '../components/now-indicator.tsx';
import { cn } from '../lib/cn.ts';
import { formatMonthDayRange } from '../lib/dates.ts';
import { firstClash, periodAt } from './timetable/drag-session.ts';
import { gridMetrics, minuteToY } from '../lib/grid-metrics.ts';
import { isHolidayRunStart, lessonsOf, occupied } from './timetable/week-grid-helpers.ts';
import { localMinuteOfDay } from '../lib/timeline.ts';
import { weekEmptyKind } from '../lib/week-empty.ts';
import { useRowHeight } from './timetable/use-row-height.ts';
import { useLessonDrag } from './timetable/use-lesson-drag.ts';
import { useEmptySlot } from './timetable/use-empty-slot.ts';
import { WeekEmptyState } from './timetable/week-empty-state.tsx';
import { GridPads, PeriodAxis, WeekHeaderRow } from './timetable/week-grid-chrome.tsx';
import { EmptySlotPlaceholder } from './timetable/empty-slot-placeholder.tsx';
import { DragGhost, LessonBlock } from './timetable/lesson-block.tsx';
import { weekCopy } from '../copy/timetable-week.ts';

export interface QuickCreatePreset {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
}

export interface WeekViewProps {
  data: AppData;
  /** 非本周课程是否用虚线显示 */
  showOtherWeeks: boolean;
  onSelectLesson: (cell: LessonCell) => void;
  /** 拖动落点的日期与节次 */
  onMoveLesson: (cell: LessonCell, date: string, period: number) => void;
  /** 点击空白格后，确认在这里新建课程 */
  onQuickCreate: (preset: QuickCreatePreset) => void;
  onPrevWindow: () => void;
  onNextWindow: () => void;
  /** 空态主按钮：切到设置页并打开导入 */
  onImport: () => void;
  /** 移动端文案分支 */
  compact: boolean;
}

export function WeekView({
  data,
  showOtherWeeks,
  onSelectLesson,
  onMoveLesson,
  onQuickCreate,
  onPrevWindow,
  onNextWindow,
  onImport,
  compact,
}: WeekViewProps) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  const touchStart = useRef<number | null>(null);
  const columns = useRef(new Map<string, HTMLElement>());
  const sectionRef = useRef<HTMLElement | null>(null);
  const rowHeight = useRowHeight(sectionRef, data);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const slots = useMemo(
    () => data.slots.map((slot) => ({ periodNo: slot.period_no, startTime: slot.start_time, endTime: slot.end_time })),
    [data.slots],
  );
  const lessons = useMemo(() => lessonsOf(data), [data]);
  /** 补白只由真正画出来的格子决定：非本周课程按设置隐藏时不参与 */
  const shownLessons = useMemo(
    () => lessons.filter((lesson) => lesson.inWeek || showOtherWeeks),
    [lessons, showOtherWeeks],
  );
  /** 窗口完全落在学期外：每一列都在第 1 周之前或总周数之后 */
  const outsideSemester = useMemo(() => {
    const semester = data.semester;
    if (semester === null) return false;
    return data.windowDates.every((date) => {
      const week = weekOfDate(date, semester.start_date);
      return week < 1 || week > semester.total_weeks;
    });
  }, [data.semester, data.windowDates]);
  /** 窗口里存在非本周课（虚线课）：据此把「真空课表」与「这段只有别周的课」区分开 */
  const onlyOtherWeeks = lessons.some((lesson) => !lesson.inWeek);
  /** 空态三态：有可见课程（含按设置显示的虚线课）时不显示空态 */
  const emptyKind = weekEmptyKind({
    visibleLessons: shownLessons.length,
    outsideSemester,
    hasOtherWeekLessons: onlyOtherWeeks,
  });
  const periodCount = slots.length;
  /** 头部/尾部补白随自定义时间条目伸缩：节次轴、时间线与拖动换算都跟着平移 */
  const metrics = useMemo(() => gridMetrics(slots, shownLessons, rowHeight), [slots, shownLessons, rowHeight]);
  const gridHeight = metrics.padTop + periodCount * rowHeight + metrics.padBottom;
  const nowMinute = localMinuteOfDay(nowTick, data.timeZone);
  const ratio =
    gridHeight === 0 ? null : minuteToY(nowMinute, slots, rowHeight, metrics) / gridHeight;

  function targetCellOf(clientX: number, clientY: number): { date: string; period: number } | null {
    for (const [date, element] of columns.current) {
      const bounds = element.getBoundingClientRect();
      if (clientX < bounds.left || clientX > bounds.right) continue;
      return { date, period: periodAt(clientY, bounds.top, periodCount, rowHeight, metrics.padTop) };
    }
    return null;
  }

  const {
    drag,
    session,
    suppressNextClick,
    onLessonPointerDown,
    onLessonPointerMove,
    onLessonPointerUp,
    onLessonPointerCancel,
  } = useLessonDrag({ sectionRef, targetCellOf, periodCount, onMoveLesson });
  const {
    empty,
    bodyDragging,
    emptyRef,
    suppressSlotClick,
    setEmptyTarget,
    pickEmpty,
    openQuickCreate,
    step,
    resizeRange,
    beginEmptyDrag,
    beginSlotSelect,
    moveEmptyDrag,
    endEmptyDrag,
    cancelEmptyDrag,
  } = useEmptySlot({ data, periodCount, rowHeight, sectionRef, onQuickCreate });

  return (
    <section
      ref={sectionRef}
      aria-label={weekCopy.viewAria}
      className="flex flex-col gap-2"
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const end = event.changedTouches[0]?.clientX ?? null;
        touchStart.current = null;
        if (start === null || end === null) return;
        const delta = end - start;
        if (Math.abs(delta) < 60) return;
        if (delta > 0) onPrevWindow();
        else onNextWindow();
      }}
    >
      {/* 空态判据＝窗口内没有任何可见课程：非本周虚线课算可见，只有非本周 / 学期外 / 真空课表分开说 */}
      {emptyKind !== 'none' && (
        <WeekEmptyState
          kind={emptyKind}
          data={data}
          compact={compact}
          onPrevWindow={onPrevWindow}
          onNextWindow={onNextWindow}
          onImport={onImport}
          onAddCourse={() => openQuickCreate({ date: data.windowDates[0] ?? data.windowStart, start: 1, end: 1 })}
        />
      )}

      {/* 不横向滚动：列宽按容器等分，窄屏压缩节次轴与卡片间距；节次轴始终显示起止时间 */}
      <div className="rounded-lg border border-line bg-surface [--dt-axis:2.75rem] tablet:[--dt-axis:3.5rem]">
        <div>
          <WeekHeaderRow data={data} />

          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `var(--dt-axis) repeat(${data.windowDates.length}, minmax(0, 1fr))`,
              height: `${gridHeight}px`,
            }}
          >
            <PeriodAxis slots={slots} metrics={metrics} rowHeight={rowHeight} />

            <GridPads metrics={metrics} rowHeight={rowHeight} />

            {data.windowDates.map((columnDate) => {
              const isToday = columnDate === data.today;
              // 放假优先于非本周；多天假期只有第一天显示假期名称，之后只显示「放假」
              const holidayFirstDay = isHolidayRunStart(data, columnDate);
              const holidayName = data.holidayLabels.get(columnDate);
              const weekday = WEEKDAY_LABELS[nextDayOfWeek(columnDate) - 1] ?? '';
              const week = data.semester === null ? null : Math.max(1, weekOfDate(columnDate, data.semester.start_date));
              const dayLessons = lessons
                .filter((lesson) => lesson.date === columnDate)
                .filter((lesson) => lesson.inWeek || showOtherWeeks);
              const isDropColumn = drag !== null && drag.date === columnDate;
              const placeholder = empty !== null && empty.date === columnDate ? empty : null;
              const placeholderClash =
                placeholder === null
                  ? null
                  : firstClash(data, placeholder.date, placeholder.start, placeholder.end);
              return (
                <div
                  key={`column-${columnDate}`}
                  role="group"
                  aria-label={`${weekday} ${formatMonthDayRange(columnDate)}`}
                  ref={(element) => {
                    if (element === null) columns.current.delete(columnDate);
                    else columns.current.set(columnDate, element);
                  }}
                  className={cn(
                    'relative border-r border-line last:border-r-0',
                    isDropColumn && 'bg-primary/10 ring-1 ring-inset ring-primary-strong',
                  )}
                  style={
                    isToday && !isDropColumn
                      ? { backgroundColor: 'color-mix(in srgb, var(--dt-primary) 6%, transparent)' }
                      : undefined
                  }
                  data-today={isToday ? 'true' : undefined}
                  data-date={columnDate}
                  data-day={nextDayOfWeek(columnDate)}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    // 每次按下都复位一次性抑制标记，避免上一次拖动留下的状态吃掉这次点击
                    suppressSlotClick.current = false;
                    // 长按拖动课程卡时会冒泡到列上，此时不要弹占位块
                    if (session.current !== null) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const period = periodAt(event.clientY, bounds.top, periodCount, rowHeight, metrics.padTop);
                    // 已占用的格只清掉占位块，不进入拖动
                    if (occupied(data, columnDate, period)) {
                      setEmptyTarget(null);
                      return;
                    }
                    pickEmpty(columnDate, period);
                    // 空白格按下即进入范围拖动：不松手拖过去就定范围，松手直接开加课弹窗
                    beginSlotSelect(event, period);
                  }}
                  onClick={(event) => {
                    // 拖动占位块松手后的那一次 click 只用来清标记（此时加课弹窗已经打开）
                    if (suppressSlotClick.current) {
                      suppressSlotClick.current = false;
                      return;
                    }
                    // 点空白格（含格线上的细分行）才弹出占位块，课程卡与占位块自己处理点击
                    const target = event.target as HTMLElement;
                    if (target.closest('[data-role="empty-slot"]') !== null) return;
                    if (target.closest('[data-tone]') !== null) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    pickEmpty(columnDate, periodAt(event.clientY, bounds.top, periodCount, rowHeight, metrics.padTop));
                  }}
                >
                  {Array.from({ length: periodCount }, (_, rowIndex) => (
                    <div
                      key={`line-${columnDate}-${rowIndex}`}
                      className="absolute inset-x-0 border-b border-line"
                      style={{ top: `${metrics.padTop + rowIndex * rowHeight}px`, height: `${rowHeight}px` }}
                    />
                  ))}

                  {isDropColumn && drag !== null && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1 rounded-sm border-2 border-dashed border-primary-strong bg-primary/15"
                      style={{
                        top: `${metrics.padTop + (drag.period - 1) * rowHeight + 2}px`,
                        height: `${(drag.cell.periodEnd - drag.cell.periodStart + 1) * rowHeight - 4}px`,
                      }}
                    />
                  )}

                  {placeholder !== null && (
                    <EmptySlotPlaceholder
                      placeholder={placeholder}
                      clash={placeholderClash}
                      bodyDragging={bodyDragging}
                      periodCount={periodCount}
                      rowHeight={rowHeight}
                      padTop={metrics.padTop}
                      currentTarget={() => emptyRef.current}
                      onBeginDrag={beginEmptyDrag}
                      onDragMove={moveEmptyDrag}
                      onDragEnd={endEmptyDrag}
                      onDragCancel={cancelEmptyDrag}
                      onCreate={openQuickCreate}
                      onStep={step}
                      onResize={resizeRange}
                      onDismiss={() => setEmptyTarget(null)}
                    />
                  )}

                  {dayLessons.map((lesson) => (
                    <LessonBlock
                      key={`${lesson.courseId}-${lesson.periodStart}`}
                      lesson={lesson}
                      weekday={weekday}
                      week={week}
                      holidayFirstDay={holidayFirstDay}
                      holidayName={holidayName}
                      slots={slots}
                      metrics={metrics}
                      rowHeight={rowHeight}
                      gridHeight={gridHeight}
                      dimmed={drag?.cell === lesson}
                      onPointerDown={onLessonPointerDown}
                      onPointerMove={onLessonPointerMove}
                      onPointerUp={onLessonPointerUp}
                      onPointerCancel={onLessonPointerCancel}
                      onClick={() => {
                        // 拖动收尾的那一次 click 只用来清标记，不打开详情
                        if (suppressNextClick.current) {
                          suppressNextClick.current = false;
                          return;
                        }
                        onSelectLesson(lesson);
                      }}
                    />
                  ))}
                </div>
              );
            })}

            {ratio !== null && data.windowDates.includes(data.today) && (
              <NowIndicator ratio={ratio} className="left-[var(--dt-axis)]" />
            )}
          </div>
        </div>
      </div>

      {drag !== null && <DragGhost drag={drag} />}
    </section>
  );
}
