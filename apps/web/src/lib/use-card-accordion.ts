import { useCallback, useEffect, useState } from 'react';
import { readExpanded, rememberExpanded } from './accordion-store.ts';

/**
 * 页面级手风琴状态：同一页只展开一张卡片，记住上次展开的那张，读不到时默认第一张。
 *
 * 用法：页面把可见卡片的 id 列表传进来，把 `expandedId === card.id` 作为 `open` 传给
 * `CollapsibleCard`，`onOpenChange` 调 `toggle(card.id, next)`——点开一张会自动收起其余。
 */
export interface CardAccordion {
  expandedId: string | null;
  toggle: (id: string, open: boolean) => void;
}

export function useCardAccordion(scope: string, ids: readonly string[]): CardAccordion {
  const fallback = ids[0] ?? null;
  const [expandedId, setExpandedId] = useState<string | null>(() => readExpanded(scope) ?? fallback);

  // 卡片显隐/排序变了（布局对话框）时，展开项可能已不可见：回落到第一张可见卡
  useEffect(() => {
    if (expandedId !== null && ids.includes(expandedId)) return;
    if (expandedId === fallback) return;
    setExpandedId(fallback);
    rememberExpanded(scope, fallback);
  }, [expandedId, fallback, ids, scope]);

  const toggle = useCallback(
    (id: string, open: boolean) => {
      // 手风琴：展开一张时其余自动收起；把当前卡也收起则记录为空（下次进入默认第一张）
      const next = open ? id : null;
      setExpandedId(next);
      rememberExpanded(scope, next);
    },
    [scope],
  );

  return { expandedId, toggle };
}
