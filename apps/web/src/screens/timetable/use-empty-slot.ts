import { useEffect, useRef, useState, type RefObject } from 'react';
import { dayOfWeek as nextDayOfWeek, weekOfDate } from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import { toast } from '../../components/ui/toaster.tsx';
import { formatPeriodRange } from '../../lib/format.ts';
import {
  MOVE_TOLERANCE,
  SUPPRESS_SLOT_CLICK_MS,
  bodyRangeOf,
  clashLabel,
  dragRows,
  emptyDragEdgeOf,
  firstClash,
  resizeEmptyRange,
  stepEmptyRange,
  wheelRangeOf,
  type EmptyDragMode,
  type EmptyDragState,
  type EmptyTarget,
} from './drag-session.ts';
import { occupied } from './week-grid-helpers.ts';
import { weekCopy } from '../../copy/timetable-week.ts';

/** 拖动过程中需要的最小指针信息：React 合成事件与原生 PointerEvent 都满足。 */
export type DragPointer = Pick<PointerEvent, 'pointerId' | 'clientY' | 'preventDefault'>;

/** 与 QuickCreatePreset 同形，避免反向依赖 week-view。 */
interface QuickCreateRange {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
}

export interface EmptySlotOptions {
  data: AppData;
  periodCount: number;
  rowHeight: number;
  sectionRef: RefObject<HTMLElement | null>;
  onQuickCreate: (preset: QuickCreateRange) => void;
}

/**
 * 空白格占位块：点选、滚轮/方向键/拖动改节次范围，确认后带范围打开加课弹窗。
 * 处理函数每次渲染重建；window 监听里读的当前范围与拖动状态都走 ref，避免拿到过期值。
 */
export function useEmptySlot({ data, periodCount, rowHeight, sectionRef, onQuickCreate }: EmptySlotOptions) {
  const [empty, setEmpty] = useState<EmptyTarget | null>(null);
  const [emptyDragMode, setEmptyDragMode] = useState<EmptyDragMode | null>(null);
  const emptyRef = useRef<EmptyTarget | null>(null);
  const wheelAt = useRef(0);
  const emptyDrag = useRef<EmptyDragState | null>(null);
  /** 是否已显示拖动中的实时反馈：pointermove 里不读 state，避免拿到过期值 */
  const emptyVisual = useRef(false);
  /** 拖动占位块松手后紧跟着的那次 click：只用来清标记，不再生成占位块 */
  const suppressSlotClick = useRef(false);
  const suppressSlotTimer = useRef(0);
  /** 已经播报过的重叠提示，拖动过程中同一处只提示一次 */
  const lastClash = useRef('');

  useEffect(() => () => window.clearTimeout(suppressSlotTimer.current), []);

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
    if (clash !== null) toast.info(weekCopy.clashCanContinue(clashLabel(clash)));
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
    const next = stepEmptyRange(target, delta, periodCount);
    setEmptyTarget(next);
    warnClash(next.date, next.start, next.end);
  }

  /** 键盘调范围：↓ 把结束节向下扩一节（最多到总节数），↑ 收回一节（最少回到起始节）。 */
  function resizeRange(target: EmptyTarget, direction: -1 | 1): void {
    const next = resizeEmptyRange(target, direction, periodCount);
    if (next === null) return;
    setEmptyTarget(next);
    warnClash(next.date, next.start, next.end);
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
      edge: emptyDragEdgeOf(event.currentTarget.getBoundingClientRect(), event.clientY, current, mode),
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
    const rows = dragRows(active.startY, event.clientY, rowHeight);
    if (active.mode === 'select') {
      // 按下的那一次若只是轻微抖动，仍算单击选格；真的跨了一节才当拖动
      if (rows !== 0) {
        active.moved = true;
        if (!emptyVisual.current) showEmptyVisual('select');
      }
    } else if (Math.abs(event.clientY - active.startY) > MOVE_TOLERANCE) {
      active.moved = true;
    }
    const range =
      active.mode === 'wheel' ? wheelRangeOf(active, rows, periodCount) : bodyRangeOf(active, rows, periodCount);
    setEmptyTarget({ date: current.date, start: range.start, end: range.end });
    warnClash(current.date, range.start, range.end);
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
      if (changed) toast.success(weekCopy.rangeAdjusted(formatPeriodRange(current.start, current.end)));
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

  /** 占位块本体（含空白格按下直接拖）拖动中：显示实时范围与重叠提示 */
  const bodyDragging = emptyDragMode === 'body' || emptyDragMode === 'select';

  return {
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
  };
}
