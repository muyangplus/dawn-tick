import type { ImportedSchedule } from './apply.ts';
import { MAX_PERIODS } from '../timetable.ts';
import { looksLikeRoom } from './csv.ts';
import { attribute, findWeekdayHeader, parseHtmlTables, stripTags, weekdayTableCells } from './html-grid.ts';
import { parseWeeksText } from './weeks-text.ts';

export interface JwglxtCell {
  dayOfWeek: number;
  periodNo: number;
  /** 连堂常以 rowspan 表示，跨的节数在这里 */
  rowSpan: number;
  raw: string;
}

function rowSpanOf(tag: string): number {
  const value = Number(attribute(tag, 'rowspan') ?? '1');
  return Number.isFinite(value) && value > 0 ? Math.min(20, Math.floor(value)) : 1;
}

/** 解析正方课表页：新版为按 `id="日-节"` 标记的网格，旧版为 kbtable 表格。 */
export function parseTimetableCells(html: string): JwglxtCell[] {
  const cells: JwglxtCell[] = [];
  const grid = /<(\w+)\b([^>]*\bid\s*=\s*["'](\d{1,2})[-_](\d{1,2})["'][^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(grid)) {
    const day = Number(match[3]);
    const period = Number(match[4]);
    if (day < 1 || day > 7 || period < 1 || period > MAX_PERIODS) continue;
    cells.push({
      dayOfWeek: day,
      periodNo: period,
      rowSpan: rowSpanOf(`<x ${match[2] ?? ''}>`),
      raw: stripTags(match[5] ?? '', { spanBreaks: true }),
    });
  }
  if (cells.length > 0) return cells;

  const table = parseHtmlTables(html).find((item) => /\bid\s*=\s*["']?kbtable\b/i.test(item.html.slice(0, 400)));
  if (table === undefined) return [];
  // 旧版 kbtable：有星期表头就按表头定列，没有就按「第 0 列节次、1–7 列周一到周日」
  const header = findWeekdayHeader(table);
  const days = header?.days ?? new Map(Array.from({ length: 7 }, (_, index) => [index + 1, index + 1] as const));
  for (const cell of weekdayTableCells(table, header?.row ?? 0, days)) {
    cells.push({
      dayOfWeek: cell.dayOfWeek,
      periodNo: cell.periodStart,
      rowSpan: cell.periodEnd - cell.periodStart + 1,
      raw: stripTags(cell.slot.cell.html, { spanBreaks: true }),
    });
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
    // 首行是课程名（如「周易」），不当周次行
    const weeksText = lines.slice(1).find((line) => /周|单|双/.test(line)) ?? null;
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
