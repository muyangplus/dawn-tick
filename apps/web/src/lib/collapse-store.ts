const STORAGE_KEY = 'dt.settings.collapsed';

function read(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined || raw === '') return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.map((item) => String(item))) : new Set();
  } catch {
    return new Set();
  }
}

let cache: Set<string> | null = null;

function current(): Set<string> {
  cache ??= read();
  return cache;
}

/** 收起状态按设备保存在本地，不进数据库与同步。 */
export function isCollapsed(id: string): boolean {
  return current().has(id);
}

export function rememberCollapsed(id: string, collapsed: boolean): void {
  const next = new Set(current());
  if (collapsed) next.add(id);
  else next.delete(id);
  cache = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // 本地存储不可用时仅保留内存状态
  }
}
