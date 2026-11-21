import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { measureCards } from './week-grid-helpers.ts';
import { ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, nextRowHeight, rowHeightFor } from '../../lib/row-height.ts';
import { logDebug, logWarn } from '../../log.ts';

/** 同一宽度下最多连调两次行高：滚动条出现/消失会让宽度抖动，再调就会来回跳。 */
const MAX_ROW_HEIGHT_ADJUSTS = 2;
const ROW_HEIGHT_ADJUST_WINDOW_MS = 3000;

/**
 * 周视图行高：按卡片内容量一次直接定高（56–96），避免个别长标题把整页撑开。
 * 数据变化、容器宽度变化、字体加载完成时各重量一次；同一宽度下连调超过上限就停住。
 */
export function useRowHeight(sectionRef: RefObject<HTMLElement | null>, data: unknown): number {
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_MIN);
  const rowHeightRef = useRef(ROW_HEIGHT_MIN);
  /** 上次量行高时的容器宽度：宽度没变就不重复量 */
  const measuredWidth = useRef<number | null>(null);
  const adjustCount = useRef(0);
  const adjustStart = useRef(0);

  const apply = useCallback(
    (force: boolean): void => {
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
        logWarn('timetable', '行高反复调整，停在当前值', { rowHeight: current, target: next, cards: cards.length });
        return;
      }
      logDebug('timetable', '行高已按内容调整', { from: current, to: next, cards: cards.length });
      rowHeightRef.current = next;
      setRowHeight(next);
    },
    [sectionRef],
  );

  useEffect(() => {
    measuredWidth.current = null;
    const handle = globalThis.requestAnimationFrame(() => apply(true));
    return () => globalThis.cancelAnimationFrame(handle);
  }, [data, apply]);

  useEffect(() => {
    const section = sectionRef.current;
    if (section === null || typeof globalThis.ResizeObserver !== 'function') return;
    let frame = 0;
    const observer = new globalThis.ResizeObserver(() => {
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
      frame = globalThis.requestAnimationFrame(() => {
        frame = 0;
        apply(false);
      });
    });
    observer.observe(section);
    return () => {
      observer.disconnect();
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
    };
  }, [sectionRef, apply]);

  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready === undefined) return;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (!cancelled) apply(true);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // 启动时日志级别还没同步到原生，等布局稳定后再量一次并留痕
  useEffect(() => {
    const timer = setTimeout(() => {
      const cards = measureCards();
      if (cards.length === 0) return;
      const target = rowHeightFor(cards);
      logDebug('timetable', '行高自检', { rowHeight: rowHeightRef.current, target, cards: cards.length });
      if (target !== null && target >= ROW_HEIGHT_MAX) {
        logWarn('timetable', '行高已到上限，仍有内容被裁', { rowHeight: rowHeightRef.current, target, cards: cards.length });
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return rowHeight;
}
