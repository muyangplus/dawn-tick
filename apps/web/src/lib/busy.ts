import { useCallback, useEffect, useState } from 'react';
import { logDebug, logError, logInfo } from '../log.ts';
import { errorMessage } from './errors.ts';
import { errorsCopy } from '../copy/errors.ts';

type Listener = (busy: BusyState | null) => void;

export interface BusyState {
  /** 正在进行的操作名，展示给用户 */
  label: string;
  /** 同时进行的操作数：归零才收起蒙版 */
  count: number;
  /** 进行中的操作都只读、可中途停下：Esc / 返回键可取消 */
  cancellable: boolean;
}

/** 用户按 Esc / 返回键取消了只读操作。调用方按「已取消」处理，不当作失败。 */
export class BusyCancelledError extends Error {
  constructor(label: string) {
    super(errorsCopy.busyCancelled(label));
    this.name = 'BusyCancelledError';
  }
}

export function isBusyCancelled(cause: unknown): cause is BusyCancelledError {
  return cause instanceof BusyCancelledError;
}

interface Running {
  label: string;
  cancellable: boolean;
  controller: AbortController;
}

const running = new Set<Running>();
let current: BusyState | null = null;
const listeners = new Set<Listener>();

function publish(): void {
  const list = [...running];
  const last = list[list.length - 1];
  current =
    last === undefined
      ? null
      : { label: last.label, count: list.length, cancellable: list.every((item) => item.cancellable) };
  for (const listener of listeners) listener(current);
}

export function busySnapshot(): BusyState | null {
  return current;
}

/** 单个动作的默认上限：原生调用/网络卡住时不能让整页蒙版永久锁死（否则所有 loading 功能都像卡死）。 */
export const BUSY_TIMEOUT_MS = 60_000;

export interface RunBusyOptions {
  timeoutMs?: number;
  /** 只读操作（检查、测试连接、识别等）：可被 Esc / 返回键取消。写数据的操作不传，进行中不能中断 */
  cancellable?: boolean;
}

/**
 * 跑一个慢操作：盖蒙版、挡住重复点击，结束后无论成败都收起；抛出的错误原样交给调用方。
 *
 * `timeoutMs` 默认 60 秒：超时后主动报错、中止 `signal` 并释放蒙版，底层 Promise 即使永不 settle 也不会
 * 把后续所有操作一起锁死（用户报的「导出日志后其它功能全卡死」就是这个锁被占住）。
 *
 * 可取消的操作被取消时立即以 `BusyCancelledError` 结束并收起蒙版；`signal` 交给底层请求真正中止，
 * 不认 signal 的底层调用会在后台跑完，调用方在 await 之后用 `signal.aborted` 丢弃结果。
 */
export async function runBusy<T>(
  label: string,
  task: (signal: AbortSignal) => Promise<T>,
  options: RunBusyOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? BUSY_TIMEOUT_MS;
  const entry: Running = { label, cancellable: options.cancellable === true, controller: new AbortController() };
  running.add(entry);
  publish();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        logError('app', '操作超时，蒙版已释放', { label, timeoutMs });
        reject(new Error(errorsCopy.busyTimeout(label)));
        // 先以超时结束，再中止底层请求：迟到的结果靠 signal.aborted 丢掉，不在蒙版收起后再改界面
        if (onAbort !== undefined) entry.controller.signal.removeEventListener('abort', onAbort);
        entry.controller.abort();
      }, Math.max(1, timeoutMs));
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new BusyCancelledError(label));
      entry.controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([task(entry.controller.signal), timeout, cancelled]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) entry.controller.signal.removeEventListener('abort', onAbort);
    running.delete(entry);
    publish();
  }
}

/**
 * Esc / 返回键：取消进行中的操作。只有全部可取消时才取消；有写入在进行就一个都不动。
 * 返回 `idle` 没有操作、`cancelled` 已取消、`locked` 正在写入不能中断。
 */
export function cancelBusy(): 'idle' | 'cancelled' | 'locked' {
  if (running.size === 0) return 'idle';
  const list = [...running];
  if (!list.every((item) => item.cancellable)) return 'locked';
  logInfo('app', '用户取消了进行中的操作', { labels: list.map((item) => item.label) });
  for (const item of list) item.controller.abort();
  return 'cancelled';
}

/** 订阅蒙版状态。 */
export function useBusy(): BusyState | null {
  const [state, setState] = useState<BusyState | null>(() => busySnapshot());
  useEffect(() => {
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    listener(busySnapshot());
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

/** `run` 的可选项：`log: false` 让上层自己按 scope 记失败日志，避免一处失败两条。 */
export interface BusyRunOptions {
  log?: boolean;
}

/** 按钮/表单一类异步动作的状态：busy 期间按钮禁用并挂上整页蒙版。 */
export function useBusyAction(): {
  busy: boolean;
  run: <T>(
    label: string,
    task: (signal: AbortSignal) => Promise<T>,
    options?: BusyRunOptions & RunBusyOptions,
  ) => Promise<T | undefined>;
} {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(
      label: string,
      task: (signal: AbortSignal) => Promise<T>,
      options?: BusyRunOptions & RunBusyOptions,
    ): Promise<T | undefined> => {
      if (busySnapshot() !== null) {
        logDebug('app', '已有操作进行中，重复触发已忽略', { label });
        return undefined;
      }
      setBusy(true);
      try {
        return await runBusy(label, task, {
          ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(options?.cancellable === undefined ? {} : { cancellable: options.cancellable }),
        });
      } catch (cause: unknown) {
        if (options?.log !== false && !isBusyCancelled(cause)) {
          logError('app', '操作失败', { label, message: errorMessage(cause) });
        }
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, run };
}
