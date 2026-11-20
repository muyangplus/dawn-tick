/**
 * 基础组件文案：弹窗壳、确认框、折叠卡片、下拉候选、「?」说明与外部链接确认框。
 */
export const uiCopy = {
  dialog: {
    closeAria: '关闭',
    submitButton: '保存',
    cancelButton: '取消',
    dangerConfirmButton: '确认删除',
  },

  confirm: {
    title: '确认操作',
    cancelButton: '取消',
    confirmButton: '确认',
  },

  collapsible: {
    toggleAria: (title: string, open: boolean) => `${title}：${open ? '收起' : '展开'}`,
  },

  combobox: {
    empty: '没有匹配项',
    listAria: (label: string) => `${label}候选`,
  },

  helpHint: {
    triggerAria: (label: string) => `说明：${label}`,
  },

  externalLink: {
    title: '打开外部链接',
    description: '应用内不加载该页面，交给系统浏览器',
    urlAria: '链接地址',
    busy: '正在打开链接…',
    openFailed: '打开失败，请稍后重试',
    openFailedUseCopy: '打开失败，请改用「复制链接」',
    opened: '已在默认浏览器打开',
    copied: '已复制链接',
    copyFailed: '复制失败，请手动复制链接',
    cancelButton: '取消',
    copyButton: '复制链接',
    openButton: '用默认浏览器打开',
  },
} as const;
