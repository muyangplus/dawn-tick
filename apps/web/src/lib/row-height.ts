/** 课表行高的换算：按卡片实际内容量一次，直接算出目标行高，不做逐帧微调。 */

export const ROW_HEIGHT_MIN = 56;
export const ROW_HEIGHT_MAX = 96;
/** 卡片高度 = 节次数 × 行高 − 4（上下各留 2px），折算时补回来。 */
const CARD_INSET = 4;
/** 收回行高要留的余量：临界点上不会来回加减。 */
const SHRINK_MARGIN = 8;
/** 行高按 4px 取整，减少无意义的重排。 */
const STEP = 4;

export interface CardMeasurement {
  /** 卡片占几节 */
  span: number;
  /** 卡片内容高度（scrollHeight） */
  contentHeight: number;
}

/** 内容需要的行高；没有任何可量内容时返回 null。 */
export function rowHeightFor(cards: readonly CardMeasurement[]): number | null {
  let needed = 0;
  for (const card of cards) {
    if (!Number.isFinite(card.span) || card.span < 1) continue;
    if (!Number.isFinite(card.contentHeight) || card.contentHeight <= 0) continue;
    needed = Math.max(needed, (card.contentHeight + CARD_INSET) / card.span);
  }
  if (needed <= 0) return null;
  const rounded = Math.ceil(needed / STEP) * STEP;
  return Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, rounded));
}

/** 下一档行高：内容挤不下立即加高，收回要超过余量才生效。 */
export function nextRowHeight(current: number, cards: readonly CardMeasurement[]): number {
  const target = rowHeightFor(cards);
  if (target === null) return current;
  if (target > current) return target;
  if (target <= current - SHRINK_MARGIN) return target;
  return current;
}
