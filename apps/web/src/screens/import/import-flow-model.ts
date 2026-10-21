import type { ImportedSchedule } from '@dawn-tick/core';

/** 导入渠道：三个入口各自回答「适合谁、产出什么」，步骤 2 只负责该渠道的取材。 */
export type ImportChannel = 'paste' | 'window' | 'manual';
/** 渠道 ① 的两种取材方式：粘贴网页文本，或选择表格/日历文件 */
export type PasteSource = 'page' | 'file';
/** 四步固定顺序：选方式 → 取课表 → 预览 → 完成 */
export type ImportStep = 1 | 2 | 3 | 4;
/** 失败来源决定错误块挂在哪个操作旁：识别挨着粘贴框，映射挨着映射按钮，文件挨着选文件。 */
export type ImportFailureSource = 'page' | 'mapping' | 'file' | 'clipboard';

export interface ImportFailure {
  source: ImportFailureSource;
  reason: string;
}

export interface ChannelInfo {
  id: ImportChannel;
  title: string;
  /** 适用场景（一句话） */
  scenario: string;
  /** 产出（一句话） */
  output: string;
  /** 取材格式，仅渠道 ① 有 */
  formats?: string;
}

export const CHANNELS: readonly ChannelInfo[] = [
  {
    id: 'paste',
    title: '粘贴文本 / 文件',
    scenario: '适用：自己登录教务后复制网页课表，或已有课表文件',
    output: '产出：解析出的排课预览，勾选后导入',
    formats: '网页文本 · CSV · Excel · ICS',
  },
  {
    id: 'window',
    title: '教务系统内嵌窗口',
    scenario: '适用：Windows / Android 上用应用内窗口登录教务',
    output: '产出：从窗口带回页面并直接解析为排课',
  },
  {
    id: 'manual',
    title: '手动添加',
    scenario: '适用：只补一两门课，或自动识别总是不准',
    output: '产出：打开课程表单逐门录入，不经过预览',
  },
];

/** 备份导入（JSON / Base64 / 整包 zip）不在课表导入里：渠道页脚指向正确的入口。 */
export const BACKUP_IMPORT_HINT = '备份恢复（JSON / Base64 / 整包 zip）在「设备与同步 → 备份恢复」。';

export const STEP_TITLES = ['选择方式', '获取课表', '预览', '完成'] as const;
export const STEP_COUNT = STEP_TITLES.length;

export function stepTitle(step: ImportStep): string {
  return STEP_TITLES[step - 1] ?? STEP_TITLES[0];
}

/** 窄屏步骤文案：完整步骤条收起后仍要知道「第几步、做什么」。 */
export function compactStepLabel(step: ImportStep): string {
  return `第 ${step}/${STEP_COUNT} 步 · ${stepTitle(step)}`;
}

export interface FlowState {
  step: ImportStep;
  channel: ImportChannel;
  pasteSource: PasteSource;
}

export const INITIAL_FLOW: FlowState = { step: 1, channel: 'paste', pasteSource: 'page' };

export type FlowEvent =
  | { type: 'pick-channel'; channel: ImportChannel }
  | { type: 'pick-paste-source'; source: PasteSource }
  | { type: 'back' }
  | { type: 'accepted' }
  | { type: 'done' }
  | { type: 'restart' };

/**
 * 步骤状态机（纯函数）：渠道决定步骤 2 的取材面板，手写渠道不占步骤。
 * 视图只按返回的 step 做 switch，不各自维护步进判断。
 */
export function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'pick-channel':
      return event.channel === 'manual'
        ? state
        : { ...state, channel: event.channel, step: 2 };
    case 'pick-paste-source':
      return { ...state, channel: 'paste', pasteSource: event.source, step: 2 };
    case 'back':
      if (state.step === 4) return state;
      return state.step > 1 ? { ...state, step: (state.step - 1) as ImportStep } : state;
    case 'accepted':
      return { ...state, step: 3 };
    case 'done':
      return { ...state, step: 4 };
    case 'restart':
      return INITIAL_FLOW;
  }
}

/** 上一步只出现在取材与预览两步：完成页用「继续导入」重新开始。 */
export function canGoBack(step: ImportStep): boolean {
  return step === 2 || step === 3;
}

export interface ConflictInfo {
  /** 重复预检已与当前列表对齐，才允许标注与筛选 */
  known: boolean;
  conflictCount: number;
  /** 筛选是否真正生效：预检未完成前先按全量显示，避免闪一屏空列表 */
  filtering: boolean;
}

export function conflictInfo(
  count: number,
  duplicateFlags: readonly boolean[],
  conflictOnly: boolean,
): ConflictInfo {
  const known = count > 0 && duplicateFlags.length === count;
  const conflictCount = known ? duplicateFlags.filter((flag) => flag).length : 0;
  return { known, conflictCount, filtering: conflictOnly && known };
}

/** 可见行下标：筛选只改显示，不改变勾选语义。 */
export function visibleRowIndexes(
  count: number,
  duplicateFlags: readonly boolean[],
  conflictOnly: boolean,
): number[] {
  const all = Array.from({ length: count }, (_, index) => index);
  return conflictInfo(count, duplicateFlags, conflictOnly).filtering
    ? all.filter((index) => duplicateFlags[index] === true)
    : all;
}

export type SelectionMode = 'all' | 'none' | 'invert';

/** 批选只作用于传入的下标（可见行）：隐藏行的勾选状态原样保留。 */
export function applySelection(
  current: ReadonlySet<number>,
  indexes: readonly number[],
  mode: SelectionMode,
): Set<number> {
  const next = new Set(current);
  for (const index of indexes) {
    if (mode === 'all') next.add(index);
    else if (mode === 'none') next.delete(index);
    else if (next.has(index)) next.delete(index);
    else next.add(index);
  }
  return next;
}

export function toggleSelection(current: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(current);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

export function selectedCount(indexes: readonly number[], selected: ReadonlySet<number>): number {
  return indexes.filter((index) => selected.has(index)).length;
}

export function previewSummary(
  count: number,
  selected: number,
  conflictCount: number,
  known: boolean,
): string {
  const base = `解析到 ${count} 条排课，已选 ${selected} 条`;
  return known && conflictCount > 0 ? `${base} · 其中 ${conflictCount} 条重复` : base;
}

export type FileKind = 'ics' | 'sheet' | 'unknown';

export const FILE_ACCEPT = '.ics,.csv,.xlsx,.txt';

export function fileKind(fileName: string): FileKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.ics')) return 'ics';
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.txt')) return 'sheet';
  return 'unknown';
}

export function fileKindLabel(kind: FileKind): string {
  switch (kind) {
    case 'ics':
      return '日历文件';
    case 'sheet':
      return '表格文件';
    case 'unknown':
      return '未知文件';
  }
}

/** 文件渠道对非支持格式的就近说明：不进入解析，避免给出看不懂的内部错误。 */
export function unsupportedFileReason(fileName: string): string {
  return `不支持「${fileName}」：请选择 .csv / .xlsx / .ics 文件`;
}

/** 预览表格已按卡片行展示：这里统一给出星期与节次的短文案。 */
export function scheduleMeta(item: ImportedSchedule): { day: string; periods: string; weeks: string; room: string } {
  return {
    day: `周${item.dayOfWeek}`,
    periods: `${item.periodStart}-${item.periodEnd} 节`,
    weeks: `${item.weeks.length} 周`,
    room: item.room ?? '—',
  };
}
