import {
  countPastedFrames,
  matchWeekday,
  parsePeriodLabel,
  type PageDiagnostics,
  type PageInspection,
  type PageShape,
} from '@dawn-tick/core';
import { formatLogTimestamp } from '../log.ts';

/**
 * 导入识别诊断：把「为什么没识别出来」整理成用户能看懂、也不会泄露页面隐私的摘要。
 *
 * 边界：
 * - 本模块只做纯计算（摘要、脱敏、文本渲染），不读写 DOM、不发请求、不写日志；
 * - 界面与日志只消费这里的结果，不再各自拼字段；
 * - 脱敏规则集中在这里：URL 只保留协议 + 主机（去掉路径、query、fragment），
 *   标题截断到 40 字，样例行压成单行并截断到 120 字。
 */

/** 页面诊断里最多展示几行样例。 */
export const SAMPLE_ROW_LIMIT = 3;
/** 样例行单行上限（含省略号）。 */
export const SAMPLE_ROW_MAX_CHARS = 120;
/** 页面标题上限（含省略号）。 */
export const PAGE_TITLE_MAX_CHARS = 40;
/** 复制/导出文本里的导入来源：诊断面板只出现在网页粘贴渠道。 */
export const IMPORT_SOURCE_LABEL = '粘贴网页课表';

export type ImportShape = PageShape | 'none';

/** 识别入口给出的结果摘要，用于判断「识别失败」还是「结果可疑」。 */
export interface ImportResultSummary {
  shape: ImportShape;
  schedules: number;
}

export interface ImportDiagnosticsInput {
  /** 粘贴框里的原始内容（含书签诊断帧） */
  text: string;
  /** 书签或桌面注入脚本带回的诊断；旧版内容为 null */
  diagnostics: PageDiagnostics | null;
  /** inspectPage 读到的表格预览；没有时仍能给出计数，但没有样例行 */
  inspection?: PageInspection | null;
  /** 最近一次识别结果 */
  result?: ImportResultSummary | null;
  /** 手动映射时用用户实际指定的行列覆盖自动推断 */
  mapping?: ImportFieldMapping | null | undefined;
  /** 诊断缺失时的加载兜底（例如窗口回传时页面还没渲染完） */
  loading?: boolean;
}

/** 从表格预览里推断出的字段映射，口径与 core 的自动识别一致（表头行 + 星期列 + 节次列）。 */
export interface ImportFieldMapping {
  headerRow: number;
  /** 星期列起始序号（0 起） */
  dayStartColumn: number;
  dayCount: number;
  /** 节次列；null 表示按行号推断 */
  periodColumn: number | null;
  /** 识别到的星期表头文字，例如「星期一」 */
  dayLabels: string[];
}

/** 脱敏后的页面诊断：字段名与 core 的 PageDiagnostics 一致，但值都已裁掉隐私部分。 */
export interface SanitizedPageDiagnostics {
  v: number | null;
  url: string | null;
  title: string | null;
  frames: number;
  tables: number;
  kbTables: number;
  gridCells: number;
  ready: string | null;
  loading: boolean;
}

export interface ImportDiagnosticsSummary {
  frames: number;
  tables: number;
  kbTables: number;
  gridCells: number;
  loading: boolean;
  ready: string | null;
  /** 脱敏后的页面地址：只有协议 + 主机 */
  url: string | null;
  /** 截断后的页面标题 */
  title: string | null;
  /** 命中的教务系统名称；没有则为 null */
  system: string | null;
  shape: ImportShape | null;
  schedules: number | null;
  /** 是否真的带着书签/窗口诊断；false 表示计数是按粘贴内容估算的 */
  fromPage: boolean;
  /** 前 3 行样例，每行 ≤120 字符 */
  sampleRows: string[];
  mapping: ImportFieldMapping | null;
  pageDiagnostics: SanitizedPageDiagnostics | null;
}

export interface ImportDiagnosticsMeta {
  version: string;
  /** 渠道展示名，例如「开发版」 */
  channel: string;
  /** 导入来源，例如「粘贴网页课表」 */
  source: string;
  generatedAt: number;
}

export interface RenderImportDiagnosticsOptions {
  /** 追加「相关日志」小节（导出时用；复制时省略，避免内容过长） */
  logLines?: readonly string[];
}

/** 单行化并截断：换行、连续空白压成一个空格，超出上限时补省略号。 */
export function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

/**
 * URL 脱敏：只保留协议 + 主机，去掉路径、query 与 fragment。
 * 只接受 http(s)；其它协议与无法解析的内容一律返回 null，避免把奇怪的内容带进反馈文本。
 */
export function sanitizePageUrl(raw: string | null | undefined): string | null {
  const text = raw?.trim() ?? '';
  if (text === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return /^(https?:\/\/[^/?#]+)/i.exec(text)?.[1] ?? null;
  }
}

/** 按 `<table>` 标签数估算表格数：旧版书签没有诊断字段时的兜底。 */
function estimateTableCount(text: string): number {
  return (text.match(/<table\b/gi) ?? []).length;
}

function cellText(row: readonly string[] | undefined): string[] {
  return (row ?? []).map((cell) => cell.replace(/\s+/g, ' ').trim()).filter((cell) => cell !== '');
}

/**
 * 从表格预览的前 3 行里找星期表头，得到「表头行 / 星期列 / 节次列」。
 * 自动识别走的是同一套启发式（表头在前 3 行、至少 3 个星期列），这里只做可读化。
 */
export function deriveFieldMapping(inspection: PageInspection | null | undefined): ImportFieldMapping | null {
  const rows = inspection?.tables[0]?.rows;
  if (rows === undefined) return null;

  for (let headerRow = 0; headerRow < Math.min(3, rows.length); headerRow += 1) {
    const dayColumns: { column: number; label: string }[] = [];
    for (const [column, cell] of (rows[headerRow] ?? []).entries()) {
      if (matchWeekday(cell) === null) continue;
      const label = truncateText(cell, 8);
      if (label !== '') dayColumns.push({ column, label });
    }
    if (dayColumns.length < 3) continue;

    const first = dayColumns[0];
    if (first === undefined) continue;
    const periodColumn = inferPeriodColumn(rows, headerRow);
    return {
      headerRow,
      dayStartColumn: first.column,
      dayCount: dayColumns.length,
      periodColumn,
      dayLabels: dayColumns.slice(0, 7).map((day) => day.label),
    };
  }
  return null;
}

/** 表头下面两行的第一列若带「第 n 节」，就认为节次在 0 列；否则按行号推断。 */
function inferPeriodColumn(rows: readonly string[][], headerRow: number): number | null {
  for (let rowIndex = headerRow + 1; rowIndex < Math.min(headerRow + 3, rows.length); rowIndex += 1) {
    const first = rows[rowIndex]?.[0] ?? '';
    if (parsePeriodLabel(first) !== null) return 0;
  }
  return null;
}

function sampleRowsOf(inspection: PageInspection | null | undefined): string[] {
  const rows = inspection?.tables[0]?.rows ?? [];
  return rows
    .slice(0, SAMPLE_ROW_LIMIT)
    .map((row) => truncateText(cellText(row).join(' | '), SAMPLE_ROW_MAX_CHARS))
    .filter((row) => row !== '');
}

function sanitizedPageDiagnostics(
  source: PageDiagnostics | null,
  url: string | null,
  title: string | null,
): SanitizedPageDiagnostics | null {
  if (source === null) return null;
  return {
    v: source.v ?? null,
    url,
    title,
    frames: source.frames ?? 0,
    tables: source.tables ?? 0,
    kbTables: source.kbTables ?? 0,
    gridCells: source.gridCells ?? 0,
    ready: source.ready ?? null,
    loading: source.loading === true,
  };
}

/** 组装诊断摘要：所有对外文本、日志与复制内容都以它为唯一来源。 */
export function buildImportDiagnostics(input: ImportDiagnosticsInput): ImportDiagnosticsSummary {
  const source = input.diagnostics;
  const inspection = input.inspection ?? null;
  const url = sanitizePageUrl(source?.url);
  const title = source?.title === undefined ? null : truncateText(source.title, PAGE_TITLE_MAX_CHARS) || null;

  const frames = source?.frames ?? (input.text.trim() === '' ? 0 : countPastedFrames(input.text));
  const tables = source?.tables ?? estimateTableCount(input.text);
  const loading = source?.loading === true || input.loading === true;

  return {
    frames,
    tables,
    kbTables: source?.kbTables ?? 0,
    gridCells: source?.gridCells ?? 0,
    loading,
    ready: source?.ready ?? null,
    url,
    title,
    system: inspection?.system.label ?? null,
    shape: input.result?.shape ?? null,
    schedules: input.result?.schedules ?? null,
    fromPage: source !== null,
    sampleRows: sampleRowsOf(inspection),
    mapping: input.mapping === undefined ? deriveFieldMapping(inspection) : input.mapping,
    pageDiagnostics: sanitizedPageDiagnostics(source, url, title),
  };
}

/** 字段映射的可读文案：页面里没有星期表头时明确说「按通用启发式」。 */
export function mappingText(mapping: ImportFieldMapping | null): string {
  if (mapping === null) return '未匹配到星期表头（按通用启发式解析）';
  const period = mapping.periodColumn === null ? '按行号' : String(mapping.periodColumn);
  const lastDay = mapping.dayStartColumn + mapping.dayCount - 1;
  const labels = mapping.dayLabels.length === 0 ? '' : `（${mapping.dayLabels.join(' ')}）`;
  return `表头行 ${mapping.headerRow} · 星期列 ${mapping.dayStartColumn}–${lastDay}${labels} · 节次列 ${period}`;
}

const SHAPE_LABEL: Record<ImportShape, string> = {
  grid: '「日-节」网格',
  'weekday-table': '星期表头表格',
  none: '未识别',
};

function shapeLabel(shape: ImportShape | null): string {
  return shape === null ? '未执行识别' : SHAPE_LABEL[shape];
}

/**
 * 复制/导出共用的纯文本：应用版本、渠道、导入来源、摘要、字段映射、诊断 JSON 与样例行。
 * 日志行只在导出时追加，复制内容保持精简。
 */
export function renderImportDiagnosticsText(
  summary: ImportDiagnosticsSummary,
  meta: ImportDiagnosticsMeta,
  options: RenderImportDiagnosticsOptions = {},
): string {
  const lines: string[] = [
    'DawnTick 导入识别诊断',
    `生成时间：${formatLogTimestamp(meta.generatedAt)}`,
    `应用版本：${meta.version}（${meta.channel}）`,
    `导入来源：${meta.source}`,
    '',
    '— 诊断摘要 —',
    `帧数：${summary.frames}`,
    `表格数：${summary.tables}${summary.fromPage ? '' : '（按粘贴内容估算）'}`,
    `疑似课表数：${summary.kbTables}`,
    `网格单元数：${summary.gridCells}`,
    `是否仍在加载：${summary.loading ? '是' : '否'}`,
  ];
  if (summary.ready !== null) lines.push(`文档状态：${summary.ready}`);
  if (summary.url !== null) lines.push(`页面地址：${summary.url}`);
  if (summary.title !== null) lines.push(`页面标题：${summary.title}`);
  if (summary.system !== null) lines.push(`命中系统：${summary.system}`);
  lines.push(`识别形态：${shapeLabel(summary.shape)}`);
  if (summary.schedules !== null) lines.push(`识别结果：${summary.schedules} 条排课`);
  lines.push(`字段映射：${mappingText(summary.mapping)}`);

  lines.push('', '— 页面诊断 JSON —');
  lines.push(
    summary.pageDiagnostics === null
      ? '无（内容没有携带书签或窗口诊断）'
      : JSON.stringify(summary.pageDiagnostics, null, 2),
  );

  lines.push('', `— 前 ${SAMPLE_ROW_LIMIT} 行样例（每行 ≤${SAMPLE_ROW_MAX_CHARS} 字符）—`);
  if (summary.sampleRows.length === 0) lines.push('（没有可用的表格样例）');
  else summary.sampleRows.forEach((row, index) => lines.push(`${index + 1}. ${row}`));

  if (options.logLines !== undefined) {
    lines.push('', '— 相关日志 —');
    if (options.logLines.length === 0) lines.push('（暂无）');
    else lines.push(...options.logLines);
  }

  return lines.join('\n');
}

/** 结构化日志详情：只含脱敏后的原始类型字段，不含粘贴正文。 */
export function importDiagnosticsLogDetail(
  summary: ImportDiagnosticsSummary,
  meta: ImportDiagnosticsMeta,
): Record<string, unknown> {
  return {
    version: meta.version,
    channel: meta.channel,
    source: meta.source,
    frames: summary.frames,
    tables: summary.tables,
    kbTables: summary.kbTables,
    gridCells: summary.gridCells,
    loading: summary.loading,
    ready: summary.ready,
    url: summary.url,
    title: summary.title,
    system: summary.system,
    shape: summary.shape,
    schedules: summary.schedules,
    fromPage: summary.fromPage,
    mapping:
      summary.mapping === null
        ? null
        : {
            headerRow: summary.mapping.headerRow,
            dayStartColumn: summary.mapping.dayStartColumn,
            dayCount: summary.mapping.dayCount,
            periodColumn: summary.mapping.periodColumn,
            dayLabels: summary.mapping.dayLabels,
          },
    samples: summary.sampleRows,
    pageDiagnostics: summary.pageDiagnostics,
  };
}
