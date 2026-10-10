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
  return { modulus: toHexKey(modulus, '公钥模数'), exponent: toHexKey(exponent, '公钥指数') };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToHex(input: string): string {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE64_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`公钥含非法字符: ${char}`);
    bits += index.toString(2).padStart(6, '0');
    while (bits.length >= 8) {
      bytes.push(Number.parseInt(bits.slice(0, 8), 2));
      bits = bits.slice(8);
    }
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 正方各部署的公钥编码不一致：十六进制、Base64、少数为十进制。
 * 统一归一为十六进制；纯数字按十六进制优先（"010001" 即 e=65537）。
 */
export function toHexKey(raw: string, label = '公钥'): string {
  const clean = raw.trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (clean.length === 0) throw new Error(`${label}为空`);
  if (/^[0-9a-f]+$/i.test(clean)) return clean.toLowerCase();
  if (/^[0-9]+$/.test(clean)) return BigInt(clean).toString(16);
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return base64ToHex(clean);
  throw new Error(`${label}格式无法识别，请确认教务地址`);
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

/**
 * 正方 RSAUtils 的返回格式：十六进制字符串按 ASCII 再 Base64。
 * 各校部署存在两种写法，登录时依次尝试。
 */
export type PasswordEncoding = 'hex-ascii' | 'hex-binary';

export const PASSWORD_ENCODINGS: readonly PasswordEncoding[] = ['hex-ascii', 'hex-binary'];

function asciiToBase64(text: string): string {
  let binary = '';
  for (const char of text) binary += String.fromCharCode(char.charCodeAt(0) & 0xff);
  return btoa(binary);
}

/** 正方登录前的 RSA 加密：m^e mod n，按模长左补零输出十六进制。 */
export function rsaEncryptHex(modulusKey: string, exponentKey: string, plaintext: string): string {
  const modulusHex = toHexKey(modulusKey, '公钥模数');
  const modulus = hexToBigInt(modulusHex);
  const exponent = hexToBigInt(toHexKey(exponentKey, '公钥指数'));
  const bytes = new TextEncoder().encode(plaintext);
  let message = 0n;
  for (const byte of bytes) message = (message << 8n) | BigInt(byte);

  const encrypted = modPow(message, exponent, modulus);
  return encrypted.toString(16).padStart(modulusHex.length, '0');
}

export function encryptPassword(
  modulusKey: string,
  exponentKey: string,
  password: string,
  encoding: PasswordEncoding = 'hex-ascii',
): string {
  const hex = rsaEncryptHex(modulusKey, exponentKey, password);
  return encoding === 'hex-ascii' ? asciiToBase64(hex) : hexToBase64(hex);
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

export interface JwglxtLogEntry {
  step: 'login-page' | 'public-key' | 'login-post' | 'retry' | 'timetable' | 'parse';
  message: string;
  detail?: Record<string, string | number | boolean>;
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
  /** 过程日志回调；实现方需保证不写入明文密码与密文。 */
  onLog?: (entry: JwglxtLogEntry) => void;
}

function describeKeyEncoding(raw: string): string {
  const clean = raw.trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (clean.length === 0) return 'empty';
  if (/^[0-9a-f]+$/i.test(clean)) return 'hex';
  return /^[0-9]+$/.test(clean) ? 'decimal' : 'base64';
}

/** 密码不落盘：仅在本次调用内用于 RSA 加密后提交。 */
export async function fetchTimetable(
  input: JwglxtFetchInput,
): Promise<{ schedules: ImportedSchedule[]; warnings: string[] }> {
  const urls = jwglxtUrls(input.baseUrl, input.term);
  const warnings: string[] = [];
  const cookies: string[] = [];
  const log = (entry: JwglxtLogEntry): void => input.onLog?.(entry);

  const collect = (response: JwglxtFetchResponse): void => {
    for (const cookie of response.setCookie ?? []) cookies.push(cookie.split(';')[0] ?? '');
  };
  const cookieHeader = (): Record<string, string> =>
    cookies.length === 0 ? {} : { Cookie: cookies.filter((item) => item.length > 0).join('; ') };

  const loginPage = await input.fetchImpl(urls.login, { headers: cookieHeader() });
  collect(loginPage);
  const loginHtml = await loginPage.text();
  const fields = parseLoginForm(loginHtml);
  log({
    step: 'login-page',
    message: '获取登录页',
    detail: { url: urls.login, status: loginPage.status, fields: Object.keys(fields).length, csrf: fields['csrftoken'] !== undefined },
  });
  if (loginPage.status !== 200) throw new Error(`登录页返回 ${loginPage.status}`);
  if (fields['csrftoken'] === undefined) warnings.push('登录页未包含 csrftoken');

  const keyResponse = await input.fetchImpl(urls.publicKey, { headers: cookieHeader() });
  collect(keyResponse);
  const keyRaw = await keyResponse.text();
  const key = parsePublicKey(keyRaw);
  const rawModulus = ((): string => {
    try {
      const parsed = JSON.parse(keyRaw) as { modulus?: unknown };
      return typeof parsed.modulus === 'string' ? parsed.modulus : '';
    } catch {
      return '';
    }
  })();
  log({
    step: 'public-key',
    message: '解析公钥',
    detail: {
      url: urls.publicKey,
      status: keyResponse.status,
      modulusEncoding: describeKeyEncoding(rawModulus),
      modulusHexChars: key.modulus.length,
    },
  });

  let loginText = '';
  let usedEncoding = PASSWORD_ENCODINGS[0] ?? 'hex-ascii';
  for (const [index, encoding] of PASSWORD_ENCODINGS.entries()) {
    usedEncoding = encoding;
    if (index > 0) log({ step: 'retry', message: '换用另一种密码编码重试', detail: { encoding } });
    const attempt = new URLSearchParams({
      ...fields,
      yhm: input.username,
      mm: encryptPassword(key.modulus, key.exponent, input.password, encoding),
    }).toString();
    const loginResult = await input.fetchImpl(urls.login, {
      method: 'POST',
      headers: { ...cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: attempt,
    });
    collect(loginResult);
    loginText = await loginResult.text();
    const rejected = /用户名或密码|密码错误|登录失败/.test(loginText);
    log({
      step: 'login-post',
      message: rejected ? '登录被拒' : '登录已提交',
      detail: { url: urls.login, status: loginResult.status, encoding, bodyBytes: attempt.length, rejected },
    });
    if (!rejected) break;
  }
  if (/用户名或密码|密码错误|登录失败/.test(loginText)) {
    throw new Error('教务登录失败：用户名或密码不正确');
  }

  const page = await input.fetchImpl(urls.timetable, { headers: cookieHeader() });
  collect(page);
  const pageText = await page.text();
  log({
    step: 'timetable',
    message: '获取课表页',
    detail: { url: urls.timetable, status: page.status, bytes: pageText.length },
  });
  if (/login_slogin|请先登录/.test(pageText)) throw new Error('教务会话失效，请重新登录');

  const parsed = parseTimetable(pageText, { totalWeeks: input.totalWeeks ?? 20 });
  const merged = [...warnings, ...parsed.warnings];
  log({
    step: 'parse',
    message: '解析课表',
    detail: {
      encoding: usedEncoding,
      schedules: parsed.schedules.length,
      warnings: merged.length,
    },
  });
  return { schedules: parsed.schedules, warnings: merged };
}
