import { COUNT } from './common.ts';

/** 作息设置：每节时长、课间、作息预设、生成与逐节编辑。 */
export const periodsCopy = {
  title: '作息',
  sections: { am: '上午', pm: '下午', night: '晚上' },

  durationLabel: '每节时长（分钟）',
  breakLabel: '课间（分钟）',
  durationRange: (min: number, max: number) => `每节时长请填 ${min}–${max} 分钟`,
  breakRange: (min: number, max: number) => `课间请填 ${min}–${max} 分钟`,
  durationOutOfRange: (min: number, max: number, current: number) =>
    `每节时长超出范围：当前 ${COUNT('minute', current)}，请填 ${min}–${max} 分钟`,
  breakOutOfRange: (min: number, max: number, current: number) =>
    `课间超出范围：当前 ${COUNT('minute', current)}，请填 ${min}–${max} 分钟`,

  presetLabel: '作息预设',
  presetHintEmpty: '套用后整表按该作息重排',
  periodCount: (count: number) => `${count} 节`,
  sourceSuffix: (source: string) => ` · ${source}`,
  presetPlaceholder: '输入学校或作息名搜索',
  presetEmpty: '没有匹配的作息',
  applyPreset: '套用此作息',
  appliedPreset: (name: string, count: number) => `预设：${name}（${count} 节）`,
  applyingPreset: '正在套用作息…',
  presetApplied: (name: string, count: number) => `已套用「${name}」作息（${count} 节）`,

  blockHeader: '时段',
  blockStartHeader: '第一节开始',
  blockCountHeader: '节数',
  blockCountAria: (section: string) => `${section}节数`,
  generate: '自动生成节次',
  generating: '正在生成节次…',
  generated: (count: number) => `已生成节次 ${COUNT('period', count)}`,
  append: '追加一节',
  appending: '正在追加节次…',
  appended: (periodNo: number | string) => `已添加第 ${periodNo} 节`,

  empty: '没有节次，请先生成节次',
  period: (periodNo: number) => `第 ${periodNo} 节`,
  startAria: (periodNo: number) => `第 ${periodNo} 节开始时间`,
  endAria: (periodNo: number) => `第 ${periodNo} 节结束时间`,
  removeAria: (periodNo: number) => `删除第 ${periodNo} 节`,
  removing: '正在删除节次…',
  periodInUse: (periodNo: number, count: number) =>
    `第 ${periodNo} 节被排课 ${COUNT('schedule', count)}占用，请先调整这些排课`,
  periodMissing: (periodNo: number) => `第 ${periodNo} 节不存在`,

  editHint: '每节起止时间可单独修改',
  editHelpLabel: '改节次时间',
  editHelp: '改完会询问作用范围：只改这一节，或从这一节起按每节时长与课间顺延后面的节次。',

  scopeTitle: '调整范围',
  scopeDescription: '这次改动要应用到哪些节次？',
  scopeSubmit: '从这一节起顺延重排',
  scopeCancel: '取消',
  scopeOnlyThis: '只改这一节',
  scopeSummary: (periodNo: number, duration: number, breakMinutes: number) =>
    `第 ${periodNo} 节已改。顺延按每节 ${COUNT('minute', duration)}、课间 ${COUNT('minute', breakMinutes)}`,
  scopeOptOut: '本次启动期间不再询问',
  scopeOptedOut: '本次启动期间不再询问调整范围',
  reflowing: '正在顺延重排…',
  reflowNoSlots: '没有可重排的节次，请先生成节次',
  reflowAnchorMissing: (periodNo: number) => `第 ${periodNo} 节不存在，无法顺延重排`,
  reflowed: (periodNo: number, duration: number, breakMinutes: number) =>
    `第 ${periodNo} 节起已顺延：每节 ${COUNT('minute', duration)}、课间 ${COUNT('minute', breakMinutes)}`,
} as const;
