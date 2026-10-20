/**
 * 存储临时回退（P1-07）：原生 SQLite 打不开时，openStorage 会改用 IndexedDB 并打上回退标记。
 * 回退期间按 Q5 结论只读：界面拿到的 Storage 由 readOnlyStorage 包一层，所有写入口统一拒绝。
 */
import type { Collection, Storage, StoreName } from '@dawn-tick/core';

/** 主壳常驻警告条：事实 + 数据未丢，避免用户误以为要恢复备份覆盖真实数据。 */
export const STORAGE_FALLBACK_BANNER = '原生数据库不可用，已临时使用浏览器存储（本机数据未删除）';
/** 存储状态行上的标记。 */
export const STORAGE_FALLBACK_BADGE = '临时回退';
/** 回退期间任何写操作被拦截时给用户的提示。 */
export const STORAGE_READ_ONLY_MESSAGE = '临时只读，修复存储后再改';

/** 带 `fallback: true` 标记的 Storage：只多一个只读字段，不改存储实现。 */
export type FallbackStorage = Storage & {
  readonly fallback: true;
  readonly fallbackReason: string | null;
};

/** 已标记过的存储：即使调用方重新包了一层已知对象也能认出回退状态。 */
const fallbackStorages = new WeakSet<Storage>();

/** 在 openStorage 的回退分支里调用：给返回对象打标记，并记下内部原因（只用于日志）。 */
export function markStorageFallback(storage: Storage, reason: string | null = null): FallbackStorage {
  Object.defineProperty(storage, 'fallback', { value: true, enumerable: true, configurable: true });
  Object.defineProperty(storage, 'fallbackReason', { value: reason, enumerable: false, configurable: true });
  fallbackStorages.add(storage);
  return storage as FallbackStorage;
}

/** 是否处于临时回退：优先看对象字段，同时兼容被包裹过的实例。 */
export function isFallbackStorage(storage: Storage | null | undefined): boolean {
  if (storage === null || storage === undefined) return false;
  return (storage as { fallback?: unknown }).fallback === true || fallbackStorages.has(storage);
}

/** 回退期间写操作的统一错误：message 本身就是给用户看的提示。 */
export class ReadOnlyStorageError extends Error {
  constructor() {
    super(STORAGE_READ_ONLY_MESSAGE);
    this.name = 'ReadOnlyStorageError';
  }
}

export function isReadOnlyStorageError(cause: unknown): boolean {
  return cause instanceof ReadOnlyStorageError;
}

function deny(): Promise<never> {
  return Promise.reject(new ReadOnlyStorageError());
}

function readOnlyCollection<T>(collection: Collection<T>): Collection<T> {
  return {
    name: collection.name,
    get: (key) => collection.get(key),
    getAll: () => collection.getAll(),
    put: () => deny(),
    putMany: () => deny(),
    delete: () => deny(),
    clear: () => deny(),
  };
}

/**
 * 只读包装：读原样转发，写一律拒绝。界面层（各屏与表单）拿这份实例，
 * 回退期间即使用户绕过了界面的显式拦截，也不会把数据写进临时存储。
 */
export function readOnlyStorage(storage: Storage): Storage {
  const wrapped: Storage = {
    kind: storage.kind,
    collection: <T>(name: StoreName): Collection<T> => readOnlyCollection(storage.collection<T>(name)),
    readMeta: (key) => storage.readMeta(key),
    writeMeta: () => deny(),
    close: () => storage.close(),
  };
  if (isFallbackStorage(storage)) markStorageFallback(wrapped, fallbackReasonOf(storage));
  return wrapped;
}

function fallbackReasonOf(storage: Storage): string | null {
  const reason = (storage as { fallbackReason?: unknown }).fallbackReason;
  return typeof reason === 'string' ? reason : null;
}
