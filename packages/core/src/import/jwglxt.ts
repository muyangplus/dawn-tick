import type { ImportedSchedule } from './apply.ts';
import { looksLikeRoom } from './csv.ts';
import { parseWeeksText } from './weeks-text.ts';

export interface JwglxtCell {
  dayOfWeek: number;
  periodNo: number;
  /** 连堂常以 rowspan 表示，跨的节数在这里 */
  rowSpan: number;
  raw: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|span|td|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function rowSpanOf(tag: string): number {
  const match = /rowspan\s*=\s*["']?(\d+)["']?/i.exec(tag);
  const value = match === null ? 1 : Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.min(20, value) : 1;
}

/** 解析正方课表页：新版为按 `id="日-节"` 标记的网格，旧版为 kbtable 表格。 */
export function parseTimetableCells(html: string): JwglxtCell[] {
  const cells: JwglxtCell[] = [];
  const grid = /<(\w+)\b([^>]*id\s*=\s*["'](\d{1,2})[-_](\d{1,2})["'][^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(grid)) {
    const day = Number(match[3]);
    const period = Number(match[4]);
    if (day < 1 || day > 7 || period < 1 || period > 40) continue;
    cells.push({
      dayOfWeek: day,
      periodNo: period,
      rowSpan: rowSpanOf(match[2] ?? ''),
      raw: stripTags(match[5] ?? ''),
    });
  }
  if (cells.length > 0) return cells;

  const table = /<table[^>]*id\s*=\s*["']kbtable["'][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (table === undefined) return [];
  const rows = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const [rowIndex, row] of rows.entries()) {
    const columns = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    for (const [columnIndex, column] of columns.entries()) {
      const day = columnIndex;
      if (day < 1 || day > 7) continue;
      cells.push({
        dayOfWeek: day,
        periodNo: rowIndex,
        rowSpan: rowSpanOf(/^<td\b[^>]*>/i.exec(column)?.[0] ?? ''),
        raw: stripTags(column),
      });
    }
  }
  return cells;
}

interface ParsedCell {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  name: string;
  teacher: string | null;
  room: string | null;
  weeksText: string | null;
  weeks: number[] | null;
}

export function parseTimetable(
  html: string,
  options: { totalWeeks?: number } = {},
): { schedules: ImportedSchedule[]; warnings: string[] } {
  const totalWeeks = options.totalWeeks ?? 20;
  const warnings: string[] = [];
  const parsed: ParsedCell[] = [];

  for (const cell of parseTimetableCells(html)) {
    const lines = cell.raw
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    const name = lines[0] ?? '';
    if (name.length === 0) continue;
    const weeksText = lines.find((line) => /周|单|双/.test(line)) ?? null;
    const others = lines.slice(1).filter((line) => line !== weeksText);
    const room = others.find((line) => looksLikeRoom(line)) ?? null;
    const teacher = others.find((line) => line !== room) ?? null;

    parsed.push({
      dayOfWeek: cell.dayOfWeek,
      periodStart: cell.periodNo,
      periodEnd: cell.periodNo + Math.max(1, cell.rowSpan) - 1,
      name,
      teacher,
      room,
      weeksText,
      weeks: weeksText === null ? null : parseWeeksText(weeksText, totalWeeks),
    });
  }

  if (parsed.length === 0) {
    warnings.push('未从课表页解析出课程');
    return { schedules: [], warnings };
  }

  // 同一门课在相邻节次重复出现时合并为一个连堂排课
  const merged: ImportedSchedule[] = [];
  const groups = new Map<string, ParsedCell[]>();
  for (const cell of parsed) {
    const key = `${cell.dayOfWeek}|${cell.name}|${cell.room ?? ''}|${cell.weeksText ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(cell);
    groups.set(key, list);
  }

  for (const list of groups.values()) {
    const sorted = [...list].sort((left, right) => left.periodStart - right.periodStart);
    let runStart = sorted[0] as ParsedCell;
    let previous = runStart;

    const flush = (start: ParsedCell, end: ParsedCell): void => {
      merged.push({
        courseName: start.name,
        dayOfWeek: start.dayOfWeek,
        periodStart: start.periodStart,
        periodEnd: Math.max(end.periodEnd, start.periodEnd),
        weeks: start.weeks ?? Array.from({ length: totalWeeks }, (_, index) => index + 1),
        room: start.room,
        teacher: start.teacher,
      });
      if (start.weeks === null) warnings.push(`${start.name} 未标注周次，按全周导入`);
    };

    for (const cell of sorted.slice(1)) {
      if (cell.periodStart <= previous.periodEnd + 1) {
        previous = cell;
        continue;
      }
      flush(runStart, previous);
      runStart = cell;
      previous = cell;
    }
    flush(runStart, previous);
  }

  return { schedules: merged, warnings };
}
