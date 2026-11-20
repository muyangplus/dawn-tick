/** 手动指定表格：读取页面表格后逐列指定表头、星期与节次。 */
export const importMappingCopy = {
  title: '手动指定表格',
  description: '逐列指定表头、星期与节次。已粘贴的内容不会改动',
  intro: '读取页面里的表格，再指定行列',
  readTables: '读取页面表格',
  inspection: (system: string, tables: number) => `形态推测：${system} · 预览 ${tables} 个表格（行号从 0 起）`,
  emptyCell: '—',
  headerRowLabel: '表头行',
  dayStartLabel: '星期起始列',
  dayCountLabel: '星期列数',
  periodColumnLabel: '节次列',
  periodColumnHelp: '填 -1 时按行号推算节次',
  failWhat: '识别失败',
  failNext: '请调整表头行、星期列或节次列后重试',
  apply: '按此映射识别',
  closeAria: '关闭手动映射',
  close: '关闭',
} as const;
