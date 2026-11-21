/**
 * 诊断日志文案：诊断日志弹窗与日志收集。
 */
export const appDiagnosticsCopy = {
  title: '诊断日志',
  loadingNative: '正在读取原生日志…',
  loading: '正在读取…',
  lineCount: (lines: number) => `共 ${lines} 行`,
  nativeReadFailed: (reason: string) => `原生日志读取失败：${reason}。Web 日志仍可用`,
  nativePath: (path: string) => `原生日志：${path}`,
  contentAria: '诊断日志内容',
  empty: '（暂无日志：复现问题后再打开这里）',
  emptyClipboard: '（暂无日志）',
  copyFailed: '复制失败，请长按日志内容手动选择复制',
  copiedToast: '已复制全部诊断日志',
  clearPartialFailed: (reason: string) => `Web 日志已清空。原生日志清空失败：${reason}`,
  clearedToast: '已清空诊断日志',
  copiedButton: '已复制',
  copyButton: '复制全部',
  refreshButton: '刷新',
  clearButton: '清空',
  closeButton: '关闭',
  nativeReadTimeout: '读取原生日志超时（可能存储/原生桥异常）',
  nativeClearTimeout: '清空原生日志超时',
  nativeSection: (text: string) => `===== 安卓原生日志 =====\n${text}`,
} as const;
