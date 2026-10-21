import { addDays } from '@dawn-tick/core';
import type { AppData, LessonCell } from '../../data.ts';
import type { CardMeasurement } from '../../lib/row-height.ts';

/**
 * 周视图渲染用的几个小查询：放假判定、格子占用、课次展开与行高测量。
 * 与拖动状态机无关，抽出来只为把视图文件留给布局与交互。
 */

/** 多天假期的第一天：当天放假且前一天不放假。 */
export function isHolidayRunStart(data: AppData, date: string): boolean {
  if (!data.holidayLabels.has(date)) return false;
  return !data.holidayLabels.has(addDays(date, -1));
}

/** 连堂与「停课」等占多节的条目：节次落在其覆盖范围内即算该格被占用。 */
export function occupied(data: AppData, date: string, period: number): boolean {
  for (let current = period; current >= 1; current -= 1) {
    const cells = data.grid.get(`${date}:${current}`) ?? [];
    if (cells.some((cell) => period >= current && period <= Math.max(cell.periodStart, cell.periodEnd))) return true;
  }
  return false;
}

/** 课表网格里的全部课次（含非本周），窗口内展示与补白都按它算。 */
export function lessonsOf(data: AppData): LessonCell[] {
  const out: LessonCell[] = [];
  for (const list of data.grid.values()) out.push(...list);
  return out;
}

/** 量一次课表卡片：卡片内容高度 + 它占几节，交给行高换算。 */
export function measureCards(): CardMeasurement[] {
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
