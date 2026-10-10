import { looksLikeRoom } from './csv.ts';
import { parseWeeksText } from './weeks-text.ts';
import type { ImportedSchedule } from './apply.ts';

export interface JwglxtUrls {
  login: string;
  publicKey: string;
  timetable: string;
}

export interface JwglxtTerm {
  xnm: string;
  xqm: string;
}

/** 把用户填的教务地址归一化为站点根：允许带或不带协议、允许已粘贴登录页路径。 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error('教务地址不能为空');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  const marker = url.pathname.indexOf('/jwglxt');
  const path = (marker === -1 ? url.pathname : url.pathname.slice(0, marker)).replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

export function jwglxtUrls(baseUrl: string, term?: JwglxtTerm): JwglxtUrls {
  const base = normalizeBaseUrl(baseUrl);
  const query = term === undefined ? '' : `&xnm=${encodeURIComponent(term.xnm)}&xqm=${encodeURIComponent(term.xqm)}`;
  return {
    login: `${base}/jwglxt/xtgl/login_slogin.html`,
    publicKey: `${base}/jwglxt/xtgl/login_getPublicKey.html`,
    timetable: `${base}/jwglxt/xskb/xskb_list.do?gnmkdm=N253508${query}`,
  };
}

/** 提取表单里的隐藏字段（含 csrftoken）与同名输入项。 */
export function parseLoginForm(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (name === undefined) continue;
    const value = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    fields[name] = value;
  }
  return fields;
}

export function parsePublicKey(payload: string | { modulus?: string; exponent?: string }): {
  modulus: string;
  exponent: string;
} {
  const parsed = typeof payload === 'string' ? (JSON.parse(payload) as Record<string, unknown>) : payload;
  const modulus = parsed.modulus;
  const exponent = parsed.exponent;
  if (typeof modulus !== 'string' || typeof exponent !== 'string' || modulus.length === 0) {
    throw new Error('教务返回的公钥格式不正确');
  }
  return { modulus, exponent };
}

function hexToBigInt(hex: string): bigint {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(clean)) throw new Error(`非法十六进制: ${hex}`);
  return BigInt(`0x${clean}`);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

export function hexToBase64(hex: string): string {
  const clean = hex.trim().replace(/^0x/i, '');
  const padded = clean.length % 2 === 0 ? clean : `0${clean}`;
  const bytes = new Uint8Array(padded.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16);
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 正方登录前的 RSA 加密：m^e mod n，按模长左补零输出十六进制。 */
export function rsaEncryptHex(modulusHex: string, exponentHex: string, plaintext: string): string {
  const modulus = hexToBigInt(modulusHex);
  const exponent = hexToBigInt(exponentHex);
  const bytes = new TextEncoder().encode(plaintext);
  let message = 0n;
  for (const byte of bytes) message = (message << 8n) | BigInt(byte);

  const encrypted = modPow(message, exponent, modulus);
  const width = modulusHex.trim().replace(/^0x/i, '').length;
  return encrypted.toString(16).padStart(width, '0');
}

export function encryptPassword(modulusHex: string, exponentHex: string, password: string): string {
  return hexToBase64(rsaEncryptHex(modulusHex, exponentHex, password));
}

export interface JwglxtCell {
  dayOfWeek: number;
  periodNo: number;
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

/** 解析正方课表页：新版为按 `id="日-节"` 标记的网格，旧版为 kbtable 表格。 */
export function parseTimetableCells(html: string): JwglxtCell[] {
  const cells: JwglxtCell[] = [];
  const grid = /<td\b[^>]*id\s*=\s*["'](\d+)-(\d+)["'][^>]*>([\s\S]*?)<\/td>/gi;
  for (const match of html.matchAll(grid)) {
    const day = Number(match[1]);
    const period = Number(match[2]);
    if (day < 1 || day > 7 || period < 1 || period > 40) continue;
    cells.push({ dayOfWeek: day, periodNo: period, raw: stripTags(match[3] ?? '') });
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
      cells.push({ dayOfWeek: day, periodNo: rowIndex, raw: stripTags(column) });
    }
  }
  return cells;
}

interface ParsedCell {
  dayOfWeek: number;
  periodNo: number;
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
      periodNo: cell.periodNo,
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
    const sorted = [...list].sort((left, right) => left.periodNo - right.periodNo);
    let runStart = sorted[0] as ParsedCell;
    let previous = runStart;

    const flush = (start: ParsedCell, end: ParsedCell): void => {
      merged.push({
        courseName: start.name,
        dayOfWeek: start.dayOfWeek,
        periodStart: start.periodNo,
        periodEnd: end.periodNo,
        weeks: start.weeks ?? Array.from({ length: totalWeeks }, (_, index) => index + 1),
        room: start.room,
        teacher: start.teacher,
      });
      if (start.weeks === null) warnings.push(`${start.name} 未标注周次，按全周导入`);
    };

    for (const cell of sorted.slice(1)) {
      if (cell.periodNo === previous.periodNo + 1) {
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

export interface JwglxtFetchResponse {
  status: number;
  text(): Promise<string>;
  setCookie?: string[];
}

export interface JwglxtFetchInput {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<JwglxtFetchResponse>;
  totalWeeks?: number;
  term?: JwglxtTerm;
}

/** 密码不落盘：仅在本次调用内用于 RSA 加密后提交。 */
export async function fetchTimetable(
  input: JwglxtFetchInput,
): Promise<{ schedules: ImportedSchedule[]; warnings: string[] }> {
  const urls = jwglxtUrls(input.baseUrl, input.term);
  const warnings: string[] = [];
  const cookies: string[] = [];

  const collect = (response: JwglxtFetchResponse): void => {
    for (const cookie of response.setCookie ?? []) cookies.push(cookie.split(';')[0] ?? '');
  };
  const cookieHeader = (): Record<string, string> =>
    cookies.length === 0 ? {} : { Cookie: cookies.filter((item) => item.length > 0).join('; ') };

  const loginPage = await input.fetchImpl(urls.login, { headers: cookieHeader() });
  collect(loginPage);
  if (loginPage.status !== 200) throw new Error(`登录页返回 ${loginPage.status}`);
  const fields = parseLoginForm(await loginPage.text());
  if (fields['csrftoken'] === undefined) warnings.push('登录页未包含 csrftoken');

  const keyResponse = await input.fetchImpl(urls.publicKey, { headers: cookieHeader() });
  collect(keyResponse);
  const key = parsePublicKey(await keyResponse.text());

  const body = new URLSearchParams({
    ...fields,
    yhm: input.username,
    mm: encryptPassword(key.modulus, key.exponent, input.password),
  }).toString();

  const loginResult = await input.fetchImpl(urls.login, {
    method: 'POST',
    headers: { ...cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  collect(loginResult);
  const loginText = await loginResult.text();
  if (/用户名或密码|密码错误|登录失败/.test(loginText)) throw new Error('教务登录失败：用户名或密码不正确');

  const page = await input.fetchImpl(urls.timetable, { headers: cookieHeader() });
  collect(page);
  const pageText = await page.text();
  if (/login_slogin|请先登录/.test(pageText)) throw new Error('教务会话失效，请重新登录');

  const parsed = parseTimetable(pageText, { totalWeeks: input.totalWeeks ?? 20 });
  return { schedules: parsed.schedules, warnings: [...warnings, ...parsed.warnings] };
}
