import { sha256HexSync, type BackupModule } from '@dawn-tick/core';
import { LAN_TRUSTED_TOKENS_META_KEY } from './lib/meta-keys.ts';

/**
 * 局域网同步（I-14）的协议层：范围、地址、配对码与长期配对令牌。
 *
 * 边界：
 * - 纯函数，不碰 `fetch`、Storage 与原生桥；信封与服务端请求处理在
 *   `lan-sync-payload.ts`，客户端与服务端生命周期在 `lan-sync.ts` / `lan-sync-client.ts`；
 * - 两端对照见 `apps/mobile/docs/lan-sync.contract.md`；
 * - 鉴权只在这里与载荷层：原生层（Rust / Kotlin）只做传输与限额，配对码、令牌哈希与过期
 *   判定都能被 `apps/web/test/lan-sync.test.ts` 直接覆盖；
 * - 服务端只保存令牌的 SHA-256 哈希（`TrustedToken.tokenHash`），明文令牌只在
 *   `POST /pair` 的响应里出现一次。
 */

/** 信封协议版本：不认识就 400，不做猜测兼容。 */
export const LAN_SYNC_PROTOCOL_VERSION = 1;
/** 信封标识；防止把别的 JSON 当同步数据。 */
export const LAN_SYNC_KIND = 'dawn-tick-lan-sync';
/** 手输地址省略端口时的默认端口。 */
export const LAN_SYNC_PORT = 8765;
/** 配对码有效期：5 分钟。 */
export const PAIR_CODE_TTL_MS = 5 * 60_000;
/** 长期配对令牌有效期：180 天；`/pair/refresh` 每次换新令牌并顺延。 */
export const LAN_PAIRING_TTL_MS = 180 * 24 * 60 * 60_000;
/** 服务端 `app_meta` 里的可信令牌列表键（登记见 `lib/meta-keys.ts`）。 */
export { LAN_TRUSTED_TOKENS_META_KEY };
/** 令牌名称（设备名）上限：与 UDP 广播的设备名同口径。 */
export const TRUSTED_TOKEN_NAME_MAX = 48;
/** 请求体上限 5MB（原生层同样在入队前拦截）。 */
export const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
/** 响应体上限 20MB（课表很大时导出会超过请求上限）。 */
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

/** 可勾选的同步范围。 */
export type LanScope = 'timetable' | 'todos' | 'settings';
export const LAN_SCOPES: readonly LanScope[] = ['timetable', 'todos', 'settings'];
export const LAN_SCOPE_LABEL: Record<LanScope, string> = {
  timetable: '课表',
  todos: '待办',
  settings: '设置',
};
/** 范围到备份模块的映射：课表=学期/节次/课程/排课，待办=日程与待办，设置=设置项。 */
export const LAN_SCOPE_MODULES: Record<LanScope, readonly BackupModule[]> = {
  timetable: ['semesters', 'courses'],
  todos: ['events'],
  settings: ['settings'],
};

export function scopeModules(scopes: readonly LanScope[]): BackupModule[] {
  const selected = new Set<BackupModule>();
  for (const scope of scopes) {
    for (const module of LAN_SCOPE_MODULES[scope]) selected.add(module);
  }
  return [...selected];
}

/** 解析 `timetable,todos`：未知值与重复项直接丢掉，顺序按 LAN_SCOPES 归一。 */
export function parseScope(raw: string | null | undefined): LanScope[] {
  const wanted = new Set<string>();
  for (const piece of (raw ?? '').split(',')) {
    const text = piece.trim();
    if (text !== '') wanted.add(text);
  }
  return LAN_SCOPES.filter((scope) => wanted.has(scope));
}

export function formatScope(scopes: readonly LanScope[]): string {
  const selected = new Set(scopes);
  return LAN_SCOPES.filter((scope) => selected.has(scope)).join(',');
}

/** 对方地址：只收 IPv4 与端口，不收域名、不收公网。 */
export interface PeerAddress {
  host: string;
  port: number;
}

/** 是否局域网地址：10/8、172.16/12、192.168/16、169.254/16、100.64/10、127/8 与 localhost。 */
export function isLanAddress(host: string): boolean {
  const text = host.trim().toLowerCase();
  if (text === 'localhost') return true;
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    if (value < 0 || value > 255) return false;
    octets.push(value);
  }
  const [first, second] = octets as [number, number, number, number];
  if (first === 10 || first === 127) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  // 100.64.0.0/10（运营商级 NAT）：手机热点与部分校园网会出现，与 Rust / Kotlin 同口径
  if (first === 100 && second >= 64 && second <= 127) return true;
  return first === 169 && second === 254;
}

/** 解析手输地址；允许带 `http://` 与结尾斜杠。不合法（含公网地址）返回 null。 */
export function parsePeerAddress(raw: string, defaultPort = LAN_SYNC_PORT): PeerAddress | null {
  let text = raw.trim();
  if (text === '') return null;
  text = text.replace(/^https?:\/\//i, '');
  const slash = text.indexOf('/');
  if (slash >= 0) text = text.slice(0, slash);
  const match = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(text);
  if (match === null) return null;
  const host = (match[1] ?? '').trim();
  const port = match[2] === undefined ? defaultPort : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!isLanAddress(host)) return null;
  return {
    host: host.toLowerCase() === 'localhost' ? '127.0.0.1' : host,
    port,
  };
}

export function formatPeerAddress(peer: PeerAddress): string {
  return `${peer.host}:${peer.port}`;
}

export function peerBaseUrl(peer: PeerAddress): string {
  return `http://${formatPeerAddress(peer)}`;
}

/** 本机配对码与到期时间。 */
export interface Pairing {
  code: string;
  expiresAt: number;
}

/**
 * 服务端保存的一条可信令牌：**只存哈希**，明文令牌在配对响应里返回一次。
 *
 * `createdAt` 是首次配对时间（刷新令牌不重置），`lastUsedAt` 由每次鉴权请求刷新，
 * `expiresAt` 是当前令牌的到期时间（刷新即顺延）。
 */
export interface TrustedToken {
  tokenHash: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

/** 新签发的令牌：明文给客户端，`record` 落服务端 `app_meta`。 */
export interface IssuedToken {
  token: string;
  record: TrustedToken;
}

/** 令牌哈希口径：SHA-256 小写 hex（纯 TS 实现，三端同判）。 */
export function hashToken(token: string): string {
  return sha256HexSync(token);
}

/** 设备名归一：空白、超长与非字符串一律退回「未知设备」。 */
export function normalizeTokenName(raw: unknown): string {
  if (typeof raw !== 'string') return '未知设备';
  const text = raw.trim();
  if (text === '') return '未知设备';
  return [...text].slice(0, TRUSTED_TOKEN_NAME_MAX).join('');
}

/** 令牌是否已到期。 */
export function tokenExpired(record: TrustedToken, now = Date.now()): boolean {
  return now >= record.expiresAt;
}

/** 签发长期令牌：默认 180 天，返回明文与可落盘记录。 */
export function issueTrustedToken(
  name: string,
  now = Date.now(),
  token = randomSessionToken(),
): IssuedToken {
  const record: TrustedToken = {
    tokenHash: hashToken(token),
    name: normalizeTokenName(name),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + LAN_PAIRING_TTL_MS,
  };
  return { token, record };
}

export interface TokenCheck {
  ok: boolean;
  record: TrustedToken | null;
  error: string | null;
}

/** 校验 `Authorization: Bearer …`：先找哈希，再判到期；错误文案可直接展示。 */
export function findTrustedToken(
  tokens: readonly TrustedToken[],
  authorization: string | null,
  now = Date.now(),
): TokenCheck {
  const token = bearerToken(authorization);
  if (token === null) return { ok: false, record: null, error: '缺少配对令牌，请重新配对' };
  const tokenHash = hashToken(token);
  const record = tokens.find((item) => item.tokenHash === tokenHash) ?? null;
  if (record === null) return { ok: false, record: null, error: '配对已失效，请重新配对' };
  if (tokenExpired(record, now)) {
    return { ok: false, record: null, error: '配对已过期，请重新配对' };
  }
  return { ok: true, record, error: null };
}

/** 鉴权通过后刷新最后使用时间；没变化时返回原数组，避免无意义落盘。 */
export function touchTrustedToken(
  tokens: readonly TrustedToken[],
  tokenHash: string,
  now = Date.now(),
): TrustedToken[] {
  let changed = false;
  const next = tokens.map((item) => {
    if (item.tokenHash !== tokenHash) return item;
    changed = true;
    return { ...item, lastUsedAt: now };
  });
  return changed ? next : [...tokens];
}

/**
 * 刷新令牌：旧哈希作废、换发新明文，到期时间顺延 180 天；
 * `createdAt` 与设备名保留，`lastUsedAt` 记为本次刷新时间。
 */
export function rotateTrustedToken(
  tokens: readonly TrustedToken[],
  record: TrustedToken,
  now = Date.now(),
  token = randomSessionToken(),
): IssuedToken & { tokens: TrustedToken[] } {
  const next: TrustedToken = {
    ...record,
    tokenHash: hashToken(token),
    lastUsedAt: now,
    expiresAt: now + LAN_PAIRING_TTL_MS,
  };
  return {
    token,
    record: next,
    tokens: tokens.map((item) => (item.tokenHash === record.tokenHash ? next : item)),
  };
}

/** 吊销一条令牌（幂等）：列表里没有它时原样返回。 */
export function revokeTrustedToken(
  tokens: readonly TrustedToken[],
  tokenHash: string,
): TrustedToken[] {
  return tokens.filter((item) => item.tokenHash !== tokenHash);
}

/** 丢掉已到期令牌；新配对与刷新后顺手清理，列表不会无限增长。 */
export function pruneTrustedTokens(
  tokens: readonly TrustedToken[],
  now = Date.now(),
): TrustedToken[] {
  return tokens.filter((item) => !tokenExpired(item, now));
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is TrustedToken {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<TrustedToken>;
  return (
    typeof record.tokenHash === 'string' &&
    /^[0-9a-f]{64}$/.test(record.tokenHash) &&
    typeof record.name === 'string' &&
    record.name.trim() !== '' &&
    record.name.length <= TRUSTED_TOKEN_NAME_MAX &&
    isFiniteTime(record.createdAt) &&
    isFiniteTime(record.lastUsedAt) &&
    isFiniteTime(record.expiresAt)
  );
}

/** 反序列化 `app_meta` 里的令牌列表：任一条结构不合法返回 null（调用方回退空列表）。 */
export function parseTrustedTokens(value: unknown): TrustedToken[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const parsed: TrustedToken[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (seen.has(item.tokenHash)) continue;
    seen.add(item.tokenHash);
    parsed.push({ ...item, name: normalizeTokenName(item.name) });
  }
  return parsed;
}

/** 序列化给 `app_meta`：数组形态，字段即 `TrustedToken`。 */
export function trustedTokensValue(tokens: readonly TrustedToken[]): TrustedToken[] {
  return tokens.map((item) => ({ ...item }));
}

function randomInt(bound: number): number {
  const source = globalThis.crypto;
  if (source !== undefined && typeof source.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    source.getRandomValues(buffer);
    return (buffer[0] ?? 0) % bound;
  }
  return Math.floor(Math.random() * bound);
}

export function randomPairCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) code += String(randomInt(10));
  return code;
}

/** 32 位十六进制令牌：能拿 WebCrypto 就用，拿不到时退回 Math.random（仅测试环境）。 */
export function randomSessionToken(): string {
  const bytes = new Uint8Array(16);
  const source = globalThis.crypto;
  if (source !== undefined && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createPairing(now = Date.now(), code = randomPairCode()): Pairing {
  return { code, expiresAt: now + PAIR_CODE_TTL_MS };
}

export function pairingExpired(pairing: Pairing, now = Date.now()): boolean {
  return now >= pairing.expiresAt;
}

export interface PairCheck {
  ok: boolean;
  error: string | null;
}

/** 校验配对码：格式 → 过期 → 匹配；错误文案可直接展示。 */
export function verifyPairCode(pairing: Pairing | null, code: string, now = Date.now()): PairCheck {
  if (pairing === null) return { ok: false, error: '配对码无效或已使用，请让对方重新开启配对' };
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: '配对码应为 6 位数字' };
  if (pairingExpired(pairing, now)) return { ok: false, error: '配对码已过期，请让对方重新开启配对' };
  if (code.trim() !== pairing.code) return { ok: false, error: '配对码不正确' };
  return { ok: true, error: null };
}

export function bearerToken(authorization: string | null): string | null {
  if (authorization === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match === null ? null : (match[1] ?? null);
}
