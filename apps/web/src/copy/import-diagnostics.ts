/** 导入识别诊断：诊断面板与复制 / 导出的诊断文本。 */
export const importDiagnosticsCopy = {
  sourcePaste: '粘贴网页课表',

  /** 面板 */
  toggle: '查看识别诊断',
  metrics: {
    frames: '帧数',
    tables: '表格数',
    kbTables: '疑似课表数',
    gridCells: '网格单元数',
  },
  loadingLine: (loading: boolean) =>
    loading ? '是否仍在加载：是 · 请等课表显示完整后重新识别' : '是否仍在加载：否',
  pageLine: (system: string | null, url: string | null, title: string | null) =>
    `${system ?? '通用识别'} · ${url ?? '页面地址未知'} · ${title ?? '标题未知'}`,
  estimatedNote: '内容不含书签或窗口诊断，表格数按粘贴内容估算。重新安装书签后再复制，可得到完整诊断。',
  mappingLine: (mapping: string) => `匹配字段映射：${mapping}`,
  samplesTitle: (rows: number, chars: number) => `前 ${rows} 行样例（每行截断到 ${chars} 字符）`,
  copyButton: '复制诊断信息',
  exportButton: '导出诊断日志',

  /** 字段映射 */
  mappingNone: '未匹配到星期表头（按通用启发式解析）',
  mappingByRow: '按行号',
  mapping: (headerRow: number, firstDay: number, lastDay: number, labels: string, period: string) =>
    `表头行 ${headerRow} · 星期列 ${firstDay}–${lastDay}${labels === '' ? '' : `（${labels}）`} · 节次列 ${period}`,
  shapes: {
    grid: '「日-节」网格',
    'weekday-table': '星期表头表格',
    none: '未识别',
  },
  shapeNotRun: '未执行识别',

  /** 诊断文本 */
  reportTitle: 'DawnTick 导入识别诊断',
  generatedAt: (time: string) => `生成时间：${time}`,
  appVersion: (version: string, channel: string) => `应用版本：${version}（${channel}）`,
  source: (source: string) => `导入来源：${source}`,
  summaryHeading: '— 诊断摘要 —',
  frames: (count: number) => `帧数：${count}`,
  tables: (count: number, fromPage: boolean) => `表格数：${count}${fromPage ? '' : '（按粘贴内容估算）'}`,
  kbTables: (count: number) => `疑似课表数：${count}`,
  gridCells: (count: number) => `网格单元数：${count}`,
  loading: (loading: boolean) => `是否仍在加载：${loading ? '是' : '否'}`,
  ready: (state: string) => `文档状态：${state}`,
  url: (url: string) => `页面地址：${url}`,
  title: (title: string) => `页面标题：${title}`,
  system: (system: string) => `命中系统：${system}`,
  shape: (shape: string) => `识别形态：${shape}`,
  schedules: (count: number) => `识别结果：${count} 条排课`,
  fieldMapping: (mapping: string) => `字段映射：${mapping}`,
  pageJsonHeading: '— 页面诊断 JSON —',
  pageJsonNone: '无（内容没有携带书签或窗口诊断）',
  samplesHeading: (rows: number, chars: number) => `— 前 ${rows} 行样例（每行 ≤${chars} 字符）—`,
  samplesNone: '（没有可用的表格样例）',
  logsHeading: '— 相关日志 —',
  logsNone: '（暂无）',
} as const;
