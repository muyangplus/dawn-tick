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

/** 跑一个慢操作：盖蒙版、挡住重复点击，结束后无论成败都收起；抛出的错误原样交给调用方。 */
export async function runBusy<T>(label: string, task: () => Promise<T>): Promise<T> {
  publish({ label, count: (current?.count ?? 0) + 1 });
  try {
    return await task();
  } finally {
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
  run: <T>(label: string, task: () => Promise<T>, options?: BusyRunOptions) => Promise<T | undefined>;
} {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(label: string, task: () => Promise<T>, options?: BusyRunOptions): Promise<T | undefined> => {
      if (busySnapshot() !== null) {
        logDebug('busy', '已有操作进行中，忽略重复触发', { label });
        return undefined;
      }
      setBusy(true);
      try {
        return await runBusy(label, task);
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
