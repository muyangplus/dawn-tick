import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { addDays, dayOfWeek as nextDayOfWeek, weekOfDate } from '@dawn-tick/core';
import type { AppData, LessonCell } from '../data.ts';
import { CourseCard } from '../components/course-card.tsx';
import { NowIndicator } from '../components/now-indicator.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { cn } from '../lib/cn.ts';
import { gridMetrics, minuteOf, minuteToY, padLabel } from '../lib/grid-metrics.ts';
import { localMinuteOfDay } from '../lib/timeline.ts';
import { ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, nextRowHeight, rowHeightFor, type CardMeasurement } from '../lib/row-height.ts';
import { logDebug, logWarn } from '../log.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
/** 同一宽度下最多连调两次行高：滚动条出现/消失会让宽度抖动，再调就会来回跳。 */
const MAX_ROW_HEIGHT_ADJUSTS = 2;
const ROW_HEIGHT_ADJUST_WINDOW_MS = 3000;
/** 长按多久才进入拖动（毫秒），未达时长按单击处理。 */
const LONG_PRESS_MS = 350;
/** 长按期间允许的手指/鼠标抖动半径（像素），超过就取消长按。 */
const MOVE_TOLERANCE = 8;
/** 拖动占位块松手后，抑制紧随那次 click 的时间窗（毫秒）。 */
const SUPPRESS_SLOT_CLICK_MS = 500;

/** 表头显示月日。 */
function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** 日期区间文案：同月省略重复的月份，例如 8/19–23。 */
function formatDateRange(from: string, to: string): string {
  if (from === to) return formatMonthDay(from);
  const [fromYear, fromMonth] = from.split('-');
  const [toYear, toMonth] = to.split('-');
  if (fromYear === toYear && fromMonth === toMonth) return `${formatMonthDay(from)}–${Number(to.split('-')[2])}`;
  return `${formatMonthDay(from)}–${formatMonthDay(to)}`;
}

/** 节次范围文案：单节显示「第 3 节」，连堂显示「第 3–4 节」。 */
function formatPeriods(start: number, end: number): string {
  return start === end ? `第 ${start} 节` : `第 ${start}–${end} 节`;
}

/** 多天假期第一天：当天放假且前一天不放假。 */
/** 放假判定用 data.holidayLabels（内置节假日 ∪ 手工 holiday，已扣除手工非假日）。 */
function isHolidayRunStart(data: AppData, date: string): boolean {
  if (!data.holidayLabels.has(date)) return false;
  return !data.holidayLabels.has(addDays(date, -1));
}

/** 连堂与「停课」等占多节的条目：节次落在其覆盖范围内即算该格被占用。 */
function occupied(data: AppData, date: string, period: number): boolean {
  for (let current = period; current >= 1; current -= 1) {
    const cells = data.grid.get(`${date}:${current}`) ?? [];
    if (cells.some((cell) => period >= current && period <= Math.max(cell.periodStart, cell.periodEnd))) return true;
  }
  return false;
}

/** 落点所在的节次（按列高度换算，越界夹到首尾节）；padTop 是头部补白的高度。 */
function periodAt(
  clientY: number,
  columnTop: number,
  periodCount: number,
  rowHeightPx: number,
  padTop = 0,
): number {
  return Math.min(periodCount, Math.max(1, Math.floor((clientY - columnTop - padTop) / rowHeightPx) + 1));
}

/** 该范围里已经排了哪些课（同一门课的连堂只算一次）。 */
function clashingLessons(data: AppData, date: string, start: number, end: number): LessonCell[] {
  const out: LessonCell[] = [];
  const seen = new Set<string>();
  for (const list of data.grid.values()) {
    for (const cell of list) {
      if (!cell.inWeek || cell.date !== date) continue;
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
function firstClash(data: AppData, date: string, start: number, end: number): Clash | null {
  const cell = clashingLessons(data, date, start, end)[0];
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
  /** 目标日期（YYYY-MM-DD）：空白格与拖动落点都按日期定位 */
  date: string;
  start: number;
  end: number;
}

interface DragState {
  cell: LessonCell;
  date: string;
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

/** 块本体拖动时跟着指针的边：both 为上下都扩展，否则按按住位置取 top / bottom。 */
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
  /** 非本周课程是否用虚线显示 */
  showOtherWeeks: boolean;
  onSelectLesson: (cell: LessonCell) => void;
  /** 拖动落点的日期与节次 */
  onMoveLesson: (cell: LessonCell, date: string, period: number) => void;
  /** 点击空白格后，确认在这里新建课程 */
  onQuickCreate: (preset: QuickCreatePreset) => void;
  onPrevWindow: () => void;
  onNextWindow: () => void;
}

function lessonsOf(data: AppData): LessonCell[] {
  const out: LessonCell[] = [];
  for (const list of data.grid.values()) out.push(...list);
  return out;
}

/** 量一次课表卡片：卡片内容高度 + 它占几节，交给行高换算。 */
function measureCards(): CardMeasurement[] {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-role="course-card"]')).filter(
    (card) => card.closest('[data-role="drag-ghost"]') === null && card.closest('[data-custom-time]') === null,
  );
  return cards.map((card) => {
    const cell = card.closest<HTMLElement>('[data-role="lesson-cell"]');
    return {
      span: Number(cell?.dataset.span ?? '0'),
      contentHeight: card.scrollHeight,
    };
  });
}

export function WeekView({
  data,
  showOtherWeeks,
  onSelectLesson,
  onMoveLesson,
  onQuickCreate,
  onPrevWindow,
  onNextWindow,
}: WeekViewProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [empty, setEmpty] = useState<EmptyTarget | null>(null);
  const [emptyDragMode, setEmptyDragMode] = useState<EmptyDragMode | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** 行高：按卡片内容量一次直接定高，范围 56–96，避免个别长标题把整页撑开 */
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_MIN);
  const rowHeightRef = useRef(ROW_HEIGHT_MIN);
  /** 上次量行高时的容器宽度：宽度没变就不重复量，避免滚动条宽度抖动引起反复调整 */
  const measuredWidth = useRef<number | null>(null);
  /** 同一宽度下的连续调整次数与起始时刻：超过上限就停在当前值 */
  const adjustCount = useRef(0);
  const adjustStart = useRef(0);
  const touchStart = useRef<number | null>(null);
  const session = useRef<DragSession | null>(null);
  const suppressNextClick = useRef(false);
  const columns = useRef(new Map<string, HTMLElement>());
  const dropRef = useRef<{ date: string; period: number } | null>(null);
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
  const lessons = useMemo(() => lessonsOf(data), [data]);
  /** 补白只由真正画出来的格子决定：非本周课程按设置隐藏时不参与 */
  const shownLessons = useMemo(
    () => lessons.filter((lesson) => lesson.inWeek || showOtherWeeks),
    [lessons, showOtherWeeks],
  );
  const periodCount = slots.length;
  /** 头部/尾部补白随自定义时间条目伸缩：节次轴、时间线与拖动换算都跟着平移 */
  const metrics = useMemo(() => gridMetrics(slots, shownLessons, rowHeight), [slots, shownLessons, rowHeight]);
  const gridHeight = metrics.padTop + periodCount * rowHeight + metrics.padBottom;
  const nowMinute = localMinuteOfDay(nowTick, data.timeZone);
  const ratio =
    gridHeight === 0 ? null : minuteToY(nowMinute, slots, rowHeight, metrics) / gridHeight;

  /** 量一次卡片内容并直接定行高：只有内容挤不下才加高，收回要留余量，不会来回跳。 */
  const applyRowHeight = useCallback((force: boolean): void => {
    const section = sectionRef.current;
    if (section === null) return;
    const width = Math.round(section.getBoundingClientRect().width);
    if (!force && measuredWidth.current === width) return;
    measuredWidth.current = width;
    const cards = measureCards();
    if (cards.length === 0) return;
    const current = rowHeightRef.current;
    const next = nextRowHeight(current, cards);
    if (next === current) return;
    const now = Date.now();
    if (now - adjustStart.current > ROW_HEIGHT_ADJUST_WINDOW_MS) {
      adjustStart.current = now;
      adjustCount.current = 0;
    }
    adjustCount.current += 1;
    if (adjustCount.current > MAX_ROW_HEIGHT_ADJUSTS) {
      logWarn('layout', '行高反复调整，停在当前值', { rowHeight: current, target: next, cards: cards.length });
      return;
    }
    logDebug('layout', '行高按内容定一次', { from: current, to: next, cards: cards.length });
    rowHeightRef.current = next;
    setRowHeight(next);
  }, []);

  // 课表数据变化后量一次（内容变了可能要加高）
  useEffect(() => {
    measuredWidth.current = null;
    const handle = globalThis.requestAnimationFrame(() => applyRowHeight(true));
    return () => globalThis.cancelAnimationFrame(handle);
  }, [data, applyRowHeight]);

  // 容器宽度变化后重量一次（窗口缩放、桌面侧栏开关都会改变换行）
  useEffect(() => {
    const section = sectionRef.current;
    if (section === null || typeof globalThis.ResizeObserver !== 'function') return;
    let frame = 0;
    const observer = new globalThis.ResizeObserver(() => {
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
      frame = globalThis.requestAnimationFrame(() => {
        frame = 0;
        applyRowHeight(false);
      });
    });
    observer.observe(section);
    return () => {
      observer.disconnect();
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
    };
  }, [applyRowHeight]);

  // 字体加载完成后重量一次：字体替换会改变换行与内容高度
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready === undefined) return;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (!cancelled) applyRowHeight(true);
    });
    return () => {
      cancelled = true;
    };
  }, [applyRowHeight]);

  // 真实窗口里的行高自检：启动时日志级别还没同步到原生，等布局稳定后再量一次并留痕
  useEffect(() => {
    const timer = setTimeout(() => {
      const cards = measureCards();
      if (cards.length === 0) return;
      const target = rowHeightFor(cards);
      logDebug('layout', '行高自检', { rowHeight: rowHeightRef.current, target, cards: cards.length });
      if (target !== null && target >= ROW_HEIGHT_MAX) {
        logWarn('layout', '行高已到上限仍有内容被裁', { rowHeight: rowHeightRef.current, target, cards: cards.length });
      }
    }, 2500);
    return () => clearTimeout(timer);
    // 只在挂载后量一次：后续行高变化由上面的测量逻辑负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 拖动占位块期间 move/up/cancel 挂在 window：指针离开块体或指针捕获未生效时块节点收不到 pointermove。
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
    if (next === null || previous === null || next.date !== previous.date) lastClash.current = '';
  }

  /** 点到空白格：先给出一个「目标节次 + 单节」的虚线占位块。 */
  function pickEmpty(date: string, period: number): void {
    if (occupied(data, date, period)) {
      setEmptyTarget(null);
      return;
    }
    setEmptyTarget({ date, start: period, end: period });
  }

  /** 范围落进已有课时提醒一次：课程允许重叠，这里只提示、不拦截。 */
  function warnClash(date: string, start: number, end: number): void {
    const clash = firstClash(data, date, start, end);
    const key = clash === null ? '' : `${clash.name}:${clash.start}-${clash.end}`;
    if (key === lastClash.current) return;
    lastClash.current = key;
    if (clash !== null) toast.info(`${clashLabel(clash)}，仍可继续新建`);
  }

  /** 带当前范围打开加课弹窗：点「＋」与拖动松手共用；预填的周次取该列日期所在的周。 */
  function openQuickCreate(target: EmptyTarget): void {
    onQuickCreate({
      dayOfWeek: nextDayOfWeek(target.date),
      periodStart: Math.min(target.start, target.end),
      periodEnd: Math.max(target.start, target.end),
      weeks: [data.semester === null ? data.viewWeek : weekOfDate(target.date, data.semester.start_date)],
    });
    setEmptyTarget(null);
  }

  /** 调整占位节次：delta > 0 向下、delta < 0 向上；只受节次上下限约束，重叠仍可继续。 */
  function step(target: EmptyTarget, delta: number): void {
    let start = target.start;
    let end = target.end;
    if (delta > 0) end = Math.min(periodCount, end + delta);
    else if (start > 1) start = start - 1;
    start = Math.max(1, Math.min(start, end));
    setEmptyTarget({ date: target.date, start, end });
    warnClash(target.date, start, end);
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
    // 不 setPointerCapture：会改派兼容鼠标事件，单击「＋」的 click 落不到按钮；move/up 由 window 监听兜住。
  }

  function showEmptyVisual(mode: EmptyDragMode | null): void {
    emptyVisual.current = mode !== null;
    setEmptyDragMode(mode);
  }

  /** 空白格按下：记下按下节次，不松手可上下拖出范围；拖动沿用「两边一起扩」，松手进加课弹窗。 */
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
    const rows = Math.round((event.clientY - active.startY) / rowHeight);
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
    setEmptyTarget({ date: current.date, start: range.start, end: range.end });
    warnClash(current.date, range.start, range.end);
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

  function targetCellOf(clientX: number, clientY: number): { date: string; period: number } | null {
    for (const [date, element] of columns.current) {
      const bounds = element.getBoundingClientRect();
      if (clientX < bounds.left || clientX > bounds.right) continue;
      return { date, period: periodAt(clientY, bounds.top, periodCount, rowHeight, metrics.padTop) };
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
        date: dropRef.current?.date ?? lesson.date,
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
            date: drop?.date ?? current.date,
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
    // 落回原处（同一天同一节）不算调整
    if (drop.date === lesson.date && drop.period === lesson.periodStart) return;
    const span = lesson.periodEnd - lesson.periodStart + 1;
    const period = Math.min(periodCount - span + 1, Math.max(1, drop.period));
    onMoveLesson(lesson, drop.date, period);
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
        if (delta > 0) onPrevWindow();
        else onNextWindow();
      }}
    >
      {!data.hasLessons && (
        <EmptyState
          title={
            data.windowDates.length <= 1
              ? `${formatMonthDay(data.windowStart)} 没有课程`
              : `${formatDateRange(data.windowStart, data.windowDates[data.windowDates.length - 1] as string)} 没有课程`
          }
          description="从右上角加课，或到导入页导入"
        />
      )}

      {/* 不横向滚动：列宽按容器等分，窄屏压缩节次轴与卡片间距；节次轴始终显示起止时间 */}
      <div className="rounded-lg border border-line bg-surface [--dt-axis:2.75rem] tablet:[--dt-axis:3.5rem]">
        <div>
          <div
            className="grid border-b border-line"
            style={{ gridTemplateColumns: `var(--dt-axis) repeat(${data.windowDates.length}, minmax(0, 1fr))` }}
          >
            <div className="px-2 py-2 text-center text-xs text-muted">节次</div>
            {data.windowDates.map((date) => {
              const label = WEEKDAYS[nextDayOfWeek(date) - 1] ?? '';
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
              gridTemplateColumns: `var(--dt-axis) repeat(${data.windowDates.length}, minmax(0, 1fr))`,
              height: `${gridHeight}px`,
            }}
          >
            <div className="relative border-r border-line">
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

            {/* 头部/尾部补白：只有自定义时间条目超出节次范围时才出现，标出真实时间范围 */}
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

            {data.windowDates.map((columnDate) => {
              const isToday = columnDate === data.today;
              // 放假优先于非本周；多天假期只有第一天显示假期名称，之后只显示「放假」
              const holidayFirstDay = isHolidayRunStart(data, columnDate);
              const holidayName = data.holidayLabels.get(columnDate);
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
                    <div
                      className={cn(
                        'absolute inset-x-1 z-10 flex select-none flex-col items-stretch gap-1 overflow-hidden rounded-sm border-2 border-dashed border-primary-strong bg-surface px-1.5 py-1',
                        bodyDragging && 'ring-2 ring-primary-strong',
                      )}
                      style={{
                        top: `${metrics.padTop + (placeholder.start - 1) * rowHeight + 2}px`,
                        height: `${Math.max(rowHeight - 4, (placeholder.end - placeholder.start + 1) * rowHeight - 4)}px`,
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
                    return (
                    <div
                      key={`${lesson.courseId}-${lesson.periodStart}`}
                      className={cn('absolute inset-x-1 min-w-0', drag?.cell === lesson && 'opacity-40')}
                      data-role="lesson-cell"
                      data-span={Math.max(1, lesson.periodEnd - lesson.periodStart + 1)}
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
                              className="inline-block rounded-sm bg-surface px-1 text-[10px] text-accent-strong"
                              data-role="lab-label"
                            >
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

            {ratio !== null && data.windowDates.includes(data.today) && (
              <NowIndicator ratio={ratio} className="left-[var(--dt-axis)]" />
            )}
          </div>
        </div>
      </div>

      {drag !== null && (
        <div
          aria-hidden
          data-role="drag-ghost"
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
