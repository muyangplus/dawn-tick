/**
 * 给一个 fetch 绑上取消信号：用户按 Esc / 返回键取消只读操作时，进行中的请求一起中止。
 * 请求自己带了 signal（如超时）时两个都生效；老 WebView 没有 `AbortSignal.any` 时只用取消信号。
 */
export function fetchWithSignal(base: typeof fetch, signal: AbortSignal): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const own = init?.signal ?? null;
    const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    const merged = own === null ? signal : typeof any === 'function' ? any([own, signal]) : signal;
    return base(input, { ...init, signal: merged });
  }) as typeof fetch;
}
