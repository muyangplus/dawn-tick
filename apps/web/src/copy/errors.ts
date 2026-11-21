/**
 * 通用错误文案：异常兜底、失败句兜底标题、超时与原生调用失败。
 */
export const errorsCopy = {
  unknown: '未知错误',
  nativeCallFailed: '原生调用失败',
  failFallbackTitle: '操作没有完成',
  retry: '请重试',
  busyCancelled: (label: string) => `已取消（${label}）`,
  busyTimeout: (label: string) => `操作超时（${label}），已取消。请重试；仍无响应请重启应用`,
  invalidTime: (hhmm: string) => `非法时间: ${hhmm}`,
  metaNotSerializable: 'app_meta 值无法序列化为 JSON',
} as const;
