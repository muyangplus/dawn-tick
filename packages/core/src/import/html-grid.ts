/**
 * 网页表格解析：按 HTML 表格规则把 rowspan / colspan 摊到逻辑网格上。
 * 正方旧版 kbtable 与通用「星期表头」表格共用这一份，连堂（rowspan）不会让后面几行的列错位。
 */

import { matchWeekday, parsePeriodLabel } from './csv.ts';

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** 跨度上限：防止异常页面把网格撑到不合理的大小 */
const MAX_SPAN = 40;

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/gi, (match) => ENTITIES[match.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

/**
 * 去标签取文本：块级结束与 `<br>` 换成换行，行内空白折叠。
 * 正方网格把课程名、教师、地点各放一个 `<span>`，`spanBreaks` 让它们也各占一行。
 */
export function stripTags(html: string, options: { spanBreaks?: boolean } = {}): string {
  const blocks = options.spanBreaks === true ? /<\/(p|div|td|th|li|tr|span)>/gi : /<\/(p|div|td|th|li|tr)>/gi;
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(blocks, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .trim();
}

export interface HtmlCell {
  html: string;
  /** 打开标签本身（读 id / class 等属性用） */
  openTag: string;
  rowspan: number;
  colspan: number;
}

export interface HtmlRow {
  cells: HtmlCell[];
}

/** 逻辑网格里的一格：指向占据它的单元格以及该单元格的起点。 */
export interface GridSlot {
  cell: HtmlCell;
  row: number;
  col: number;
}

export interface HtmlTable {
  /** 表格原文（打分、识别用） */
  html: string;
  /** 源码里的行与单元格，未展开跨度 */
  rows: HtmlRow[];
  /** 展开跨度后的逻辑网格：grid[行][列] */
  grid: Array<Array<GridSlot | undefined>>;
}

export function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function spanOf(tag: string, name: string): number {
  const value = Number(attribute(tag, name) ?? '1');
  return Number.isFinite(value) && value >= 1 ? Math.min(MAX_SPAN, Math.floor(value)) : 1;
}

/** 按 HTML 表格的放置规则把跨行跨列摊开。 */
export function layoutGrid(rows: readonly HtmlRow[]): Array<Array<GridSlot | undefined>> {
  const grid: Array<Array<GridSlot | undefined>> = rows.map(() => []);
  for (const [rowIndex, row] of rows.entries()) {
    const line = grid[rowIndex] as Array<GridSlot | undefined>;
    let col = 0;
    for (const cell of row.cells) {
      while (line[col] !== undefined) col += 1;
      const slot: GridSlot = { cell, row: rowIndex, col };
      for (let dr = 0; dr < cell.rowspan && rowIndex + dr < rows.length; dr += 1) {
        const target = grid[rowIndex + dr] as Array<GridSlot | undefined>;
        for (let dc = 0; dc < cell.colspan; dc += 1) target[col + dc] = slot;
      }
      col += cell.colspan;
    }
  }
  return grid;
}

/** 页面里所有至少两行的表格。嵌套表格按出现顺序各自独立解析。 */
export function parseHtmlTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows: HtmlRow[] = [];
    for (const rowHtml of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells: HtmlCell[] = [];
      for (const tag of rowHtml.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []) {
        const openTag = /^<t[dh]\b[^>]*>/i.exec(tag)?.[0] ?? '';
        cells.push({
          html: tag.slice(openTag.length).replace(/<\/t[dh]>$/i, ''),
          openTag,
          rowspan: spanOf(openTag, 'rowspan'),
          colspan: spanOf(openTag, 'colspan'),
        });
      }
      if (cells.length > 0) rows.push({ cells });
    }
    if (rows.length > 1) tables.push({ html: table, rows, grid: layoutGrid(rows) });
  }
  return tables;
}

/** 某一行里以该行为起点的单元格（被上方 rowspan 占住的格子不算）。 */
export function originSlots(table: HtmlTable, row: number): GridSlot[] {
  const seen = new Set<HtmlCell>();
  const out: GridSlot[] = [];
  for (const slot of table.grid[row] ?? []) {
    if (slot === undefined || slot.row !== row || seen.has(slot.cell)) continue;
    seen.add(slot.cell);
    out.push(slot);
  }
  return out;
}

/** 表头行里星期所在的逻辑列（跨列的星期表头每一列都算）。 */
export function weekdayColumns(table: HtmlTable, row: number): Map<number, number> {
  const columns = new Map<number, number>();
  for (const slot of originSlots(table, row)) {
    const day = matchWeekday(stripTags(slot.cell.html));
    if (day === null) continue;
    for (let offset = 0; offset < slot.cell.colspan; offset += 1) columns.set(slot.col + offset, day);
  }
  return columns;
}

/** 前几行里第一个有至少 3 个星期的表头行。 */
export function findWeekdayHeader(table: HtmlTable, maxRow = 3): { row: number; days: Map<number, number> } | null {
  for (let row = 0; row < Math.min(maxRow, table.rows.length); row += 1) {
    const days = weekdayColumns(table, row);
    if (new Set(days.values()).size >= 3) return { row, days };
  }
  return null;
}

export interface PeriodSpan {
  start: number;
  end: number;
}

/**
 * 某一行代表的节次：从星期列左侧（或指定的节次列）由近到远找第一个能读出节次的格子。
 * 节次格自己跨多行时（如「1-2节」rowspan=2），按行偏移取其中一节；找不到返回 null。
 */
export function rowPeriod(table: HtmlTable, row: number, labelColumns: readonly number[]): PeriodSpan | null {
  for (const col of labelColumns) {
    const slot = table.grid[row]?.[col];
    if (slot === undefined) continue;
    const label = parsePeriodLabel(stripTags(slot.cell.html));
    if (label === null) continue;
    if (slot.cell.rowspan > 1) {
      const period = Math.min(label.periodEnd, label.periodStart + (row - slot.row));
      return { start: period, end: period };
    }
    return { start: label.periodStart, end: label.periodEnd };
  }
  return null;
}

export interface GridCourseCell {
  slot: GridSlot;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
}

/**
 * 星期表头表格里的课程格：每个以本行为起点、落在星期列上的格子一条，
 * 节次取格内「第 N 节」→ 行的节次标签 → 行号，rowspan 的格子按末行的节次给出结束节。
 */
export function weekdayTableCells(
  table: HtmlTable,
  headerRow: number,
  days: ReadonlyMap<number, number>,
  periodColumn: number | null = null,
): GridCourseCell[] {
  const firstDayColumn = Math.min(...days.keys());
  const labelColumns =
    periodColumn !== null
      ? [periodColumn]
      : Array.from({ length: Math.max(0, firstDayColumn) }, (_, index) => firstDayColumn - 1 - index);
  const periodOfRow = (row: number): PeriodSpan => {
    const fallback = Math.max(1, row - headerRow);
    return rowPeriod(table, row, labelColumns) ?? { start: fallback, end: fallback };
  };

  const out: GridCourseCell[] = [];
  for (let row = headerRow + 1; row < table.rows.length; row += 1) {
    for (const slot of originSlots(table, row)) {
      const day = days.get(slot.col);
      if (day === undefined) continue;
      const text = stripTags(slot.cell.html);
      const inCell = /节/.test(text) ? parsePeriodLabel(text) : null;
      const lastRow = Math.min(table.rows.length - 1, row + slot.cell.rowspan - 1);
      const start = inCell?.periodStart ?? periodOfRow(row).start;
      const end = inCell?.periodEnd ?? periodOfRow(lastRow).end;
      out.push({ slot, dayOfWeek: day, periodStart: start, periodEnd: Math.max(start, end) });
    }
  }
  return out;
}
