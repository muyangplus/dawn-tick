import { rangesOverlap } from '@dawn-tick/core';
import type { AppData, LessonCell } from '../../data.ts';
import { formatPeriodRange } from '../../lib/format.ts';

/** 长按多久才进入拖动（毫秒），未达时长按单击处理。 */
export const LONG_PRESS_MS = 350;
/** 长按期间允许的手指/鼠标抖动半径（像素），超过就取消长按。 */
export const MOVE_TOLERANCE = 8;
/** 拖动占位块松手后，抑制紧随那次 click 的时间窗（毫秒）。 */
export const SUPPRESS_SLOT_CLICK_MS = 500;

/** 占位块的目标范围（按日期定位，一天一列）。 */
export interface EmptyTarget {
  /** 目标日期（YYYY-MM-DD）：空白格与拖动落点都按日期定位 */
  date: string;
  start: number;
  end: number;
}

/** 占位块的拖动方式：滚轮条整段平移，块本体按边伸缩，空白格按下直接拖出范围。 */
export type EmptyDragMode = 'wheel' | 'body' | 'select';

/** 块本体拖动时跟着指针的边：both 为上下都扩展，否则按按住位置取 top / bottom。 */
export type EmptyDragEdge = 'both' | 'top' | 'bottom';

/** 一次占位块拖动的状态：只记指针起点与范围，界面状态仍由视图持有。 */
export interface EmptyDragState {
  pointerId: number;
  mode: EmptyDragMode;
  edge: EmptyDragEdge;
  startY: number;
  startPeriod: number;
  endPeriod: number;
  /** 是否已经超过点击抖动阈值：仅实际拖动过才在松手时弹窗 */
  moved: boolean;
}

/** 重叠的课程：面提示只用来提醒，不拦截。 */
export interface Clash {
  name: string;
  start: number;
  end: number;
}

/** 落点所在的节次（按列高度换算，越界夹到首尾节）；padTop 是头部补白的高度。 */
export function periodAt(
  clientY: number,
  columnTop: number,
  periodCount: number,
  rowHeightPx: number,
  padTop = 0,
): number {
  return Math.min(periodCount, Math.max(1, Math.floor((clientY - columnTop - padTop) / rowHeightPx) + 1));
}

/** 指针相对按下点移动了几节（四舍五入，正数向下）。 */
export function dragRows(startY: number, clientY: number, rowHeightPx: number): number {
  return Math.round((clientY - startY) / rowHeightPx);
}

/** 按住的位置决定哪条边跟着指针：单节时上下都算扩展，否则按上半/下半取边。 */
export function emptyDragEdgeOf(
  bounds: { top: number; height: number },
  clientY: number,
  target: EmptyTarget,
  mode: EmptyDragMode,
): EmptyDragEdge {
  if (mode === 'wheel' || target.start === target.end) return 'both';
  return clientY < bounds.top + bounds.height / 2 ? 'top' : 'bottom';
}

/** 滚轮 / 键盘调范围：delta > 0 向下、delta < 0 向上；只受节次上下限约束，重叠仍可继续。 */
export function stepEmptyRange(target: EmptyTarget, delta: number, periodCount: number): EmptyTarget {
  let start = target.start;
  let end = target.end;
  if (delta > 0) end = Math.min(periodCount, end + delta);
  else if (start > 1) start = start - 1;
  start = Math.max(1, Math.min(start, end));
  return { date: target.date, start, end };
}

/** 键盘调范围：↓ 把结束节向下扩一节（最多到总节数），↑ 收回一节（最少回到起始节）；没变化返回 null。 */
export function resizeEmptyRange(
  target: EmptyTarget,
  direction: -1 | 1,
  periodCount: number,
): EmptyTarget | null {
  const end = Math.min(periodCount, Math.max(target.start, target.end + direction));
  if (end === target.end) return null;
  return { date: target.date, start: target.start, end };
}

/** 滚轮条：整段上下平移。 */
export function wheelRangeOf(
  active: EmptyDragState,
  rows: number,
  periodCount: number,
): { start: number; end: number } {
  const start = Math.min(periodCount, Math.max(1, active.startPeriod + rows));
  const end = Math.min(periodCount, Math.max(start, active.endPeriod + rows));
  return { start, end };
}

/** 块本体：按住的那条边跟着指针走，另一边不动（起始单节时上下都算扩展）。 */
export function bodyRangeOf(
  active: EmptyDragState,
  rows: number,
  periodCount: number,
): { start: number; end: number } {
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

/** 拖动落点换算成课次起始节：整段课要能放进窗口，越界夹回。 */
export function lessonDropPeriod(dropPeriod: number, lesson: LessonCell, periodCount: number): number {
  const span = lesson.periodEnd - lesson.periodStart + 1;
  return Math.min(periodCount - span + 1, Math.max(1, dropPeriod));
}

/** 课次卡片是否参与拖动：本周的普通课程；停课、已调课、调课落点、实验与虚线课都不拖。 */
export function lessonDraggable(
  lesson: Pick<LessonCell, 'inWeek' | 'cancelled' | 'movedOut' | 'movedIn' | 'lab'>,
): boolean {
  return lesson.inWeek && !lesson.cancelled && !lesson.movedOut && !lesson.movedIn && !lesson.lab;
}

/**
 * 卡片占用的触摸手势：只有可拖动的卡片才独占手势（none），
 * 停课/已调课/非本周等不参与拖动的卡片一律留纵向滚动（pan-y），页面照常滚。
 */
export function lessonTouchAction(lesson: Parameters<typeof lessonDraggable>[0]): 'none' | 'pan-y' {
  return lessonDraggable(lesson) ? 'none' : 'pan-y';
}

/**
 * 课次卡片的一次按压：计时器、指针捕获节点由视图持有，
 * 这里只记指针起点与阶段，判定都做成纯函数。
 */
export interface LessonPress {
  pointerId: number;
  /** 指针类型：touch 走长按，鼠标/触控笔移动越过阈值即拖 */
  pointerType: string;
  startX: number;
  startY: number;
  /** 长按生效（或鼠标越过阈值）后进入拖动 */
  active: boolean;
  /** 已请求过指针捕获：只在真正移动越过阈值后做一次 */
  captured: boolean;
}

/** 按下时建立按压状态：此时还不算拖动。 */
export function beginLessonPress(input: {
  pointerId: number;
  pointerType: string | null | undefined;
  x: number;
  y: number;
}): LessonPress {
  return {
    pointerId: input.pointerId,
    // jsdom 等环境拿不到 pointerType 时按鼠标处理：移动即可拖，长按也仍然有效
    pointerType: input.pointerType === 'touch' ? 'touch' : 'pointer',
    startX: input.x,
    startY: input.y,
    active: false,
    captured: false,
  };
}

/** 长按计时器到点是否进入拖动：已经拖起来（鼠标抢先）就不再重复触发。 */
export function lessonLongPress(press: LessonPress): boolean {
  return !press.active;
}

export type LessonPressOutcome = 'ignore' | 'cancel' | 'activate';

/**
 * 长按期间的指针移动：
 * - touch 移动越过抖动阈值 → 取消长按（这一下是滚动/滑动，不是按住拖动）；
 * - 鼠标/触控笔移动越过阈值 → 立即进入拖动，不必等满长按时长（回归：新建课程「拖不动」）；
 * - 已进入拖动后越过阈值 → 请求一次指针捕获，之后的移动不再依赖卡片节点。
 */
export function lessonPressMove(
  press: LessonPress,
  x: number,
  y: number,
): { outcome: LessonPressOutcome; capture: boolean } {
  const moved = Math.hypot(x - press.startX, y - press.startY) > MOVE_TOLERANCE;
  if (press.active) return { outcome: 'ignore', capture: !press.captured && moved };
  if (!moved) return { outcome: 'ignore', capture: false };
  if (press.pointerType === 'touch') return { outcome: 'cancel', capture: false };
  return { outcome: 'activate', capture: true };
}

/** 落点是否真的换了位置：同一天同一节松手不算调整。 */
export function lessonDropChanged(lesson: Pick<LessonCell, 'date' | 'periodStart'>, date: string, period: number): boolean {
  return lesson.date !== date || lesson.periodStart !== period;
}

/** 该范围里已经排了哪些课（同一门课的连堂只算一次）。 */
export function clashingLessons(data: AppData, date: string, start: number, end: number): LessonCell[] {
  const out: LessonCell[] = [];
  const seen = new Set<string>();
  for (const list of data.grid.values()) {
    for (const cell of list) {
      if (!cell.inWeek || cell.date !== date) continue;
      if (!rangesOverlap(cell.periodStart, cell.periodEnd, start, end)) continue;
      if (seen.has(cell.scheduleId)) continue;
      seen.add(cell.scheduleId);
      out.push(cell);
    }
  }
  return out;
}

/** 范围里第一门重叠的课，用课程全名，提示文案更清楚。 */
export function firstClash(data: AppData, date: string, start: number, end: number): Clash | null {
  const cell = clashingLessons(data, date, start, end)[0];
  if (cell === undefined) return null;
  const name = data.courses.find((course) => course.id === cell.courseId)?.name ?? cell.name;
  return { name, start: cell.periodStart, end: cell.periodEnd };
}

/** 重叠提示：与「高等数学」第 1–2 节重叠。 */
export function clashLabel(clash: Clash): string {
  return `与「${clash.name}」${formatPeriodRange(clash.start, clash.end)}重叠`;
}
