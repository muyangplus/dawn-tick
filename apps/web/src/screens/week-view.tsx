import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { addDays } from '@dawn-tick/core';
import type { AppData, LessonCell } from '../data.ts';
import { CourseCard } from '../components/course-card.tsx';
import { NowIndicator } from '../components/now-indicator.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { cn } from '../lib/cn.ts';
import { localMinuteOfDay, nowRatio } from '../lib/timeline.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ROW_HEIGHT = 56;
/** 长按多久才进入拖动（毫秒），未达时长按单击处理。 */
const LONG_PRESS_MS = 350;
/** 长按期间允许的手指/鼠标抖动半径（像素），超过就取消长按。 */
const MOVE_TOLERANCE = 8;
/** 拖动占位块松手后，抑制紧随那次 click 的时间窗（毫秒）。 */
const SUPPRESS_SLOT_CLICK_MS = 500;

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

/**
 * 多天假期的第一天：当天放假、且前一天不放假。
 * 放假判定用 data.holidayLabels（内置节假日 ∪ 手工 holiday，已扣除手工非假日）。
 */
function isHolidayRunStart(data: AppData, date: string): boolean {
  if (!data.holidayLabels.has(date)) return false;
  return !data.holidayLabels.has(addDays(date, -1));
}

/** 该格里是否已有课。 */
function occupied(data: AppData, day: number, period: number): boolean {
  return (data.grid.get(`${day}:${period}`) ?? []).length > 0;
}

/** 落点所在的节次（按列高度换算，越界夹到首尾节）。 */
function periodAt(clientY: number, columnTop: number, periodCount: number): number {
  return Math.min(periodCount, Math.max(1, Math.floor((clientY - columnTop) / ROW_HEIGHT) + 1));
}

/** 该范围里已经排了哪些课（同一门课的连堂只算一次）。 */
function clashingLessons(data: AppData, day: number, start: number, end: number): LessonCell[] {
  const out: LessonCell[] = [];
  const seen = new Set<string>();
  for (const list of data.grid.values()) {
    for (const cell of list) {
      if (!cell.inWeek || cell.dayOfWeek !== day) continue;
      if (cell.periodEnd < start || cell.periodStart > end) continue;
      if (seen.has(cell.scheduleId)) continue;
      seen.add(cell.scheduleId);
      out.push(cell);
    }
  }
  return out;
}

interface Clash {
  name: string;
  start: number;
  end: number;
}

/** 范围里第一门重叠的课，用课程全名，提示文案更清楚。 */
function firstClash(data: AppData, day: number, start: number, end: number): Clash | null {
  const cell = clashingLessons(data, day, start, end)[0];
  if (cell === undefined) return null;
  const name = data.courses.find((course) => course.id === cell.courseId)?.name ?? cell.name;
  return { name, start: cell.periodStart, end: cell.periodEnd };
}

/** 重叠提示：与「高等数学」第 1–2 节重叠。 */
function clashLabel(clash: Clash): string {
  return `与「${clash.name}」${formatPeriods(clash.start, clash.end)}重叠`;
}

/** 按住的位置决定哪条边跟着指针：单节时上下都算扩展，否则按上半/下半取边。 */
function emptyDragEdgeOf(
  element: HTMLElement,
  clientY: number,
  target: EmptyTarget,
  mode: EmptyDragMode,
): EmptyDragEdge {
  if (mode === 'wheel' || target.start === target.end) return 'both';
  const bounds = element.getBoundingClientRect();
  return clientY < bounds.top + bounds.height / 2 ? 'top' : 'bottom';
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
  /** 长按生效后接收指针事件的卡片节点：指针移出卡片后事件仍可达 */
  element: HTMLElement | null;
}

/** 占位块的拖动方式：滚轮条整段平移，块本体按边伸缩，空白格按下直接拖出范围。 */
type EmptyDragMode = 'wheel' | 'body' | 'select';

/**
 * 块本体拖动时哪条边跟着指针走：
 * both 是起始就是单节（上下都算扩展），top / bottom 是按住的位置在上半还是下半。
 */
type EmptyDragEdge = 'both' | 'top' | 'bottom';

interface EmptyDragState {
  pointerId: number;
  mode: EmptyDragMode;
  edge: EmptyDragEdge;
  startY: number;
  startPeriod: number;
  endPeriod: number;
  /** 是否已经超过点击抖动阈值：仅实际拖动过才在松手时弹窗 */
  moved: boolean;
}

/** 拖动过程中需要的最小指针信息：React 合成事件与原生 PointerEvent 都满足。 */
type DragPointer = Pick<PointerEvent, 'pointerId' | 'clientY' | 'preventDefault'>;

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

/** 墙钟时间映射到「节次行空间」：行内线性，落在一节里就返回小数行号。 */
function customRow(
  clock: string | null | undefined,
  slots: ReadonlyArray<{ periodNo: number; startTime: string; endTime: string }>,
  periodCount: number,
): number | null {
  if (clock === null || clock === undefined || clock === '' || slots.length === 0) return null;
  const toMinutes = (value: string): number => {
    const [hour, minute] = value.split(':').map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
  };
  const target = toMinutes(clock);
  for (const slot of slots) {
    const from = toMinutes(slot.startTime);
    const to = toMinutes(slot.endTime);
    if (target >= from && target <= to && to > from) {
      return slot.periodNo - 1 + (target - from) / (to - from);
    }
  }
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (first !== undefined && target < toMinutes(first.startTime)) {
    return -Math.min(1, (toMinutes(first.startTime) - target) / 60);
  }
  if (last !== undefined && target > toMinutes(last.endTime)) {
    return periodCount + Math.min(1, (target - toMinutes(last.endTime)) / 60);
  }
  return null;
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
  const [emptyDragMode, setEmptyDragMode] = useState<EmptyDragMode | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const touchStart = useRef<number | null>(null);
  const session = useRef<DragSession | null>(null);
  const suppressNextClick = useRef(false);
  const columns = useRef(new Map<number, HTMLElement>());
  const dropRef = useRef<{ day: number; period: number } | null>(null);
  const emptyRef = useRef<EmptyTarget | null>(null);
  const wheelAt = useRef(0);
  const sectionRef = useRef<HTMLElement | null>(null);
  const emptyDrag = useRef<EmptyDragState | null>(null);
  /** 是否已显示拖动中的实时反馈：pointermove 里不读 state，避免拿到过期值 */
  const emptyVisual = useRef(false);
  /** 拖动占位块松手后紧跟着的那次 click：只用来清标记，不再生成占位块 */
  const suppressSlotClick = useRef(false);
  const suppressSlotTimer = useRef(0);
  /** 已经播报过的重叠提示，拖动过程中同一处只提示一次 */
  const lastClash = useRef('');

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
      window.clearTimeout(suppressSlotTimer.current);
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

  // 拖动占位块期间把 move/up 也挂到 window：按住「＋」开始拖动时被按下的按钮会被
  // 实时标签盖住，指针一离开块体（或指针捕获没生效）块节点就收不到 pointermove。
  useEffect(() => {
    const onMove = (event: PointerEvent): void => moveEmptyDrag(event);
    const onUp = (event: PointerEvent): void => endEmptyDrag(event);
    const onCancel = (event: PointerEvent): void => cancelEmptyDrag(event);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // 处理函数只依赖 data/periodCount 与 ref，二者变化时重建监听
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, periodCount]);

  function setEmptyTarget(next: EmptyTarget | null): void {
    const previous = emptyRef.current;
    emptyRef.current = next;
    setEmpty(next);
    // 换了一天或关掉占位块后，同一处重叠可以再提示一次
    if (next === null || previous === null || next.day !== previous.day) lastClash.current = '';
  }

  /** 点到空白格：先给出一个「目标节次 + 单节」的虚线占位块。 */
  function pickEmpty(day: number, period: number): void {
    if (occupied(data, day, period)) {
      setEmptyTarget(null);
      return;
    }
    setEmptyTarget({ day, start: period, end: period });
  }

  /** 范围落进已有课时提醒一次：课程允许重叠，这里只提示、不拦截。 */
  function warnClash(day: number, start: number, end: number): void {
    const clash = firstClash(data, day, start, end);
    const key = clash === null ? '' : `${clash.name}:${clash.start}-${clash.end}`;
    if (key === lastClash.current) return;
    lastClash.current = key;
    if (clash !== null) toast.info(`${clashLabel(clash)}，仍可继续新建`);
  }

  /** 带当前范围打开加课弹窗：点「＋」与拖动松手共用。 */
  function openQuickCreate(target: EmptyTarget): void {
    onQuickCreate({
      dayOfWeek: target.day,
      periodStart: Math.min(target.start, target.end),
      periodEnd: Math.max(target.start, target.end),
      weeks: [data.viewWeek],
    });
    setEmptyTarget(null);
  }

  /**
   * 调整占位节次：delta > 0 向下扩展、delta < 0 向上扩展。
   * 只受节次上下限约束，与已有课重叠时给出提示、仍可继续。
   */
  function step(target: EmptyTarget, delta: number): void {
    let start = target.start;
    let end = target.end;
    if (delta > 0) end = Math.min(periodCount, end + delta);
    else if (start > 1) start = start - 1;
    start = Math.max(1, Math.min(start, end));
    setEmptyTarget({ day: target.day, start, end });
    warnClash(target.day, start, end);
  }

  /** 按下占位块（滚轮条或块本体）：记录起点，之后由 pointermove 改范围。 */
  function beginEmptyDrag(event: React.PointerEvent<HTMLElement>, mode: EmptyDragMode): void {
    const current = emptyRef.current;
    if (event.button !== 0 || current === null) return;
    // 必须挡住冒泡：列上的 pointerdown 会把已经选好的范围重置成单节
    event.stopPropagation();
    // 块内按钮（＋、上一节/下一节）不 preventDefault，免得影响它们自己的 click
    const onButton = event.target instanceof Element && event.target.closest('button') !== null;
    if (!onButton) event.preventDefault();
    emptyDrag.current = {
      pointerId: event.pointerId,
      mode,
      edge: emptyDragEdgeOf(event.currentTarget, event.clientY, current, mode),
      startY: event.clientY,
      startPeriod: current.start,
      endPeriod: current.end,
      moved: false,
    };
    if (mode === 'body') showEmptyVisual('body');
    // 这里刻意不 setPointerCapture：捕获会把后面的兼容鼠标事件也改派到块节点上，
    // 单击「＋」的 click 就落不到按钮上了；移动/抬手改由拖动期间的 window 监听兜住。
  }

  function showEmptyVisual(mode: EmptyDragMode | null): void {
    emptyVisual.current = mode !== null;
    setEmptyDragMode(mode);
  }

  /**
   * 空白格按下：记下按下的节次，不松手即可上下拖出范围；
   * 拖动期间沿用块本体的「两边一起扩」口径，松手直接进加课弹窗。
   */
  function beginSlotSelect(event: React.PointerEvent<HTMLElement>, period: number): void {
    emptyDrag.current = {
      pointerId: event.pointerId,
      mode: 'select',
      edge: 'both',
      startY: event.clientY,
      startPeriod: period,
      endPeriod: period,
      moved: false,
    };
  }

  function moveEmptyDrag(event: DragPointer): void {
    const active = emptyDrag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const current = emptyRef.current;
    if (current === null) return;
    event.preventDefault();
    const rows = Math.round((event.clientY - active.startY) / ROW_HEIGHT);
    if (active.mode === 'select') {
      // 按下的那一次若只是轻微抖动，仍算单击选格；真的跨了一节才当拖动
      if (rows !== 0) {
        active.moved = true;
        if (!emptyVisual.current) showEmptyVisual('select');
      }
    } else if (Math.abs(event.clientY - active.startY) > MOVE_TOLERANCE) {
      active.moved = true;
    }
    const range = active.mode === 'wheel' ? wheelRangeOf(active, rows) : bodyRangeOf(active, rows);
    setEmptyTarget({ day: current.day, start: range.start, end: range.end });
    warnClash(current.day, range.start, range.end);
  }

  /** 滚轮条：整段上下平移。 */
  function wheelRangeOf(active: EmptyDragState, rows: number): { start: number; end: number } {
    const start = Math.min(periodCount, Math.max(1, active.startPeriod + rows));
    const end = Math.min(periodCount, Math.max(start, active.endPeriod + rows));
    return { start, end };
  }

  /** 块本体：按住的那条边跟着指针走，另一边不动（起始单节时上下都算扩展）。 */
  function bodyRangeOf(active: EmptyDragState, rows: number): { start: number; end: number } {
    if (active.edge === 'top') {
      const start = Math.min(active.endPeriod, Math.max(1, active.startPeriod + rows));
      return { start, end: active.endPeriod };
    }
    if (active.edge === 'bottom') {
      const end = Math.min(periodCount, Math.max(active.startPeriod, active.endPeriod + rows));
      return { start: active.startPeriod, end };
    }
    const pointer = Math.min(periodCount, Math.max(1, active.startPeriod + rows));
    return {
      start: Math.min(active.startPeriod, pointer),
      end: Math.max(active.endPeriod, pointer),
    };
  }

  function endEmptyDrag(event: DragPointer): void {
    const active = emptyDrag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    emptyDrag.current = null;
    showEmptyVisual(null);
    lastClash.current = '';
    const current = emptyRef.current;
    if (current === null) return;
    if (active.mode === 'wheel') {
      const changed = current.start !== active.startPeriod || current.end !== active.endPeriod;
      if (changed) toast.success(`已调整为 ${formatPeriods(current.start, current.end)}`);
      return;
    }
    // 仅点击了块内空白：交给按钮自身的 click，本处不弹窗
    if (!active.moved) return;
    // 拖动松手：直接带着拖出来的范围打开加课弹窗；紧跟的那一次 click 不再生成占位块
    suppressSlotClick.current = true;
    window.clearTimeout(suppressSlotTimer.current);
    suppressSlotTimer.current = window.setTimeout(() => {
      suppressSlotClick.current = false;
    }, SUPPRESS_SLOT_CLICK_MS);
    openQuickCreate(current);
  }

  function cancelEmptyDrag(event: DragPointer): void {
    const active = emptyDrag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    emptyDrag.current = null;
    showEmptyVisual(null);
    lastClash.current = '';
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

  /** 长按 350ms 后进入拖动；未达时长前抬手仍是单击（打开课程详情）。停课的课次不参与拖动。 */
  function onLessonPointerDown(event: React.PointerEvent<HTMLDivElement>, lesson: LessonCell): void {
    // 每次按下都先复位一次性抑制标记，避免上一次拖动留下的状态吃掉这次单击
    suppressNextClick.current = false;
    if (event.button !== 0 || !lesson.inWeek || lesson.cancelled || lesson.movedOut || lesson.movedIn) return;
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

  /** 占位块本体（含空白格按下直接拖）拖动中：显示实时范围与重叠提示 */
  const bodyDragging = emptyDragMode === 'body' || emptyDragMode === 'select';

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
          description="可通过右上角添加课程，或到导入页从 ICS、CSV/Excel 与教务系统导入"
        />
      )}

      {/* 不横向滚动：列宽按容器等分，窄屏压缩节次轴与卡片间距；节次轴始终显示起止时间 */}
      <div className="rounded-lg border border-line bg-surface [--dt-axis:2.75rem] tablet:[--dt-axis:3.5rem]">
        <div>
          <div
            className="grid border-b border-line"
            style={{ gridTemplateColumns: `var(--dt-axis) repeat(${viewDays}, minmax(0, 1fr))` }}
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
                    'px-1 py-2 text-center text-[10px] tablet:px-2 tablet:text-xs',
                    isToday ? 'font-semibold text-primary-strong' : isHoliday ? 'text-muted' : 'text-ink',
                  )}
                >
                  <span className="flex flex-col items-center gap-0.5">
                    <span className="truncate">{label}</span>
                    <span className="tabular text-[9px] text-muted tablet:text-[10px]">{formatMonthDay(date)}</span>
                    {isToday && <span className="text-[9px] text-muted tablet:text-[10px]">今天</span>}
                    {isHoliday && <span className="text-[9px] text-muted tablet:text-[10px]">放假</span>}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `var(--dt-axis) repeat(${viewDays}, minmax(0, 1fr))`,
              height: `${periodCount * ROW_HEIGHT}px`,
            }}
          >
            <div className="relative border-r border-line">
              {slots.map((slot, index) => (
                <div
                  key={slot.periodNo}
                  className="absolute inset-x-0 flex flex-col items-center justify-center gap-0.5 border-b border-line text-[9px] text-muted tablet:text-[11px]"
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
              const columnDate = weekDayDate(data.weekStartDate, day);
              // 放假优先于非本周；多天假期只有第一天显示假期名称，之后只显示「放假」
              const holidayFirstDay = isHolidayRunStart(data, columnDate);
              const holidayName = data.holidayLabels.get(columnDate);
              const dayLessons = lessons
                .filter((lesson) => lesson.dayOfWeek === day)
                .filter((lesson) => lesson.inWeek || showOtherWeeks);
              const isDropColumn = drag !== null && drag.day === day;
              const placeholder = empty !== null && empty.day === day ? empty : null;
              const placeholderClash =
                placeholder === null
                  ? null
                  : firstClash(data, placeholder.day, placeholder.start, placeholder.end);
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
                    // 每次按下都复位一次性抑制标记，避免上一次拖动留下的状态吃掉这次点击
                    suppressSlotClick.current = false;
                    // 长按拖动课程卡时会冒泡到列上，此时不要弹占位块
                    if (session.current !== null) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const period = periodAt(event.clientY, bounds.top, periodCount);
                    // 已占用的格只清掉占位块，不进入拖动
                    if (occupied(data, day, period)) {
                      setEmptyTarget(null);
                      return;
                    }
                    pickEmpty(day, period);
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
                      className={cn(
                        'absolute inset-x-1 z-10 flex select-none flex-col items-stretch gap-1 overflow-hidden rounded-sm border-2 border-dashed border-primary-strong bg-surface px-1.5 py-1',
                        bodyDragging && 'ring-2 ring-primary-strong',
                      )}
                      style={{
                        top: `${(placeholder.start - 1) * ROW_HEIGHT + 2}px`,
                        height: `${Math.max(ROW_HEIGHT - 4, (placeholder.end - placeholder.start + 1) * ROW_HEIGHT - 4)}px`,
                        touchAction: 'none',
                      }}
                      data-role="empty-slot"
                      data-dragging={bodyDragging ? 'true' : undefined}
                      onPointerDown={(event) => beginEmptyDrag(event, 'body')}
                      onPointerMove={moveEmptyDrag}
                      onPointerUp={endEmptyDrag}
                      onPointerCancel={cancelEmptyDrag}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {/* 本体拖动区：除了中间的「＋」小按钮，整块区域都能按住拖动改节次 */}
                      <div className="relative flex min-h-0 flex-1 items-center justify-center">
                        <button
                          type="button"
                          aria-label="在此新建课程"
                          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-primary-strong hover:bg-surface-muted"
                          style={{ touchAction: 'none' }}
                          onClick={(event) => {
                            event.stopPropagation();
                            // 用当前范围（含滚轮/箭头/拖动调好的节次），不要重置成单节
                            const current = emptyRef.current;
                            if (current === null) return;
                            openQuickCreate(current);
                          }}
                        >
                          <Plus className="size-4" aria-hidden />
                        </button>
                        {bodyDragging && (
                          // 拖动中的实时反馈：盖在「＋」上的一层；pointer-events-none 让单击仍落在按钮上
                          <div
                            data-role="empty-drag-label"
                            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-sm bg-surface"
                          >
                            <span className="tabular rounded-sm bg-primary px-1.5 py-0.5 text-[11px] text-on-primary shadow-sm">
                              {formatPeriods(placeholder.start, placeholder.end)}
                            </span>
                            {placeholderClash !== null && (
                              <span
                                data-role="empty-clash"
                                className="max-w-full truncate text-[10px] text-danger-strong"
                              >
                                与「{placeholderClash.name}」重叠
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-center gap-1 text-[11px]">
                        <button
                          type="button"
                          aria-label="上一节"
                          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-muted hover:text-ink"
                          onClick={(event) => {
                            event.stopPropagation();
                            const current = emptyRef.current;
                            if (current !== null) step(current, -1);
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
                          onPointerDown={(event) => beginEmptyDrag(event, 'wheel')}
                          onPointerMove={moveEmptyDrag}
                          onPointerUp={endEmptyDrag}
                          onPointerCancel={cancelEmptyDrag}
                        >
                          {formatPeriods(placeholder.start, placeholder.end)}
                        </div>
                        <button
                          type="button"
                          aria-label="下一节"
                          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-muted hover:text-ink"
                          onClick={(event) => {
                            event.stopPropagation();
                            const current = emptyRef.current;
                            if (current !== null) step(current, 1);
                          }}
                        >
                          <ChevronDown className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  )}

                  {dayLessons.map((lesson) => {
                    // 自定义时间的条目按真实时间定位：把墙钟时间映射到节次行空间（行内线性）
                    const clockTop = customRow(lesson.customStart, slots, periodCount);
                    const clockBottom = customRow(lesson.customEnd, slots, periodCount);
                    const custom = clockTop !== null && clockBottom !== null;
                    const top = custom
                      ? Math.max(0, clockTop * ROW_HEIGHT + 2)
                      : (lesson.periodStart - 1) * ROW_HEIGHT + 2;
                    const height = custom
                      ? Math.max(24, (clockBottom - clockTop) * ROW_HEIGHT - 4)
                      : (lesson.periodEnd - lesson.periodStart + 1) * ROW_HEIGHT - 4;
                    return (
                    <div
                      key={`${lesson.courseId}-${lesson.periodStart}`}
                      className={cn('absolute inset-x-1 min-w-0', drag?.cell === lesson && 'opacity-40')}
                      data-custom-time={custom ? 'true' : undefined}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
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
                            <span
                              className="shrink-0 rounded-sm bg-surface px-1 text-[10px] text-accent-strong"
                              data-role="lab-label"
                            >
                              {lesson.eventLabel ?? '日程'}
                            </span>
                          ) : lesson.movedIn ? (
                            <span
                              className="shrink-0 rounded-sm bg-surface px-1 text-[10px] text-primary-strong"
                              data-role="moved-in-label"
                            >
                              调课
                            </span>
                          ) : undefined
                        }
                        holidayLabel={lesson.holiday && holidayFirstDay ? holidayName ?? '放假' : '放假'}
                        onClick={() => {
                          // 拖动收尾的那一次 click 只用来清标记，不打开详情
                          if (suppressNextClick.current) {
                            suppressNextClick.current = false;
                            return;
                          }
                          onSelectLesson(lesson);
                        }}
                        className={cn(
                          'h-full',
                          lesson.inWeek && !lesson.cancelled && !lesson.movedOut && !lesson.movedIn && !lesson.lab && 'cursor-grab select-none',
                        )}
                      />
                    </div>
                    );
                  })}
                </div>
              );
            })}

            {ratio !== null && data.viewWeek === data.week && (
              <NowIndicator ratio={ratio} className="left-[var(--dt-axis)]" />
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
