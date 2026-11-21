import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { createBackStack, pageBackStack, rootBackStack, type BackStack } from './back-stack.ts';

/** 当前所在的返回栈：弹窗内容区提供各自的栈，其余落到页面栈。 */
export const BackScopeContext = createContext<BackStack>(pageBackStack);

/** 弹窗用：一个只属于这个弹窗的返回栈。 */
export function useBackScope(): BackStack {
  return useMemo(createBackStack, []);
}

/**
 * `enabled` 为真时登记一级返回：Esc / 返回键先执行它，而不是关掉弹窗或离开页面。
 * 处理函数取最新的一次渲染，不需要稳定引用。
 */
export function useBackHandler(enabled: boolean, handler: () => void): void {
  const stack = useContext(BackScopeContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    return stack.push(() => latest.current());
  }, [enabled, stack]);
}

/** 最外一级返回（离开当前页）：只给 App 用。 */
export function useRootBackHandler(enabled: boolean, handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    return rootBackStack.push(() => latest.current());
  }, [enabled]);
}
