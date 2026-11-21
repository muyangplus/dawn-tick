import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LessonCell } from '../../data.ts';
import {
  LONG_PRESS_MS,
  beginLessonPress,
  lessonBlocksScroll,
  lessonDraggable,
  lessonDropChanged,
  lessonDropPeriod,
  lessonLongPress,
  lessonPressMove,
  type LessonPress,
} from './drag-session.ts';

export interface DragState {
  cell: LessonCell;
  date: string;
  period: number;
  x: number;
  y: number;
}

/** 拖动中的课次会话：纯状态在 drag-session，按时器与捕获节点留在 hook。 */
export interface LessonDragSession extends LessonPress {
  lesson: LessonCell;
  timer: number;
  /** 长按生效后接收指针事件的卡片节点：指针移出卡片后事件仍可达 */
  element: HTMLElement | null;
}

export type DropCell = { date: string; period: number };

export interface LessonDragOptions {
  sectionRef: RefObject<HTMLElement | null>;
  /** 指针位置换算成落点列与节次；每次渲染传入最新的一份 */
  targetCellOf: (clientX: number, clientY: number) => DropCell | null;
  periodCount: number;
  onMoveLesson: (cell: LessonCell, date: string, period: number) => void;
}

/**
 * 课程卡长按/拖动调课。处理函数每次渲染重建（与原先写在组件里一致），
 * 跨事件共享的会话、落点与单击抑制标记都放在 ref 里，事件里不读 state。
 */
export function useLessonDrag({ sectionRef, targetCellOf, periodCount, onMoveLesson }: LessonDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const session = useRef<LessonDragSession | null>(null);
  const suppressNextClick = useRef(false);
  const dropRef = useRef<DropCell | null>(null);

  useEffect(
    () => () => {
      if (session.current !== null) window.clearTimeout(session.current.timer);
    },
    [],
  );

  // 卡片留 pan-y 让页面能滚；长按拖起来后在这里拦下 touchmove，拖动时页面不跟着滚。
  // React 的触摸监听是被动的，preventDefault 无效，只能原生挂非被动监听。
  useEffect(() => {
    const section = sectionRef.current;
    if (section === null) return;
    const onTouchMove = (event: TouchEvent): void => {
      if (lessonBlocksScroll(session.current) && event.cancelable) event.preventDefault();
    };
    section.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => section.removeEventListener('touchmove', onTouchMove);
  }, []);

  function clearSession(): void {
    const active = session.current;
    if (active === null) return;
    window.clearTimeout(active.timer);
    session.current = null;
  }

  function releaseCapture(active: LessonDragSession): void {
    if (!active.captured) return;
    active.captured = false;
    try {
      active.element?.releasePointerCapture(active.pointerId);
    } catch {
      // 同 setPointerCapture：不支持时忽略
    }
  }

  /** 长按生效（或鼠标拖起来）：把这次课次挂到拖动鬼影上，落点按按下位置算。 */
  function startLessonDrag(active: LessonDragSession, x: number, y: number): void {
    active.active = true;
    dropRef.current = targetCellOf(x, y);
    setDrag({
      cell: active.lesson,
      date: dropRef.current?.date ?? active.lesson.date,
      period: dropRef.current?.period ?? active.lesson.periodStart,
      x,
      y,
    });
  }

  /**
   * 课次卡片的拖动入口：触屏长按 350ms，鼠标/触控笔越过抖动阈值即可拖；
   * 指针捕获推迟到真正移动之后（先让滚动与单击优先）。停课等不参与拖动的卡片直接跳过。
   */
  function onLessonPointerDown(event: React.PointerEvent<HTMLDivElement>, lesson: LessonCell): void {
    // 每次按下都先复位一次性抑制标记，避免上一次拖动留下的状态吃掉这次单击
    suppressNextClick.current = false;
    if (event.button !== 0 || !lessonDraggable(lesson)) return;
    clearSession();
    const active: LessonDragSession = {
      ...beginLessonPress({
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
      }),
      lesson,
      timer: 0,
      element: event.currentTarget,
    };
    active.timer = window.setTimeout(() => {
      if (session.current !== active || !lessonLongPress(active)) return;
      startLessonDrag(active, active.startX, active.startY);
    }, LONG_PRESS_MS);
    session.current = active;
  }

  function onLessonPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const active = session.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const step = lessonPressMove(active, event.clientX, event.clientY);
    if (step.outcome === 'cancel') {
      clearSession();
      return;
    }
    if (step.outcome === 'activate') {
      window.clearTimeout(active.timer);
      startLessonDrag(active, event.clientX, event.clientY);
    }
    if (step.capture && !active.captured) {
      active.captured = true;
      try {
        active.element?.setPointerCapture(active.pointerId);
      } catch {
        // 某些环境（jsdom 等）不支持指针捕获，退化为普通事件流
      }
    }
    if (!active.active) return;
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
    if (!lessonDropChanged(lesson, drop.date, drop.period)) return;
    onMoveLesson(lesson, drop.date, lessonDropPeriod(drop.period, lesson, periodCount));
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

  return {
    drag,
    session,
    suppressNextClick,
    onLessonPointerDown,
    onLessonPointerMove,
    onLessonPointerUp,
    onLessonPointerCancel,
  };
}
