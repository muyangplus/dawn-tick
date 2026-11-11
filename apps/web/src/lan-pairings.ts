import { parsePeerAddress, type PeerAddress } from './lan-sync-protocol.ts';
import {
  pingLanPeer,
  refreshPairing,
  type LanSession,
  type RefreshPairResult,
} from './lan-sync-client.ts';

/**
 * 局域网同步：客户端**配对持久化**（含对端元信息）与单次重连探测。
 *
 * 数据模型（`app_meta` 键 `lan_pairings_v1`；Web 端降级到 `localStorage`）：
 * `{ id, deviceId, name, host, port, token, pairedAt, lastSeen, lastSyncAt }[]`。
 * 令牌是服务端签发的 180 天长期令牌，明文只在本机保存；服务端只保存它的 SHA-256 哈希。
 *
 * 设备身份：协议没有对端设备 id，首次配对时由本机生成稳定的 `deviceId`（等于 `id`），
 * 端口变化、重新配对或 UDP 发现到新地址时都复用同一个 id，否则旧地址会不断堆叠。
 *
 * 重连状态机、指数退避与 UDP 发现更新在 `lan-sync-reconnect.ts`；本模块只做
 * 记录读写、去重与一次 `/pair/refresh` 探测。
 */

/** 客户端配对记录。 */
export interface LanPairing {
  /** 本机记录 id：首次配对生成，IP / 端口变化时保留（旧记录沿用 `host:port`） */
  id: string;
  /**
   * 对端稳定设备标识：优先使用对方广播/协议提供的 id；没有时由本机生成。
   * `host` / `port` 只是「最近一次已知地址」，不参与设备身份判断。
   */
  deviceId: string;
  name: string;
  /** UDP 广播里的设备名（可能与二维码展示名不同）；换 IP 后靠它认回同一台 */
  discoveryName: string | null;
  host: string;
  port: number;
  /** 长期令牌明文（只在本机） */
  token: string;
  /** 首次配对时间；重新配对不会重置 */
  pairedAt: number;
  /** 最近一次成功同步（拉取/推送）的时间；从未同步为 null */
  lastSyncAt: number | null;
  /** 最近一次探测在线或 UDP 发现到对方的时间；从未在线为 null */
  lastSeen: number | null;
}

/** `IP:端口` 形态的兜底名称：重新配对时不能拿它当设备身份。 */
export function isAddressLikeName(name: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(name.trim());
}

function tokenLooksValid(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{16,128}$/i.test(token);
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** 设备 id：字母数字与 `-_.:`，4–64 字符；不合法返回 null。 */
export function normalizeLanDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[A-Za-z0-9._:-]{4,64}$/.test(text)) return null;
  return text;
}

/** 生成本机为对端保存的设备 id（不依赖对端协议）。 */
export function newLanDeviceId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return `peer-${cryptoApi.randomUUID()}`;
  }
  return `peer-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

/** 归一一条记录；结构不合法返回 null。 */
function parseOne(value: unknown): LanPairing | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Partial<LanPairing>;
  const peer = parsePeerAddress(
    `${typeof record.host === 'string' ? record.host : ''}:${typeof record.port === 'number' ? record.port : ''}`,
  );
  if (peer === null || !tokenLooksValid(record.token)) return null;
  const pairedAt = validTime(record.pairedAt) ? record.pairedAt : 0;
  const name =
    typeof record.name === 'string' && record.name.trim() !== ''
      ? record.name.trim().slice(0, 48)
      : `${peer.host}:${peer.port}`;
  // 旧记录只有 id（host:port）；新记录 id 是本地记录键，deviceId 是设备身份
  const recordId = normalizeLanDeviceId(record.id);
  const deviceId = normalizeLanDeviceId(record.deviceId) ?? recordId ?? `${peer.host}:${peer.port}`;
  const id = recordId ?? deviceId;
  const discoveryName =
    typeof record.discoveryName === 'string' && record.discoveryName.trim() !== ''
      ? record.discoveryName.trim().slice(0, 48)
      : null;
  return {
    id,
    deviceId,
    name,
    discoveryName,
    host: peer.host,
    port: peer.port,
    token: record.token,
    pairedAt,
    lastSyncAt: validTime(record.lastSyncAt) ? record.lastSyncAt : null,
    lastSeen: validTime(record.lastSeen) ? record.lastSeen : null,
  };
}

/** 解析 `app_meta` 值：结构不合法返回 `null`（读取层据此回退空列表）。 */
export function parseLanPairings(value: unknown): LanPairing[] | null {
  if (!Array.isArray(value)) return null;
  const seenIds = new Set<string>();
  const seenDevices = new Set<string>();
  const result: LanPairing[] = [];
  for (const item of value) {
    const pairing = parseOne(item);
    if (pairing === null || seenIds.has(pairing.id) || seenDevices.has(pairing.deviceId)) continue;
    seenIds.add(pairing.id);
    seenDevices.add(pairing.deviceId);
    result.push(pairing);
  }
  return result.sort((left, right) => right.pairedAt - left.pairedAt);
}

/** 从 JSON 文本解析；损坏时返回空列表。 */
export function parseLanPairingsJson(text: string | null | undefined): LanPairing[] {
  if (text === null || text === undefined || text.trim() === '') return [];
  try {
    return parseLanPairings(JSON.parse(text)) ?? [];
  } catch {
    return [];
  }
}

/** 序列化为 `app_meta` / localStorage 的文本。 */
export function serializeLanPairings(pairings: readonly LanPairing[]): string {
  return JSON.stringify(
    pairings.map((item) => ({
      id: item.id,
      deviceId: item.deviceId,
      name: item.name,
      discoveryName: item.discoveryName,
      host: item.host,
      port: item.port,
      token: item.token,
      pairedAt: item.pairedAt,
      lastSeen: item.lastSeen,
      lastSyncAt: item.lastSyncAt,
    })),
  );
}

/** 新建记录：设备 id 由调用方给（发现/重连复用）或本地生成。 */
export function createLanPairing(input: {
  peer: PeerAddress;
  token: string;
  name?: string;
  deviceId?: string;
  now?: number;
}): LanPairing {
  const peer = input.peer;
  const deviceId = normalizeLanDeviceId(input.deviceId) ?? newLanDeviceId();
  const name = input.name?.trim() ?? '';
  const now = input.now ?? Date.now();
  return {
    id: deviceId,
    deviceId,
    name: name === '' ? `${peer.host}:${peer.port}` : name.slice(0, 48),
    discoveryName: null,
    host: peer.host,
    port: peer.port,
    token: input.token,
    pairedAt: now,
    lastSyncAt: null,
    lastSeen: now,
  };
}

/** 找到同一条设备记录：先按 id/deviceId，再按唯一设备名（端口变化后的重新配对）。 */
export function findSameLanPairing(
  pairings: readonly LanPairing[],
  pairing: LanPairing,
): LanPairing | null {
  const sameId = pairings.find(
    (item) => item.id === pairing.id || item.deviceId === pairing.deviceId,
  );
  if (sameId !== undefined) return sameId;
  if (isAddressLikeName(pairing.name)) return null;
  const sameName = pairings.filter((item) => item.name === pairing.name);
  if (sameName.length === 1) return sameName[0] ?? null;
  // 同名多台设备时只认同地址，避免把另一台同名设备合并掉
  return sameName.find((item) => item.host === pairing.host) ?? null;
}

/**
 * 新增或替换同一设备的记录：端口变化覆盖旧地址，保留原 `id`/`deviceId` 与首次配对时间。
 * 按配对时间倒序。
 */
export function upsertLanPairing(
  pairings: readonly LanPairing[],
  pairing: LanPairing,
): LanPairing[] {
  const same = findSameLanPairing(pairings, pairing);
  const record: LanPairing =
    same === null
      ? pairing
      : {
          ...pairing,
          id: same.id,
          deviceId: same.deviceId,
          discoveryName: pairing.discoveryName ?? same.discoveryName,
          pairedAt: same.pairedAt > 0 ? same.pairedAt : pairing.pairedAt,
          lastSyncAt: same.lastSyncAt,
          lastSeen: pairing.lastSeen ?? same.lastSeen,
        };
  const next = pairings.filter(
    (item) => item.id !== record.id && item.deviceId !== record.deviceId,
  );
  next.push(record);
  return next.sort((left, right) => right.pairedAt - left.pairedAt);
}

/** 删除一条记录。 */
export function removeLanPairing(pairings: readonly LanPairing[], id: string): LanPairing[] {
  return pairings.filter((item) => item.id !== id);
}

/** 按地址找记录：拉取/推送成功时用来回写 `lastSyncAt`（会话里没有设备 id）。 */
export function findLanPairingByPeer(
  pairings: readonly LanPairing[],
  peer: PeerAddress,
): LanPairing | null {
  return pairings.find((item) => item.host === peer.host && item.port === peer.port) ?? null;
}

/** 更新最近同步时间：同步成功也算「见到了对方」。 */
export function markLanPairingSynced(
  pairings: readonly LanPairing[],
  id: string,
  now = Date.now(),
): LanPairing[] {
  return pairings.map((item) =>
    item.id === id ? { ...item, lastSyncAt: now, lastSeen: now } : item,
  );
}

/** 更新最近在线时间（探测成功 / UDP 发现）。 */
export function markLanPairingSeen(
  pairings: readonly LanPairing[],
  id: string,
  now = Date.now(),
): LanPairing[] {
  return pairings.map((item) => (item.id === id ? { ...item, lastSeen: now } : item));
}

/** 记下 UDP 广播里的设备名：二维码展示名可能只是「Windows 电脑」，换 IP 后靠它认设备。 */
export function markLanPairingDiscoveryName(
  pairings: readonly LanPairing[],
  id: string,
  discoveryName: string,
): LanPairing[] {
  const name = discoveryName.trim().slice(0, 48);
  if (name === '') return [...pairings];
  return pairings.map((item) =>
    item.id === id && item.discoveryName !== name ? { ...item, discoveryName: name } : item,
  );
}

/** 更新长期令牌（刷新/换新后）。 */
export function updateLanPairingToken(
  pairings: readonly LanPairing[],
  id: string,
  token: string,
): LanPairing[] {
  return pairings.map((item) => (item.id === id ? { ...item, token } : item));
}

/** 端口 / 地址变化：同一个 `id` 原地覆盖，不新增记录。 */
export function updateLanPairingAddress(
  pairings: readonly LanPairing[],
  id: string,
  peer: PeerAddress,
  now = Date.now(),
  name?: string,
): LanPairing[] {
  return pairings.map((item) =>
    item.id === id
      ? {
          ...item,
          host: peer.host,
          port: peer.port,
          lastSeen: now,
          ...(name === undefined || name.trim() === '' ? {} : { name: name.trim().slice(0, 48) }),
        }
      : item,
  );
}

/** 配对记录 → 传输会话。 */
export function pairingSession(pairing: LanPairing): LanSession {
  return {
    peer: { host: pairing.host, port: pairing.port },
    token: pairing.token,
    // 本地不保存服务端到期时间：探测/传输失败会由服务端 401 或自动重连纠正
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

/** 已配对设备的展示行：`书房电脑 · 192.168.1.5:8765`。 */
export function formatLanPairingLabel(pairing: LanPairing): string {
  return `${pairing.name} · ${pairing.host}:${pairing.port}`;
}

function formatTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** `上次同步：2026-10-25 21:30` / `尚未同步`。 */
export function formatLanPairingLastSync(pairing: LanPairing): string {
  if (pairing.lastSyncAt === null) return '尚未同步';
  return `上次同步：${formatTime(pairing.lastSyncAt)}`;
}

/** `最近在线：2026-10-25 21:30` / `尚未在线`。 */
export function formatLanPairingLastSeen(pairing: LanPairing): string {
  if (pairing.lastSeen === null) return '尚未在线';
  return `最近在线：${formatTime(pairing.lastSeen)}`;
}

/* ── 单次重连探测 ─────────────────────────────────────────────── */

export interface LanPairProbe {
  id: string;
  state: 'online' | 'offline' | 'expired';
  error: string | null;
  /** 在线时服务端换发的新令牌与到期时间 */
  token?: string;
  expiresAt?: number;
}

/**
 * 一次探测：先 `GET /ping`（3 秒）快速判断旧地址是否还可达；可达再 `POST /pair/refresh`
 * 换新令牌。401 即失效，其它（ECONNREFUSED / 超时 / 断网）都算离线，交给
 * `lan-sync-reconnect.ts` 退避并尝试 UDP 发现新地址。
 */
export async function probeLanPairing(
  pairing: LanPairing,
  now = Date.now(),
): Promise<LanPairProbe> {
  const ping = await pingLanPeer({ host: pairing.host, port: pairing.port });
  if (!ping.ok) {
    return { id: pairing.id, state: 'offline', error: ping.error ?? '网络不可达' };
  }
  const result: RefreshPairResult = await refreshPairing(pairingSession(pairing), now);
  if (result.ok && result.token !== null) {
    return {
      id: pairing.id,
      state: 'online',
      error: null,
      token: result.token,
      ...(result.expiresAt === null ? {} : { expiresAt: result.expiresAt }),
    };
  }
  if (result.status === 401) {
    return { id: pairing.id, state: 'expired', error: result.error ?? '配对已失效，请重新配对' };
  }
  return { id: pairing.id, state: 'offline', error: result.error ?? '网络不可达' };
}

/** 把在线探测结果应用到配对列表：换新令牌并更新 `lastSeen`；离线/失效不动记录。 */
export function applyLanPairProbes(
  pairings: readonly LanPairing[],
  probes: readonly LanPairProbe[],
  now = Date.now(),
): LanPairing[] {
  const tokens = new Map<string, string>();
  for (const probe of probes) {
    if (probe.state === 'online' && probe.token !== undefined) tokens.set(probe.id, probe.token);
  }
  if (tokens.size === 0) return [...pairings];
  return pairings.map((item) => {
    const token = tokens.get(item.id);
    return token === undefined ? item : { ...item, token, lastSeen: now };
  });
}
