/**
 * 运行中数据库损坏守卫。
 *
 * 启动期的损坏由错误页处理；这里负责**运行中**才暴露的损坏（`malformed` /
 * `not a database` / `unsupported file format` 等）：
 *
 * - 首次识别到损坏就锁死写入，后续写操作直接拒绝（不再反复报同一个 sqlx 原始错误）；
 * - 同一会话只通知一次，界面据此弹一次恢复对话框；
 * - 读操作照常转发，只是失败时同样上报（损坏也可能先在读里暴露）。
 *
 * 判定入口分成两层：`guardStorage` 包在 `openStorage` 外层，任何存储访问都能捕获；
 * 不能走 Storage 的入口（导出/备份/提醒）再用 `reportCorrupt` 显式上报。
 */
import type { Collection, Storage, StoreName } from '@dawn-tick/core';
import { errorMessage } from '../lib/errors.ts';
import { logError } from '../log.ts';
import { isFallbackStorage, markStorageFallback } from './fallback.ts';
import { isCorruptDatabase } from './health.ts';

/** 对话框与只读提示共用的一句话：事实 + 下一步。 */
export const DATABASE_CORRUPT_MESSAGE = '数据库文件损坏，已停止写入；可从最近快照恢复并重启';
/** 写入口被锁死时的统一提示。 */
export const DATABASE_CORRUPT_WRITE_BLOCKED = '数据库文件损坏，已停止写入';
/** 导出场景的用户可见文案：保留“恢复后重试”的下一步。 */
export const EXPORT_CORRUPT_MESSAGE = '数据库文件损坏，导出已停止：可从最近快照恢复后重试';

/** 首次损坏事件：`message` 是原始错误，只进日志与对话框详情。 */
export interface CorruptEvent {
  message: string;
  at: number;
}

type Listener = (event: CorruptEvent) => void;

/** 本会话的第一次损坏；非 null 即表示已停止写入。 */
let tripped: CorruptEvent | null = null;
const listeners = new Set<Listener>();

/** 是否已判定损坏并锁死写入。 */
export function isCorruptLocked(): boolean {
  return tripped !== null;
}

/** 首次损坏事件；未发生时返回 null。 */
export function corruptEvent(): CorruptEvent | null {
  return tripped;
}

/**
 * 上报一次错误：不是损坏返回 false；是损坏则锁定写入（同一会话只通知一次）并返回 true。
 * 调用方拿返回值决定是否换文案，不需要自己判重。
 */
export function reportCorrupt(cause: unknown, scope = 'storage'): boolean {
  if (!isCorruptDatabase(cause)) return false;
  if (tripped !== null) return true;
  tripped = { message: errorMessage(cause), at: Date.now() };
  logError(scope, '数据库文件损坏，已停止写入', { message: tripped.message });
  for (const listener of [...listeners]) {
    try {
      listener(tripped);
    } catch {
      // 监听方自己的异常不能反过来影响存储错误处理
    }
  }
  return true;
}

/** 订阅首次损坏事件；已发生时立即回调一次，返回取消订阅函数。 */
export function subscribeCorrupt(listener: Listener): () => void {
  listeners.add(listener);
  if (tripped !== null) {
    try {
      listener(tripped);
    } catch {
      // 同上：监听方异常不外溢
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

/** 单测用：清空本会话的损坏状态（生产代码不调用）。 */
export function resetCorruptGuardForTests(): void {
  tripped = null;
}

/** 损坏后写入口的统一错误；`message` 可直接展示。 */
export class CorruptWriteBlockedError extends Error {
  constructor() {
    super(DATABASE_CORRUPT_WRITE_BLOCKED);
    this.name = 'CorruptWriteBlockedError';
  }
}

export function isCorruptWriteBlockedError(cause: unknown): boolean {
  return cause instanceof CorruptWriteBlockedError;
}

function deny(): Promise<never> {
  return Promise.reject(new CorruptWriteBlockedError());
}

/** 读转发；失败时上报（真正的损坏会在第一次读里被捕获）。 */
async function readThrough<R>(run: () => Promise<R>): Promise<R> {
  try {
    return await run();
  } catch (cause: unknown) {
    reportCorrupt(cause);
    throw cause;
  }
}

/** 写转发；已锁死时直接拒绝，不再碰底层数据库。 */
async function writeThrough<R>(run: () => Promise<R>): Promise<R> {
  if (tripped !== null) return deny();
  try {
    return await run();
  } catch (cause: unknown) {
    reportCorrupt(cause);
    throw cause;
  }
}

function guardedCollection<T>(collection: Collection<T>): Collection<T> {
  return {
    name: collection.name,
    get: (key) => readThrough(() => collection.get(key)),
    getAll: () => readThrough(() => collection.getAll()),
    put: (value) => writeThrough(() => collection.put(value)),
    putMany: (values) => writeThrough(() => collection.putMany(values)),
    delete: (key) => writeThrough(() => collection.delete(key)),
    clear: () => writeThrough(() => collection.clear()),
  };
}

/**
 * 包在存储外层：识别损坏并锁死写入。
 *
 * 只加行为、不改存储实现；临时回退的 `fallback` 标记会原样带过去，主壳仍能显示警告条。
 */
export function guardStorage(storage: Storage): Storage {
  const wrapped: Storage = {
    kind: storage.kind,
    collection: <T>(name: StoreName): Collection<T> => guardedCollection(storage.collection<T>(name)),
    readMeta: (key) => readThrough(() => storage.readMeta(key)),
    writeMeta: (key, value) => writeThrough(() => storage.writeMeta(key, value)),
    close: () => storage.close(),
  };
  if (isFallbackStorage(storage)) markStorageFallback(wrapped, null);
  return wrapped;
}

function readOnlyCollection<T>(collection: Collection<T>): Collection<T> {
  return {
    name: collection.name,
    get: (key) => readThrough(() => collection.get(key)),
    getAll: () => readThrough(() => collection.getAll()),
    put: () => deny(),
    putMany: () => deny(),
    delete: () => deny(),
    clear: () => deny(),
  };
}

/**
 * 损坏后的只读包装：界面层（各屏与表单）拿这份实例，写操作统一被拒绝；
 * 读取仍转发，便于用户先把还能读出来的数据导出/截图。
 */
export function corruptReadOnlyStorage(storage: Storage): Storage {
  const wrapped: Storage = {
    kind: storage.kind,
    collection: <T>(name: StoreName): Collection<T> => readOnlyCollection(storage.collection<T>(name)),
    readMeta: (key) => storage.readMeta(key),
    writeMeta: () => deny(),
    close: () => storage.close(),
  };
  if (isFallbackStorage(storage)) markStorageFallback(wrapped, null);
  return wrapped;
}
