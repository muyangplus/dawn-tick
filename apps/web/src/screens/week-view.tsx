import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { AppData, LessonCell } from '../data.ts';
import { CourseCard } from '../components/course-card.tsx';
import { NowIndicator } from '../components/now-indicator.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { cn } from '../lib/cn.ts';
import { localMinuteOfDay, nowRatio } from '../lib/timeline.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ROW_HEIGHT = 56;
const AXIS_WIDTH = '3.5rem';
/** 长按多久才进入拖动（毫秒），未达时长按单击处理。 */
const LONG_PRESS_MS = 350;
/** 长按期间允许的手指/鼠标抖动半径（像素），超过就取消长按。 */
const MOVE_TOLERANCE = 8;

/** 查看周里第 day 天的日期（周一为第 1 天）。 */
function weekDayDate(weekStartDate: string, day: number): string {
  const base = Date.parse(`${weekStartDate}T00:00:00Z`);
  if (Number.isNaN(base)) return weekStartDate;
  return new Date(base + (day - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** 表头显示月日。 */
function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** 节次范围文案：单节显示「第 3 节」，连堂显示「第 3–4 节」。 */
function formatPeriods(start: number, end: number): string {
  return start === end ? `第 ${start} 节` : `第 ${start}–${end} 节`;
}

/** 该格里是否已有课。 */
function occupied(data: AppData, day: number, period: number): boolean {
  return (data.grid.get(`${day}:${period}`) ?? []).length > 0;
}

/** 落点所在的节次（按列高度换算，越界夹到首尾节）。 */
function periodAt(clientY: number, columnTop: number, periodCount: number): number {
  return Math.min(periodCount, Math.max(1, Math.floor((clientY - columnTop) / ROW_HEIGHT) + 1));
}

/** 给一个节次范围，返回不越过已有课、也不越界的就近可用范围。 */
function nearestFreeRange(
  data: AppData,
  day: number,
  start: number,
  end: number,
  periodCount: number,
): { start: number; end: number } {
  const length = Math.max(1, end - start + 1);
  const fit = (value: number): number => Math.min(Math.max(1, periodCount - length + 1), Math.max(1, value));
  const candidate = fit(start);
  if (length <= periodCount && !rangeBlocked(data, day, candidate, candidate + length - 1, periodCount)) {
    return { start: candidate, end: candidate + length - 1 };
  }
  for (let delta = 1; delta <= periodCount; delta += 1) {
    for (const value of [fit(start + delta), fit(start - delta)]) {
      if (rangeBlocked(data, day, value, value + length - 1, periodCount)) continue;
      return { start: value, end: value + length - 1 };
    }
  }
  return { start: candidate, end: candidate + length - 1 };
}

/** 该范围内是否有课（用于截断拖动落点与占位块）。 */
function rangeBlocked(
  data: AppData,
  day: number,
  start: number,
  end: number,
  periodCount: number,
): boolean {
  if (start < 1 || end > periodCount) return true;
  for (let period = start; period <= end; period += 1) {
    if (occupied(data, day, period)) return true;
  }
  return false;
}

interface EmptyTarget {
  day: number;
  start: number;
  end: number;
}

interface DragState {
  cell: LessonCell;
  day: number;
  period: number;
  x: number;
  y: number;
}

interface DragSession {
  pointerId: number;
  lesson: LessonCell;
  startX: number;
  startY: number;
  timer: number;
  active: boolean;
  /** 长按生效后接收指针事件的卡片节点，保证拖出卡片也不丢事件 */
  element: HTMLElement | null;
}

export interface QuickCreatePreset {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
}

export interface WeekViewProps {
  data: AppData;
  viewDays: number;
  /** 非本周课程是否用虚线显示 */
  showOtherWeeks: boolean;
  onSelectLesson: (cell: LessonCell) => void;
  onMoveLesson: (cell: LessonCell, dayOfWeek: number, period: number) => void;
  /** 点击空白格后，确认在这里新建课程 */
  onQuickCreate: (preset: QuickCreatePreset) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

function lessonsOf(data: AppData): LessonCell[] {
  const out: LessonCell[] = [];
  for (const list of data.grid.values()) out.push(...list);
  return out;
}

export function WeekView({
  data,
  viewDays,
  showOtherWeeks,
  onSelectLesson,
  onMoveLesson,
  onQuickCreate,
  onPrevWeek,
  onNextWeek,
}: WeekViewProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [empty, setEmpty] = useState<EmptyTarget | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const touchStart = useRef<number | null>(null);
  const session = useRef<DragSession | null>(null);
  const suppressNextClick = useRef(false);
  const columns = useRef(new Map<number, HTMLElement>());
  const dropRef = useRef<{ day: number; period: number } | null>(null);
  const emptyRef = useRef<EmptyTarget | null>(null);
  const wheelAt = useRef(0);
  const sectionRef = useRef<HTMLElement | null>(null);
  const emptyDrag = useRef<{ pointerId: number; startY: number; startPeriod: number; endPeriod: number } | null>(
    null,
  );

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const slots = useMemo(
    () => data.slots.map((slot) => ({ periodNo: slot.period_no, startTime: slot.start_time, endTime: slot.end_time })),
    [data.slots],
  );
  const ratio = nowRatio(slots, localMinuteOfDay(nowTick, data.timeZone));
  const lessons = useMemo(() => lessonsOf(data), [data]);
  const periodCount = slots.length;

  useEffect(
    () => () => {
      if (session.current !== null) window.clearTimeout(session.current.timer);
    },
    [],
  );

  // 占位块打开时：Esc 取消，滚轮改节次
  useEffect(() => {
    if (empty === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setEmpty(null);
    };
    const onWheel = (event: WheelEvent): void => {
      const now = Date.now();
      if (now - wheelAt.current < 90) {
        event.preventDefault();
        return;
      }
      wheelAt.current = now;
      const current = emptyRef.current;
      if (current === null) return;
      event.preventDefault();
      step(current, event.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
    // step 只依赖 data/periodCount，二者变化时会重建监听
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty !== null, data, periodCount]);

  // 点课表以外的区域取消占位块
  useEffect(() => {
    if (empty === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && sectionRef.current?.contains(target) === true) return;
      setEmpty(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [empty !== null]);

  function setEmptyTarget(next: EmptyTarget | null): void {
    emptyRef.current = next;
    setEmpty(next);
  }

  /** 点到空白格：先给出一个「目标节次 + 单节」的虚线占位块。 */
  function pickEmpty(day: number, period: number): void {
    if (occupied(data, day, period)) {
      setEmptyTarget(null);
      return;
    }
    setEmptyTarget({ day, start: period, end: period });
  }

  /**
   * 调整占位节次：delta > 0 向下扩展、delta < 0 向上收缩/上移。
   * 越过已有课或超出节次上下限时就近截断，并给出提示。
   */
  function step(target: EmptyTarget, delta: number): void {
    let start = target.start;
    let end = target.end;
    if (delta > 0) end = Math.min(periodCount, end + delta);
    else if (start > 1) start = start - 1;
    const fit = nearestFreeRange(data, target.day, start, end, periodCount);
    setEmptyTarget({ day: target.day, start: fit.start, end: fit.end });
    if (fit.start !== start || fit.end !== end) {
      toast.info(`这里有课挡着，已就近调整为 ${formatPeriods(fit.start, fit.end)}`);
    }
  }

  /** 拖动占位块右侧滚轮：上下拖动改变节次范围。 */
  function onWheelPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || empty === null) return;
    // 必须挡住冒泡：列上的 pointerdown 会重置占位块
    event.preventDefault();
    event.stopPropagation();
    emptyDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startPeriod: empty.start,
      endPeriod: empty.end,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onWheelPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const active = emptyDrag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const current = emptyRef.current;
    if (current === null) return;
    event.preventDefault();
    const rows = Math.round((event.clientY - active.startY) / ROW_HEIGHT);
    const start = Math.min(periodCount, Math.max(1, active.startPeriod + rows));
    const end = Math.min(periodCount, Math.max(start, active.endPeriod + rows));
    const fit = nearestFreeRange(data, current.day, start, end, periodCount);
    setEmptyTarget({ day: current.day, start: fit.start, end: fit.end });
  }

  function onWheelPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const active = emptyDrag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    emptyDrag.current = null;
    const current = emptyRef.current;
    if (current === null) return;
    const changed = current.start !== active.startPeriod || current.end !== active.endPeriod;
    if (changed) toast.success(`已调整为 ${formatPeriods(current.start, current.end)}`);
  }

  function targetCellOf(clientX: number, clientY: number): { day: number; period: number } | null {
    for (const [day, element] of columns.current) {
      const bounds = element.getBoundingClientRect();
      if (clientX < bounds.left || clientX > bounds.right) continue;
      return { day, period: periodAt(clientY, bounds.top, periodCount) };
    }
    return null;
  }

  function clearSession(): void {
    const active = session.current;
    if (active === null) return;
    window.clearTimeout(active.timer);
    session.current = null;
  }

  function releaseCapture(active: DragSession): void {
    try {
      active.element?.releasePointerCapture(active.pointerId);
    } catch {
      // 同 setPointerCapture：不支持时忽略
    }
  }

  /** 长按 350ms 后进入拖动；未达时长前抬手仍是单击（打开课程详情）。 */
  function onLessonPointerDown(event: React.PointerEvent<HTMLDivElement>, lesson: LessonCell): void {
    // 每次按下都先复位一次性抑制标记，避免上一次拖动留下的状态吃掉这次单击
    suppressNextClick.current = false;
    if (event.button !== 0 || !lesson.inWeek) return;
    clearSession();
    const active: DragSession = {
      pointerId: event.pointerId,
      lesson,
      startX: event.clientX,
      startY: event.clientY,
      timer: 0,
      active: false,
      element: event.currentTarget,
    };
    active.timer = window.setTimeout(() => {
      if (session.current !== active) return;
      active.active = true;
      try {
        active.element?.setPointerCapture(active.pointerId);
      } catch {
        // 某些环境（jsdom 等）不支持指针捕获，退化为普通事件流
      }
      dropRef.current = targetCellOf(active.startX, active.startY);
      setDrag({
        cell: lesson,
        day: dropRef.current?.day ?? lesson.dayOfWeek,
        period: dropRef.current?.period ?? lesson.periodStart,
        x: active.startX,
        y: active.startY,
      });
    }, LONG_PRESS_MS);
    session.current = active;
  }

  function onLessonPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const active = session.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    if (!active.active) {
      const moved = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
      if (moved > MOVE_TOLERANCE) clearSession();
      return;
    }
    event.preventDefault();
    const drop = targetCellOf(event.clientX, event.clientY);
    dropRef.current = drop;
    setDrag((current) =>
      current === null
        ? null
        : {
            ...current,
            day: drop?.day ?? current.day,
            period: drop?.period ?? current.period,
            x: event.clientX,
            y: event.clientY,
          },
    );
  }

  function onLessonPointerUp(event: React.PointerEvent<HTMLDivElement>, lesson: LessonCell): void {
    const active = session.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const wasDragging = active.active;
    clearSession();
    if (!wasDragging) return;
    // 刚刚拖过，紧接着的那一次 click 不再当单击处理（只抑制这一次）
    suppressNextClick.current = true;
    releaseCapture(active);
    setDrag(null);
    const drop = targetCellOf(event.clientX, event.clientY) ?? dropRef.current;
    dropRef.current = null;
    if (drop === null || periodCount === 0) return;
    if (drop.day === lesson.dayOfWeek && drop.period === lesson.periodStart) return;
    const span = lesson.periodEnd - lesson.periodStart + 1;
    const period = Math.min(periodCount - span + 1, Math.max(1, drop.period));
    onMoveLesson(lesson, drop.day, period);
  }

  function onLessonPointerCancel(event: React.PointerEvent<HTMLDivElement>): void {
    const active = session.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const wasDragging = active.active;
    clearSession();
    if (!wasDragging) return;
    suppressNextClick.current = true;
    releaseCapture(active);
    setDrag(null);
    dropRef.current = null;
  }

  return (
    <section
      ref={sectionRef}
      aria-label="周视图"
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
        if (delta > 0) onPrevWeek();
        else onNextWeek();
      }}
    >
      {!data.hasLessons && (
        <EmptyState
          title={`第 ${data.viewWeek} 周没有课程`}
          description="可用右上角添加课程，或到导入页从 ICS、CSV/Excel 与教务系统导入"
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <div className="min-w-[40rem]">
          <div
            className="grid border-b border-line"
            style={{ gridTemplateColumns: `${AXIS_WIDTH} repeat(${viewDays}, minmax(0, 1fr))` }}
          >
            <div className="px-2 py-2 text-center text-xs text-muted">节次</div>
            {WEEKDAYS.slice(0, viewDays).map((label, index) => {
              const day = index + 1;
              const isToday = data.viewWeek === data.week && day === data.todayOfWeek;
              const date = weekDayDate(data.weekStartDate, day);
              const isHoliday = data.holidayLabels.has(date);
              return (
                <div
                  key={label}
                  className={cn(
                    'px-2 py-2 text-center text-xs',
                    isToday ? 'font-semibold text-primary-strong' : isHoliday ? 'text-muted' : 'text-ink',
                  )}
                >
                  <span className="flex flex-col items-center gap-0.5">
                    <span>{label}</span>
                    <span className="tabular text-[10px] text-muted">{formatMonthDay(date)}</span>
                    {isToday && <span className="text-[10px] text-muted">今天</span>}
                    {isHoliday && <span className="text-[10px] text-muted">放假</span>}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `${AXIS_WIDTH} repeat(${viewDays}, minmax(0, 1fr))`,
              height: `${periodCount * ROW_HEIGHT}px`,
            }}
          >
            <div className="relative border-r border-line">
              {slots.map((slot, index) => (
                <div
                  key={slot.periodNo}
                  className="absolute inset-x-0 flex flex-col items-center justify-center gap-0.5 border-b border-line text-[11px] text-muted"
                  style={{ top: `${index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
                >
                  <span className="tabular font-semibold text-ink">{slot.periodNo}</span>
                  <span className="tabular">{slot.startTime}</span>
                  <span className="tabular">{slot.endTime}</span>
                </div>
              ))}
            </div>

            {Array.from({ length: viewDays }, (_, index) => {
              const day = index + 1;
              const isToday = data.viewWeek === data.week && day === data.todayOfWeek;
              const dayLessons = lessons
                .filter((lesson) => lesson.dayOfWeek === day)
                .filter((lesson) => lesson.inWeek || showOtherWeeks);
              const isDropColumn = drag !== null && drag.day === day;
              const placeholder = empty !== null && empty.day === day ? empty : null;
              return (
                <div
                  key={`column-${day}`}
                  ref={(element) => {
                    if (element === null) columns.current.delete(day);
                    else columns.current.set(day, element);
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
                  data-day={day}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    // 长按拖动课程卡时会冒泡到列上，此时不要弹占位块
                    if (session.current !== null) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    pickEmpty(day, periodAt(event.clientY, bounds.top, periodCount));
                  }}
                  onClick={(event) => {
                    // 点空白格（含格线上的细分行）才弹出占位块，课程卡与占位块自己处理点击
                    const target = event.target as HTMLElement;
                    if (target.closest('[data-role="empty-slot"]') !== null) return;
                    if (target.closest('[data-tone]') !== null) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    pickEmpty(day, periodAt(event.clientY, bounds.top, periodCount));
                  }}
                >
                  {Array.from({ length: periodCount }, (_, rowIndex) => (
                    <div
                      key={`line-${day}-${rowIndex}`}
                      className="absolute inset-x-0 border-b border-line"
                      style={{ top: `${rowIndex * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
                    />
                  ))}

                  {isDropColumn && drag !== null && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1 rounded-sm border-2 border-dashed border-primary-strong bg-primary/15"
                      style={{
                        top: `${(drag.period - 1) * ROW_HEIGHT + 2}px`,
                        height: `${(drag.cell.periodEnd - drag.cell.periodStart + 1) * ROW_HEIGHT - 4}px`,
                      }}
                    />
                  )}

                  {placeholder !== null && (
                    <div
                      className="absolute inset-x-1 z-10 flex flex-col items-stretch gap-1 overflow-hidden rounded-sm border-2 border-dashed border-primary-strong bg-surface px-1.5 py-1"
                      style={{
                        top: `${(placeholder.start - 1) * ROW_HEIGHT + 2}px`,
                        height: `${Math.max(ROW_HEIGHT - 4, (placeholder.end - placeholder.start + 1) * ROW_HEIGHT - 4)}px`,
                      }}
                      data-role="empty-slot"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label="在此新建课程"
                        className="flex min-h-0 flex-1 items-center justify-center rounded-sm text-primary-strong hover:bg-surface-muted"
                        onClick={(event) => {
                          event.stopPropagation();
                          onQuickCreate({
                            dayOfWeek: placeholder.day,
                            periodStart: Math.min(placeholder.start, placeholder.end),
                            periodEnd: Math.max(placeholder.start, placeholder.end),
                            weeks: [data.viewWeek],
                          });
                          setEmptyTarget(null);
                        }}
                      >
                        <Plus className="size-5" aria-hidden />
                      </button>
                      <div className="flex items-center justify-center gap-1 text-[11px]">
                        <button
                          type="button"
                          aria-label="上一节"
                          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-muted hover:text-ink"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (empty !== null) step(empty, -1);
                          }}
                        >
                          <ChevronUp className="size-3.5" aria-hidden />
                        </button>
                        <div
                          role="spinbutton"
                          aria-label="节次范围"
                          aria-valuemin={1}
                          aria-valuemax={periodCount}
                          aria-valuenow={placeholder.start}
                          aria-valuetext={formatPeriods(placeholder.start, placeholder.end)}
                          data-role="period-wheel"
                          title="上下拖动（或滚动鼠标滚轮）调整节次范围"
                          className="tabular cursor-ns-resize select-none whitespace-nowrap rounded-sm px-1 text-ink"
                          style={{ touchAction: 'none' }}
                          onPointerDown={onWheelPointerDown}
                          onPointerMove={onWheelPointerMove}
                          onPointerUp={onWheelPointerUp}
                          onPointerCancel={onWheelPointerUp}
                        >
                          {formatPeriods(placeholder.start, placeholder.end)}
                        </div>
                        <button
                          type="button"
                          aria-label="下一节"
                          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-muted hover:text-ink"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (empty !== null) step(empty, 1);
                          }}
                        >
                          <ChevronDown className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  )}

                  {dayLessons.map((lesson) => (
                    <div
                      key={`${lesson.courseId}-${lesson.periodStart}`}
                      className={cn('absolute inset-x-1 min-w-0', drag?.cell === lesson && 'opacity-40')}
                      style={{
                        top: `${(lesson.periodStart - 1) * ROW_HEIGHT + 2}px`,
                        height: `${(lesson.periodEnd - lesson.periodStart + 1) * ROW_HEIGHT - 4}px`,
                        ...(lesson.inWeek ? { touchAction: 'none' as const } : {}),
                      }}
                      onPointerDown={(event) => onLessonPointerDown(event, lesson)}
                      onPointerMove={onLessonPointerMove}
                      onPointerUp={(event) => onLessonPointerUp(event, lesson)}
                      onPointerCancel={onLessonPointerCancel}
                    >
                      <CourseCard
                        name={lesson.name}
                        color={lesson.color}
                        room={lesson.room}
                        teacher={lesson.teacher}
                        meta={`${lesson.startTime}-${lesson.endTime}`}
                        tone={!lesson.inWeek ? 'ghost' : lesson.holiday ? 'holiday' : 'solid'}
                        onClick={() => {
                          // 拖动收尾的那一次 click 只用来清标记，不打开详情
                          if (suppressNextClick.current) {
                            suppressNextClick.current = false;
                            return;
                          }
                          onSelectLesson(lesson);
                        }}
                        className={cn('h-full', lesson.inWeek && 'cursor-grab select-none')}
                      />
                    </div>
                  ))}
                </div>
              );
            })}

            {ratio !== null && data.viewWeek === data.week && (
              <NowIndicator ratio={ratio} className="left-14" />
            )}
          </div>
        </div>
      </div>

      {drag !== null && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 w-32 opacity-70 shadow-lg"
          style={{ left: `${drag.x + 12}px`, top: `${drag.y + 12}px` }}
        >
          <CourseCard
            name={drag.cell.name}
            color={drag.cell.color}
            meta={formatPeriods(drag.cell.periodStart, drag.cell.periodEnd)}
          />
        </div>
      )}
    </section>
  );
}
