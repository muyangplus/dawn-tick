import type { ImportedSchedule } from './apply.ts';
import { looksLikeRoom, matchWeekday, parsePeriodLabel } from './csv.ts';
import { parseTimetable, parseTimetableCells } from './jwglxt.ts';
import { looksLikeWeeks, parseWeeksText } from './weeks-text.ts';

export type PageShape = 'grid' | 'weekday-table' | 'none';

export interface PageExtractResult {
  schedules: ImportedSchedule[];
  warnings: string[];
  shape: PageShape;
  tables: number;
}

export interface PageExtractOptions {
  totalWeeks?: number;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (match) => ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|td|th|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();
}

function cellLines(html: string): string[] {
  return stripTags(html)
    .split(/\n|@|;|\|/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface RawCell {
  html: string;
  colspan: number;
  rowspan: number;
}

interface RawRow {
  cells: RawCell[];
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return match?.[1] ?? null;
}

function parseTables(html: string): RawRow[][] {
  const tables: RawRow[][] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows: RawRow[] = [];
    for (const rowHtml of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells: RawCell[] = [];
      for (const tag of rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []) {
        const open = /^<t[dh][^>]*>/i.exec(tag)?.[0] ?? '';
        const inner = tag.slice(open.length).replace(/<\/t[dh]>$/i, '');
        cells.push({
          html: inner,
          colspan: Math.max(1, Number(attribute(open, 'colspan') ?? '1') || 1),
          rowspan: Math.max(1, Number(attribute(open, 'rowspan') ?? '1') || 1),
        });
      }
      if (cells.length > 0) rows.push({ cells });
    }
    if (rows.length > 1) tables.push(rows);
  }
  return tables;
}

function pickTeacher(lines: readonly string[], used: readonly (string | null)[]): string | null {
  for (const line of lines) {
    if (used.includes(line)) continue;
    if (looksLikeWeeks(line)) continue;
    if (looksLikeRoom(line)) continue;
    if (/^[\u4e00-\u9fa5·]{2,6}$/.test(line) || /^[A-Za-z][A-Za-z .]{1,20}$/.test(line)) return line;
  }
  return null;
}

function buildSchedule(
  rawHtml: string,
  dayOfWeek: number,
  periodStart: number,
  periodEnd: number,
  totalWeeks: number,
): ImportedSchedule | null {
  const lines = cellLines(rawHtml);
  if (lines.length === 0) return null;
  const name = lines[0] ?? '';
  if (name.length === 0 || name.length > 60) return null;
  if (matchWeekday(name) !== null) return null;

  const weeksLine = lines.find((line) => looksLikeWeeks(line)) ?? null;
  const weeks = weeksLine === null ? null : parseWeeksText(weeksLine, totalWeeks);
  const room = lines.find((line) => line !== name && looksLikeRoom(line)) ?? null;
  const teacher = pickTeacher(lines, [name, room, weeksLine]);

  return {
    courseName: name,
    dayOfWeek,
    periodStart,
    periodEnd,
    weeks: weeks ?? Array.from({ length: totalWeeks }, (_item, index) => index + 1),
    room,
    teacher,
  };
}

/**
 * 从任意教务页面识别课表：先按正方式「日-节」网格，再按「星期表头」表格。
 * 只依赖页面结构，不绑定具体学校。
 */
export function extractTimetableFromHtml(html: string, options: PageExtractOptions = {}): PageExtractResult {
  const totalWeeks = options.totalWeeks ?? 20;
  const warnings: string[] = [];

  if (/id\s*=\s*["']?\d{1,2}-\d{1,2}["']?/i.test(html) || /id\s*=\s*["']?kbtable/i.test(html)) {
    const cells = parseTimetableCells(html);
    if (cells.length > 0) {
      const parsed = parseTimetable(html, { totalWeeks });
      return {
        schedules: parsed.schedules,
        warnings: parsed.warnings,
        shape: 'grid',
        tables: parseTables(html).length,
      };
    }
  }

  const tables = parseTables(html);
  let best: { schedules: ImportedSchedule[]; headerRow: number; table: RawRow[]; dayColumns: Map<number, number> } | null =
    null;

  for (const rows of tables) {
    for (let headerIndex = 0; headerIndex < Math.min(3, rows.length); headerIndex += 1) {
      const header = rows[headerIndex];
      if (header === undefined) continue;
      const dayColumns = new Map<number, number>();
      let column = 0;
      for (const cell of header.cells) {
        const day = matchWeekday(stripTags(cell.html));
        if (day !== null) dayColumns.set(column, day);
        column += cell.colspan;
      }
      if (dayColumns.size < 3) continue;

      const schedules: ImportedSchedule[] = [];
      for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (row === undefined) continue;
        const label = stripTags(row.cells[0]?.html ?? '');
        const labelPeriod = parsePeriodLabel(label);
        let column = 0;
        let period = labelPeriod?.periodStart ?? null;
        for (const cell of row.cells) {
          const day = dayColumns.get(column);
          if (day !== undefined) {
            const cellPeriod = parsePeriodLabel(stripTags(cell.html))?.periodStart ?? null;
            const start = cellPeriod ?? period ?? rowIndex - headerIndex;
            const end = cellPeriod ?? period ?? start;
            const schedule = buildSchedule(cell.html, day, start, Math.max(start, end), totalWeeks);
            if (schedule !== null) schedules.push(schedule);
          }
          column += cell.colspan;
        }
      }
      if (best === null || schedules.length > best.schedules.length) {
        best = { schedules, headerRow: headerIndex, table: rows, dayColumns };
      }
      break;
    }
  }

  if (best === null || best.schedules.length === 0) {
    warnings.push('未在页面中识别到课表，请确认已打开课表页，或改用文件导入');
    return { schedules: [], warnings, shape: 'none', tables: tables.length };
  }
  if (best.headerRow > 0) warnings.push('表头不在首行，已按识别到的星期列解析');
  return { schedules: best.schedules, warnings, shape: 'weekday-table', tables: tables.length };
}

/** 页面里是否出现了课表特征，用于判断用户是否已到课表页。 */
export function looksLikeTimetablePage(html: string): boolean {
  if (/id\s*=\s*["']?\d{1,2}-\d{1,2}["']?/i.test(html)) return true;
  const tables = parseTables(html);
  for (const rows of tables) {
    for (const row of rows.slice(0, 3)) {
      const days = new Set<number>();
      for (const cell of row.cells) {
        const day = matchWeekday(stripTags(cell.html));
        if (day !== null) days.add(day);
      }
      if (days.size >= 3) return true;
    }
  }
  return false;
}

/** 书签小工具：在教务页面点一下即把页面源码复制到剪贴板。 */
export const PAGE_BOOKMARKLET = `javascript:(()=>{const h='<<<DAWNTICK>>>'+document.documentElement.outerHTML+'<<<END>>>';navigator.clipboard.writeText(h).then(()=>alert('课表页面已复制，回到晓刻粘贴即可')).catch(()=>prompt('复制下面的内容，回晓刻粘贴',h));})();`;

export function stripPageMarkers(text: string): string {
  return text.replace(/^[\s\S]*?<<<DAWNTICK>>>/, '').replace(/<<<END>>>[\s\S]*$/, '');
}
