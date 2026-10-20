import { readSystemsConfig, type SchoolSystemId, type SystemConfig } from '../config/index.ts';
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
  id: SchoolSystemId | 'unknown';
  label: string;
}

/**
 * 页面识别特征：全部来自 `src/config/systems.json` 的 `detect` 段，**使用时**才编译成正则。
 * 想支持新教务或修正识别规则，改配置即可，不必动这里的代码。
 *
 * 为什么是「使用时」而不是模块加载时：`setPresetOverride()` 是在应用启动时才把缓存教务配置
 * 注进 config 层的，模块加载那一刻读到的还是内置值。若在这里冻结成常量，
 * 覆盖层就永远影响不到页面识别——识别用的必须是**有效配置**（`readSystemsConfig()`）。
 */
interface PageHints {
  id: SchoolSystemId;
  label: string;
  /** 页面里出现任一标记即判定为该教务系统；没有标记的条目（如 other）不参与识别 */
  markerPattern: RegExp | null;
  /** 课表表格 id 特征，例如正方的 id="kbtable" */
  tableIdPattern: RegExp | null;
  /** 课表表格 class 特征 */
  tableClassPattern: RegExp | null;
}

/** 由一份有效配置编译出的全部识别特征。 */
interface PageHintsState {
  /** 编译时的有效配置数组（`readSystemsConfig()` 每次返回同一个引用，用它判断是否要重编） */
  systems: readonly SystemConfig[];
  hints: readonly PageHints[];
  /** 「日-节」网格单元格 id、以及课表表格 id：命中即说明页面本身就是课表页 */
  gridPagePatterns: readonly RegExp[];
}

function alternation(parts: readonly string[]): RegExp | null {
  return parts.length === 0 ? null : new RegExp(parts.join('|'), 'i');
}

function compilePageHints(systems: readonly SystemConfig[]): PageHintsState {
  const hints: readonly PageHints[] = systems.map((system) => ({
    id: system.id,
    label: system.name,
    markerPattern: alternation(system.detect.markers),
    tableIdPattern:
      system.detect.timetableTableIds.length === 0
        ? null
        : new RegExp(`id\\s*=\\s*["']?(?:${system.detect.timetableTableIds.join('|')})`, 'i'),
    tableClassPattern:
      system.detect.timetableTableClasses.length === 0
        ? null
        : new RegExp(`class\\s*=\\s*["'][^"']*(?:${system.detect.timetableTableClasses.join('|')})`, 'i'),
  }));

  const gridPagePatterns: readonly RegExp[] = [
    ...hints.map((hint) => hint.tableIdPattern),
    ...systems.flatMap((system) =>
      system.detect.gridCellIdPatterns.map(
        (pattern) => new RegExp(`id\\s*=\\s*["']?(?:${pattern})["']?`, 'i'),
      ),
    ),
  ].filter((pattern): pattern is RegExp => pattern !== null);

  return { systems, hints, gridPagePatterns };
}

let cachedHintsState: PageHintsState | undefined;

/**
 * 当前**有效配置**的识别特征。没有覆盖时就是内置 `systems.json` 编译出来的那一份，
 * 与「模块加载时编译」的结果逐字节等价；一旦覆盖换了一套配置就立刻重编。
 */
function activePageHints(): PageHintsState {
  const systems = readSystemsConfig();
  if (cachedHintsState === undefined || cachedHintsState.systems !== systems) {
    cachedHintsState = compilePageHints(systems);
  }
  return cachedHintsState;
}

/**
 * 这一条是跨系统的通用启发式（权重、中文表头用词），不是某所学校的数据，
 * 不放到 systems.json，保留在代码里并在此说明。
 */
const LOOSE_TABLE_ID_PATTERN = /id\s*=\s*["'][^"']*(kb|skb|timetable)/i;

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

/** 单元格里的节次只在出现「节」或时间范围时取值，避免把「3-5周」当成节次。 */
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
 * 标记来自**有效配置**（默认是 src/config/systems.json，被预设覆盖层换过就用覆盖的那套），
 * 按配置顺序取第一个命中的系统。
 */
export function detectSystem(html: string): SystemInfo {
  for (const hint of activePageHints().hints) {
    if (hint.markerPattern !== null && hint.markerPattern.test(html)) {
      return { id: hint.id, label: hint.label };
    }
  }
  return { id: 'unknown', label: '通用识别' };
}

/** 页面里是否出现课表骨架（「日-节」网格单元格或课表表格 id）。 */
function looksLikeGridPage(html: string): boolean {
  return activePageHints().gridPagePatterns.some((pattern) => pattern.test(html));
}

function tableScore(tableHtml: string): number {
  let score = 0;
  // 各教务系统自己声明的课表表格特征（有效配置的 detect 段）
  for (const hint of activePageHints().hints) {
    if (hint.tableIdPattern !== null && hint.tableIdPattern.test(tableHtml)) score += 5;
    if (hint.tableClassPattern !== null && hint.tableClassPattern.test(tableHtml)) score += 3;
  }
  // 下面是跨系统的通用启发式与权重，与具体学校无关，保留在代码里
  if (LOOSE_TABLE_ID_PATTERN.test(tableHtml)) score += 3;
  if (/星期|周一|周二/.test(tableHtml)) score += 2;
  if (/节次|第\d+节/.test(tableHtml)) score += 1;
  return score;
}

/** 页面里所有表格的纯文本预览，供手动校正映射使用。 */
export function inspectPage(html: string, options: { limit?: number } = {}): PageInspection {
  const limit = options.limit ?? 2;
  const page = stripPageMarkers(html);
  const tables: PageTablePreview[] = [];
  for (const [index, rows] of parseTables(page).entries()) {
    if (tables.length >= limit) break;
    tables.push({
      index,
      rows: rows.slice(0, 12).map((row) => row.cells.slice(0, 10).map((cell) => stripTags(cell.html))),
    });
  }
  return { tables, system: detectSystem(page) };
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
  const diagnostics = parsePageDiagnostics(html);
  const page = stripPageMarkers(html);
  const system = detectSystem(page);

  if (options.mapping !== undefined) {
    const mapped = extractByMapping(page, options.mapping, totalWeeks);
    const tableCount = parseTables(page).length;
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

  if (looksLikeGridPage(page)) {
    const cells = parseTimetableCells(page);
    if (cells.length > 0) {
      const parsed = parseTimetable(page, { totalWeeks });
      return {
        schedules: parsed.schedules,
        warnings: [...parsed.warnings, `页面形态：${system.label}「日-节」网格`],
        shape: 'grid',
        tables: parseTables(page).length,
      };
    }
  }

  const tables = parseTables(page)
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
    const frameCount = diagnostics?.frames ?? countPastedFrames(html);
    const legacy = /<<<DAWNTICK>>>/.test(html) && diagnostics === null;
    const hints: string[] = [];
    if (legacy) hints.push('检测到旧版书签内容，请在「导入 → 网页课表」里重新复制书签代码后再试');
    if (diagnostics?.loading === true) hints.push('页面仍在加载，请等课表显示完整后再点书签');
    if (diagnostics !== null && diagnostics.kbTables === 0 && diagnostics.gridCells === 0) {
      hints.push('未在页面里找到课表表格，请在课表页本身点击书签');
    }
    const kbHint = diagnostics === null ? '' : `（疑似课表 ${diagnostics.kbTables ?? 0} 个，整点 ${diagnostics.gridCells ?? 0} 个）`;
    warnings.push(
      `未在页面中识别到课表：表格 ${tableCount} 个，页面片段 ${frameCount} 段${kbHint}。` +
        (hints.length > 0 ? hints.join('；') : '请确认已打开课表页后重新点击书签'),
    );
    return { schedules: [], warnings, shape: 'none', tables: tableCount };
  }
  if (best.headerRow > 0) warnings.push('表头不在首行，已按识别到的星期列解析');
  if (system.id !== 'unknown') warnings.push(`页面形态：${system.label}`);
  return { schedules: best.schedules, warnings, shape: 'weekday-table', tables: tables.length };
}

/** 页面里是否出现了课表特征，用于判断用户是否已到课表页。 */
export function looksLikeTimetablePage(html: string): boolean {
  if (looksLikeGridPage(html)) return true;
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
 * 页面诊断字段清单（顺序即契约顺序）。
 *
 * 同一份协议有两个运行环境实现，字段名与计数口径必须逐字一致：
 * - 书签小工具 `PAGE_BOOKMARKLET`（本文件，跑在用户浏览器里）；
 * - 桌面注入脚本 `apps/desktop/src-tauri/src/import-injection.js`（由 Rust `include_str!` 注入教务窗口）。
 *
 * 两个脚本都读不到本模块，所以字段名只能各写一份；改字段时三处一起改
 * （本常量、书签字符串、注入脚本），`pnpm test` 里的共用样例会逐项断言。
 * 计数口径：`frames` = 访问的文档数（主文档 + 同源 iframe）；
 * `tables` = 所有文档的 `<table>` 总数；`kbTables` = id/class 命中
 * `kbtable|^kb|timetable|skb|kbgrid` 的表格数；`gridCells` = id 形如 `1-1` / `1_1` 的元素数。
 */
export const PAGE_DIAGNOSTICS_FIELDS = [
  'v',
  'url',
  'title',
  'frames',
  'tables',
  'kbTables',
  'gridCells',
  'ready',
  'loading',
] as const;

/** 诊断字段名；`PageDiagnostics` 的键必须覆盖本清单。 */
export type PageDiagnosticsField = (typeof PAGE_DIAGNOSTICS_FIELDS)[number];

/**
 * 书签与桌面注入脚本带回的页面诊断信息。
 *
 * 字段清单见 `PAGE_DIAGNOSTICS_FIELDS`；桌面侧同构实现在
 * `apps/desktop/src-tauri/src/import-injection.js` 的 `collect()`。
 */
export interface PageDiagnostics {
  /** 协议版本；旧版书签不带该字段 */
  v?: number;
  url?: string;
  title?: string;
  frames?: number;
  tables?: number;
  /** id/class 疑似课表的表格数 */
  kbTables?: number;
  /** 「日-节」网格单元格数 */
  gridCells?: number;
  ready?: string;
  loading?: boolean;
}

/** 当前协议版本；书签与桌面注入脚本共用，旧版实现按缺字段降级。 */
export const BOOKMARKLET_VERSION = 2;

/**
 * 书签小工具：等课表渲染出来后再复制，并收集同源 iframe（多数教务把课表放在 iframe 内）。
 * 复制内容依次为：诊断 JSON、各页面片段（以 PAGE_FRAME_SEPARATOR 分隔）。
 *
 * 注意：书签里的 `kbtable|^kb|timetable|skb|kbgrid` 等扫描特征刻意保留在字符串里，
 * 不外置到 systems.json —— 这段代码要在目标教务页面里执行，读不到本项目的配置文件；
 * 它只用于统计诊断数量，命中不准也不影响解析。
 */
export const PAGE_BOOKMARKLET = `javascript:(()=>{const SEP='${PAGE_FRAME_SEPARATOR}';const seen=new Set();const parts=[];const walk=(doc,d)=>{if(!doc||d>2||seen.has(doc))return;seen.add(doc);try{parts.push(doc.documentElement.outerHTML)}catch(e){};let fr=[];try{fr=[...doc.querySelectorAll('iframe,frame')]}catch(e){};fr.forEach(f=>{try{walk(f.contentDocument,d+1)}catch(e){}})};const scan=()=>{const info={v:${BOOKMARKLET_VERSION},url:location.href,title:document.title,frames:0,tables:0,kbTables:0,gridCells:0,ready:document.readyState,loading:false};const visit=(doc,d)=>{if(!doc||d>2)return;info.frames++;try{const tables=[...doc.querySelectorAll('table')];info.tables+=tables.length;info.kbTables+=tables.filter(x=>/kbtable|^kb|timetable|skb|kbgrid/i.test((x.id||'')+(x.className||''))).length}catch(e){};try{[...doc.querySelectorAll('[id]')].forEach(el=>{if(/^\\d{1,2}[-_]\\d{1,2}$/.test(el.id))info.gridCells++})}catch(e){};try{if(/加载中|loading/i.test(doc.body?doc.body.textContent:''))info.loading=true}catch(e){};try{[...doc.querySelectorAll('iframe,frame')].forEach(f=>visit(f.contentDocument,d+1))}catch(e){}};visit(document,0);return info};const ready=info=>info.kbTables>0||info.gridCells>0||info.tables>=3;const copy=()=>{seen.clear();parts.length=0;walk(document,0);const info=scan();const head='<<<DAWNTICK>>>'+JSON.stringify(info)+SEP;const body=parts.join(SEP);navigator.clipboard.writeText(head+body+'<<<END>>>').then(()=>alert('已复制（书签 v${BOOKMARKLET_VERSION}）：表格 '+info.tables+' 个，疑似课表 '+info.kbTables+' 个，整点 '+info.gridCells+' 个，页面片段 '+info.frames+' 段')).catch(()=>prompt('复制下面的内容，回晓刻粘贴',head+body+'<<<END>>>'))};let tries=0;const wait=()=>{const info=scan();if(ready(info)||tries>=6){copy();return}tries++;setTimeout(wait,700)};wait()})();`;

/** 取出书签带来的诊断 JSON；没有则返回 null。 */
export function parsePageDiagnostics(text: string): PageDiagnostics | null {
  const match = /<<<DAWNTICK>>>\s*(\{[\s\S]*?\})\s*(?:<<<FRAME>>>|<<<END>>>)/.exec(text);
  if (match?.[1] === undefined) return null;
  try {
    return JSON.parse(match[1]) as PageDiagnostics;
  } catch {
    return null;
  }
}

export function stripPageMarkers(text: string): string {
  return text
    .replace(/^[\s\S]*?<<<DAWNTICK>>>/, '')
    .replace(/^\s*\{[\s\S]*?\}\s*(?:<<<FRAME>>>|<<<END>>>)/, '')
    .replace(/<<<END>>>[\s\S]*$/, '');
}

/** 粘贴内容里包含的页面片段数量（书签会拼接同源 iframe）。 */
export function countPastedFrames(text: string): number {
  const body = stripPageMarkers(text);
  return body.split(PAGE_FRAME_SEPARATOR).length;
}
