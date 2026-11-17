/**
 * 全仓唯一的「异常 → 一行原因」实现。
 *
 * 界面只展示用户能读懂的原因，原始对象（含堆栈）交给调用方决定是否进日志；
 * 原生桥等地方需要不同的兜底词时，用第二参数覆盖，不再各写一份。
 */
export function errorMessage(cause: unknown, fallback = '未知错误'): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  if (cause === null || cause === undefined) return fallback;
  return String(cause);
}
