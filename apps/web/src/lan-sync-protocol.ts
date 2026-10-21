import type { BackupModule } from '@dawn-tick/core';

/**
 * 局域网同步（I-14）的协议层：范围、地址、配对码与会话令牌。
 *
 * 边界：
 * - 纯函数，不碰 `fetch`、Storage 与原生桥；信封与服务端请求处理在
 *   `lan-sync-payload.ts`，客户端与服务端生命周期在 `lan-sync.ts`；
 * - 两端对照见 `apps/mobile/docs/lan-sync.contract.md`；
 * - 鉴权只在这里与载荷层：原生层（Rust / Kotlin）只做传输与限额，配对码、令牌与过期判定
 *   都能被 `apps/web/test/lan-sync.test.ts` 直接覆盖。
 */

/** 信封协议版本：不认识就 400，不做猜测兼容。 */
export const LAN_SYNC_PROTOCOL_VERSION = 1;
/** 信封标识；防止把别的 JSON 当同步数据。 */
export const LAN_SYNC_KIND = 'dawn-tick-lan-sync';
/** 手输地址省略端口时的默认端口。 */
export const LAN_SYNC_PORT = 8765;
/** 配对码有效期：5 分钟。 */
export const PAIR_CODE_TTL_MS = 5 * 60_000;
/** 一次性会话令牌有效期：10 分钟。 */
export const SESSION_TTL_MS = 10 * 60_000;
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

/** 是否局域网地址：10/8、172.16/12、192.168/16、169.254/16、127/8 与 localhost。 */
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

/** 一次已授权的会话（服务端视角与客户端视角用同一个结构）。 */
export interface SessionGrant {
  token: string;
  expiresAt: number;
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

export function grantSession(now = Date.now(), token = randomSessionToken()): SessionGrant {
  return { token, expiresAt: now + SESSION_TTL_MS };
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

export function sessionValid(
  session: SessionGrant | null,
  authorization: string | null,
  now = Date.now(),
): boolean {
  if (session === null) return false;
  if (now >= session.expiresAt) return false;
  const token = bearerToken(authorization);
  return token !== null && token === session.token;
}
