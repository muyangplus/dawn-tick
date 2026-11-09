import { useCallback, useEffect, useState } from 'react';
import { logDebug, logWarn } from '../log.ts';
import { errorMessage } from './errors.ts';

type Listener = (busy: BusyState | null) => void;

export interface BusyState {
  /** 正在进行的操作名，展示给用户 */
  label: string;
  /** 同时进行的操作数：归零才收起蒙版 */
  count: number;
}

let current: BusyState | null = null;
const listeners = new Set<Listener>();

function publish(next: BusyState | null): void {
  current = next;
  for (const listener of listeners) listener(next);
}

export function busySnapshot(): BusyState | null {
  return current;
}

/** 单个动作的默认上限：原生调用/网络卡住时不能让整页蒙版永久锁死（否则所有 loading 功能都像卡死）。 */
export const BUSY_TIMEOUT_MS = 60_000;

/**
 * 跑一个慢操作：盖蒙版、挡住重复点击，结束后无论成败都收起；抛出的错误原样交给调用方。
 *
 * `timeoutMs` 默认 60 秒：超时后主动报错并释放蒙版，底层 Promise 即使永不 settle 也不会
 * 把后续所有操作一起锁死（用户报的「导出日志后其它功能全卡死」就是这个锁被占住）。
 */
export async function runBusy<T>(
  label: string,
  task: () => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? BUSY_TIMEOUT_MS;
  publish({ label, count: (current?.count ?? 0) + 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        logWarn('busy', '操作超时，已释放蒙版', { label, timeoutMs });
        reject(new Error(`操作超时（${label}），已取消；请重试，若仍无响应请重启应用`));
      }, Math.max(1, timeoutMs));
    });
    return await Promise.race([task(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    const left = (current?.count ?? 1) - 1;
    publish(left > 0 ? { label: current?.label ?? label, count: left } : null);
  }
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
    task: () => Promise<T>,
    options?: BusyRunOptions & { timeoutMs?: number },
  ) => Promise<T | undefined>;
} {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(
      label: string,
      task: () => Promise<T>,
      options?: BusyRunOptions & { timeoutMs?: number },
    ): Promise<T | undefined> => {
      if (busySnapshot() !== null) {
        logDebug('busy', '已有操作进行中，忽略重复触发', { label });
        return undefined;
      }
      setBusy(true);
      try {
        return await runBusy(label, task, options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs });
      } catch (cause: unknown) {
        if (options?.log !== false) {
          logWarn('busy', '操作失败', { label, message: errorMessage(cause) });
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
