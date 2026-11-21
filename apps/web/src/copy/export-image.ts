/**
 * 课表图片与 PDF 导出文案：画布上的标题、状态角标与编码错误。
 */
import { appShellCopy } from './app-shell.ts';

export const exportImageCopy = {
  fallbackTitle: '课表',
  fileNameFallback: '课表',
  weekSingle: (week: number) => `第 ${week} 周`,
  weekRange: (from: number, to: number) => `第 ${from}–${to} 周`,
  subtitle: (weekLabel: string, dateRange: string) => `${weekLabel} · ${dateRange}`,
  noSemesterSubtitle: '还没有设置学期',
  footer: (presetLabel: string) => `${appShellCopy.appName} · 浅色主题 · ${presetLabel}`,
  emptyNoSemester: '还没有学期，请先创建学期再导出课表',
  emptyWeek: '这周没有课程',
  axisHeader: '节次',
  holidayMark: ' 假',
  status: {
    cancelled: '停课',
    movedOut: '已调课',
    outOfWeek: '非本周',
    eventFallback: '日程',
  },
  canvasUnsupported: '当前环境不支持 Canvas，无法导出图片',
  canvas2dUnsupported: '当前环境不支持 Canvas 2D，无法导出图片',

  png: {
    badSize: (width: number, height: number) => `PNG 尺寸无效：${width}×${height}`,
    shortPixels: 'PNG 像素数据长度不足',
  },

  pdf: {
    pngTruncated: 'PNG 文件不完整',
    notPng: '不是有效的 PNG 文件',
    chunkOverflow: 'PNG 数据块长度越界',
    badIhdr: 'PNG 缺少有效的 IHDR',
    bitDepthUnsupported: (depth: number) => `暂不支持 ${depth} 位深的 PNG`,
    missingSize: 'PNG 缺少图像尺寸',
    missingIdat: 'PNG 缺少 IDAT 数据',
    sizeMismatch: (pngWidth: number, pngHeight: number, width: number, height: number) =>
      `PNG 尺寸与导出尺寸不一致（${pngWidth}×${pngHeight} ≠ ${width}×${height}）`,
    rgbOnly: 'PDF 导出只支持无透明通道的 RGB PNG',
  },
} as const;
