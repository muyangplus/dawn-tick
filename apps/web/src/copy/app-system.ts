/**
 * 系统动作文案：外部链接、文件保存、开机自启、主屏小组件与分享导入。
 */

export const appSystemCopy = {
  link: {
    desktopOpenFailed: (reason: string) => `系统浏览器打开失败：${reason}`,
    androidOpenFailed: (reason: string) => `调用系统浏览器失败：${reason}`,
    popupBlocked: '浏览器新窗口被拦截，请改用「复制链接」',
    nativeTimeout: '调用系统浏览器超时',
  },

  file: {
    textFilter: '文本文件',
    binaryFilter: '文件',
    writeUnsupported: '当前平台不支持写入文件',
  },

  autostart: {
    unsupported: '当前平台不支持',
  },

  widget: {
    next: { label: '下一节课', description: '下一节课的课程、时间与地点' },
    today: { label: '今日课表', description: '今天所有课程与进行中的一节' },
    week: { label: '一周概览', description: '一周课程清单' },
    exam: { label: '考试倒计时', description: '最近的考试与剩余天数' },
    unsupported: '当前平台没有主屏小组件',
  },

  share: {
    noSemester: '本机还没有学期，请先创建学期再导入分享课表',
  },
} as const;
