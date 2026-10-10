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
  /** 手动指定映射，给出后不再走启发式 */
  mapping?: PageMapping;
}

/** 用户手动校正的映射：表头行、星期起始列与列数、节次列。 */
export interface PageMapping {
  headerRow: number;
  /** 星期列起始序号（0 起） */
  dayStartColumn: number;
  dayCount: number;
  /** 节次所在的列；为 null 时用行号推断 */
  periodColumn: number | null;
}

export interface PageTablePreview {
  index: number;
  rows: string[][];
}

export interface PageInspection {
  tables: PageTablePreview[];
  system: SystemInfo;
}

export interface SystemInfo {
  id: 'jwglxt' | 'qzdatasource' | 'urp' | 'unknown';
  label: string;
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

/** 单元格里的节次只在出现「节」或时间范围时才可信，避免把「3-5周」当成节次。 */
function periodFromCell(text: string): number | null {
  if (!/节|\d{1,2}:\d{2}/.test(text)) return null;
  return parsePeriodLabel(text)?.periodStart ?? null;
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
 * 已知教务系统标记。命中只用于提高命中率与提示，通用启发式仍然生效。
 */
export function detectSystem(html: string): SystemInfo {
  if (/jwglxt|xskb_list|timetable_con|kbgrid_table/i.test(html)) {
    return { id: 'jwglxt', label: '正方教务' };
  }
  if (/qzdatasource|强智|qzjw/i.test(html)) {
    return { id: 'qzdatasource', label: '强智教务' };
  }
  if (/urp|教学信息服务平台|jwgl\.urp/i.test(html)) {
    return { id: 'urp', label: 'URP 教务' };
  }
  return { id: 'unknown', label: '通用识别' };
}

function tableScore(tableHtml: string): number {
  let score = 0;
  if (/id\s*=\s*["']?kbtable/i.test(tableHtml)) score += 5;
  if (/class\s*=\s*["'][^"']*(kb|timetable|schedule|skb)/i.test(tableHtml)) score += 3;
  if (/id\s*=\s*["'][^"']*(kb|skb|timetable)/i.test(tableHtml)) score += 3;
  if (/星期|周一|周二/.test(tableHtml)) score += 2;
  if (/节次|第\d+节/.test(tableHtml)) score += 1;
  return score;
}

/** 页面里所有表格的纯文本预览，供手动校正映射使用。 */
export function inspectPage(html: string, options: { limit?: number } = {}): PageInspection {
  const limit = options.limit ?? 2;
  const tables: PageTablePreview[] = [];
  for (const [index, rows] of parseTables(html).entries()) {
    if (tables.length >= limit) break;
    tables.push({
      index,
      rows: rows.slice(0, 12).map((row) => row.cells.slice(0, 10).map((cell) => stripTags(cell.html))),
    });
  }
  return { tables, system: detectSystem(html) };
}

/** 按用户指定的映射解析：表头行 + 星期列区间 + 节次列。 */
function extractByMapping(html: string, mapping: PageMapping, totalWeeks: number): ImportedSchedule[] {
  const dayColumns = new Map<number, number>();
  for (let offset = 0; offset < mapping.dayCount; offset += 1) {
    dayColumns.set(mapping.dayStartColumn + offset, Math.min(7, offset + 1));
  }

  let best: ImportedSchedule[] = [];
  for (const rows of parseTables(html)) {
    if (rows[mapping.headerRow] === undefined) continue;
    const schedules: ImportedSchedule[] = [];
    for (let rowIndex = mapping.headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (row === undefined) continue;
      const fallbackPeriod = Math.max(1, rowIndex - mapping.headerRow);
      let period = fallbackPeriod;
      if (mapping.periodColumn !== null) {
        const label = stripTags(row.cells[mapping.periodColumn]?.html ?? '');
        period = parsePeriodLabel(label)?.periodStart ?? fallbackPeriod;
      }
      let column = 0;
      for (const cell of row.cells) {
        const day = dayColumns.get(column);
        if (day !== undefined) {
          const cellPeriod = periodFromCell(stripTags(cell.html));
          const start = cellPeriod ?? period;
          const schedule = buildSchedule(cell.html, day, start, start, totalWeeks);
          if (schedule !== null) schedules.push(schedule);
        }
        column += cell.colspan;
      }
    }
    if (schedules.length > best.length) best = schedules;
  }
  return best;
}

/**
 * 从任意教务页面识别课表：先按正方式「日-节」网格，再按「星期表头」表格。
 * 只依赖页面结构，不绑定具体学校；给出 mapping 时按用户指定的映射解析。
 */
export function extractTimetableFromHtml(html: string, options: PageExtractOptions = {}): PageExtractResult {
  const totalWeeks = options.totalWeeks ?? 20;
  const warnings: string[] = [];
  const system = detectSystem(html);

  if (options.mapping !== undefined) {
    const mapped = extractByMapping(html, options.mapping, totalWeeks);
    const tableCount = parseTables(html).length;
    if (mapped.length === 0) {
      warnings.push('按指定映射未解析到课程，请检查表头行与星期列');
      return { schedules: [], warnings, shape: 'none', tables: tableCount };
    }
    return {
      schedules: mapped,
      warnings: [`按手动映射解析（${system.label}）`],
      shape: 'weekday-table',
      tables: tableCount,
    };
  }

  if (/id\s*=\s*["']?\d{1,2}[-_]\d{1,2}["']?/i.test(html) || /id\s*=\s*["']?kbtable/i.test(html)) {
    const cells = parseTimetableCells(html);
    if (cells.length > 0) {
      const parsed = parseTimetable(html, { totalWeeks });
      return {
        schedules: parsed.schedules,
        warnings: [...parsed.warnings, `页面形态：${system.label}「日-节」网格`],
        shape: 'grid',
        tables: parseTables(html).length,
      };
    }
  }

  const tables = parseTables(html)
    .map((rows, index) => ({
      rows,
      index,
      score: tableScore(rows.map((row) => row.cells.map((cell) => cell.html).join('')).join('')),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.rows);
  let best: { schedules: ImportedSchedule[]; headerRow: number } | null = null;

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
            const cellPeriod = periodFromCell(stripTags(cell.html));
            const start = cellPeriod ?? period ?? rowIndex - headerIndex;
            const end = cellPeriod ?? period ?? start;
            const schedule = buildSchedule(cell.html, day, start, Math.max(start, end), totalWeeks);
            if (schedule !== null) schedules.push(schedule);
          }
          column += cell.colspan;
        }
      }
      if (best === null || schedules.length > best.schedules.length) {
        best = { schedules, headerRow: headerIndex };
      }
      break;
    }
  }

  if (best === null || best.schedules.length === 0) {
    const tableCount = tables.length;
    const frameCount = countPastedFrames(html);
    warnings.push(
      `未在页面中识别到课表（表格 ${tableCount} 个，页面片段 ${frameCount} 段）。` +
        '请确认已打开课表页；若课表在弹窗或新标签页中，请在该页面点击书签后重新粘贴',
    );
    return { schedules: [], warnings, shape: 'none', tables: tableCount };
  }
  if (best.headerRow > 0) warnings.push('表头不在首行，已按识别到的星期列解析');
  if (system.id !== 'unknown') warnings.push(`页面形态：${system.label}`);
  return { schedules: best.schedules, warnings, shape: 'weekday-table', tables: tables.length };
}

/** 页面里是否出现了课表特征，用于判断用户是否已到课表页。 */
export function looksLikeTimetablePage(html: string): boolean {
  if (/id\s*=\s*["']?\d{1,2}[-_]\d{1,2}["']?/i.test(html)) return true;
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

/** 多帧页面之间的分隔标记，书签小工具用它拼接同源 iframe 内容。 */
export const PAGE_FRAME_SEPARATOR = '<<<FRAME>>>';

/**
 * 书签小工具：在教务页面点一下即把页面源码复制到剪贴板。
 * 同时收集同源 iframe（最多两层），因为多数教务系统把课表放在 iframe 内。
 */
export const PAGE_BOOKMARKLET = `javascript:(()=>{const seen=new Set();const out=[];const walk=(doc,d)=>{if(!doc||d>2||seen.has(doc))return;seen.add(doc);try{out.push(doc.documentElement.outerHTML)}catch(e){};let frames=[];try{frames=[...doc.querySelectorAll('iframe,frame')]}catch(e){};frames.forEach(f=>{try{walk(f.contentDocument,d+1)}catch(e){}})};walk(document,0);const h='<<<DAWNTICK>>>'+out.join('${PAGE_FRAME_SEPARATOR}')+'<<<END>>>';navigator.clipboard.writeText(h).then(()=>alert('已复制 '+out.length+' 个页面内容（含 iframe），回晓刻粘贴即可')).catch(()=>prompt('复制下面的内容，回晓刻粘贴',h));})();`;

export function stripPageMarkers(text: string): string {
  return text.replace(/^[\s\S]*?<<<DAWNTICK>>>/, '').replace(/<<<END>>>[\s\S]*$/, '');
}

/** 粘贴内容里包含的页面片段数量（书签会拼接同源 iframe）。 */
export function countPastedFrames(text: string): number {
  const body = stripPageMarkers(text);
  return body.split(PAGE_FRAME_SEPARATOR).length;
}
