/** 扫一扫：入口按钮、取景覆盖层、结果弹窗与扫码错误。 */
export const scanCopy = {
  entryAria: '扫一扫',
  overlayTitle: '扫一扫',
  overlayHint: '把二维码放入取景框',
  overlayAutoStop: '识别到第一条内容后自动停止',
  cancel: '取消扫码',

  resultTitle: '扫码结果',
  resultDescription: '内容已保留，可复制使用',
  failedTitle: '扫码失败',
  failedDescription: '请重试，或改用粘贴、手动输入',
  copied: '已复制扫码内容',
  copiedShort: '已复制',
  copyFailed: '复制失败，请长按选择文本复制',
  retryAria: '重新扫码',
  retry: '重新扫码',
  copyAria: '复制扫码内容',
  copy: '复制内容',
  closeAria: '关闭扫码结果',
  close: '关闭',

  /** 扫码错误 */
  cancelled: '已取消扫码',
  noPermission: '没有相机权限：请在系统设置 → 应用 → 权限里允许相机后重试',
  noComponent: '当前安装包没有扫码组件，请安装最新版本后重试',
  cameraBusy: '相机正被其他应用占用，请关闭后重试',
  failed: '扫码失败，请重试',
  androidOnly: '扫一扫仅限安卓版，请改用「粘贴配对信息」',
  unsupportedDevice: '当前设备不支持扫码，请改用「粘贴配对信息」',
  /** 权限被拒时抛出的内部原因；`describeScanError` 按「相机权限」识别 */
  permissionDenied: '相机权限未授予',

  /** 结果说明 */
  emptyResult: '扫码结果为空',
  notPairLink: (reason: string) => `这是晓刻链接，但不能作为配对信息：${reason}`,
  unsupportedScheme: (scheme: string) => `暂不支持 ${scheme}:// 链接，内容已保留，可复制使用`,
} as const;
