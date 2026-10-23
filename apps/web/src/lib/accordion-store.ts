/**
 * 卡片手风琴：同一页只展开一张卡片，并记住上次展开的是哪张。
 *
 * 与 `collapse-store.ts` 的区别：
 * - 旧 store 记录「哪些卡片收起」，多张可以同时展开；
 * - 这里记录「每页当前展开的那一张」，用于「点开一张自动收起其余」的手风琴交互。
 *
 * 状态按页（scope）隔离，存在本地 localStorage，不进数据库与同步。
 */

const STORAGE_KEY = 'dt.cards.expanded';
/** 卡片较多，允许「全部收起」用空串表示；读不到或值失效时回落到调用方给的第一张。 */
type ExpandedMap = Record<string, string>;

function read(): ExpandedMap {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined || raw === '') return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: ExpandedMap = {};
    for (const [scope, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === 'string') result[scope] = id;
    }
    return result;
  } catch {
    return {};
  }
}

let cache: ExpandedMap | null = null;

function current(): ExpandedMap {
  cache ??= read();
  return cache;
}

/** 该页上次展开的卡片 id；没有记录时返回 null（调用方回落到第一张可见卡）。 */
export function readExpanded(scope: string): string | null {
  return current()[scope] ?? null;
}

/** 记录该页展开的卡片；传 null 表示用户把当前卡片也收起了（下次进入回落到第一张）。 */
export function rememberExpanded(scope: string, id: string | null): void {
  const next: ExpandedMap = { ...current() };
  if (id === null) delete next[scope];
  else next[scope] = id;
  cache = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 本地存储不可用时仅保留内存状态
  }
}

/** 测试用：清掉内存缓存，让下次读取重新走 localStorage。 */
export function resetAccordionCacheForTests(): void {
  cache = null;
}
