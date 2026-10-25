import type { Storage } from '@dawn-tick/core';
import { isWebApp } from './lib/capabilities.ts';
import { readMetaJson, writeMetaJson } from './lib/meta.ts';
import { LAN_PAIRINGS_META_KEY } from './lib/meta-keys.ts';
import { logWarn } from './log.ts';
import { parsePeerAddress, type PeerAddress } from './lan-sync-protocol.ts';
import {
  refreshPairing,
  type LanSession,
  type RefreshPairResult,
} from './lan-sync-client.ts';

/**
 * 局域网同步：客户端**配对持久化**与**自动重连**。
 *
 * 数据模型（`app_meta` 键 `lan_pairings_v1`；Web 端降级到 `localStorage`）：
 * `{ id, name, host, port, token, pairedAt, lastSyncAt }[]`。
 * 令牌是服务端签发的 180 天长期令牌，明文只在本机保存；服务端只保存它的 SHA-256 哈希。
 *
 * 重连策略：
 * - 页面打开、浏览器 `online` 事件与每 30 秒各探测一次（`POST /pair/refresh`）；
 * - 在线：换新令牌并顺延有效期；离线：保留配对、显示「离线，仍在重试」；
 * - 服务端返回 401：标记「配对已失效」，不自动删除，用户可在设备页移除后重新配对。
 */

/** 客户端配对记录。 */
export interface LanPairing {
  /** 稳定标识：`host:port` */
  id: string;
  name: string;
  host: string;
  port: number;
  /** 长期令牌明文（只在本机） */
  token: string;
  pairedAt: number;
  /** 最近一次成功拉取/推送的时间；从未同步为 null */
  lastSyncAt: number | null;
}

/** Web 端 localStorage 键：与 `app_meta` 同语义，只是存储位置不同。 */
export const LAN_PAIRINGS_STORAGE_KEY = 'dt.lan.pairings.v1';
/** 自动重连探测间隔：30 秒。 */
export const LAN_RECONNECT_INTERVAL_MS = 30_000;
/** 探测失败后最多多久重试（实际就是每个间隔都重试）。 */
export const LAN_PAIRING_OFFLINE_HINT = '离线，仍在重试';

/** localStorage 的最小接口；单测可传内存实现。 */
export interface LanLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function tokenLooksValid(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{16,128}$/i.test(token);
}

/** 归一一条记录；结构不合法返回 null。 */
function parseOne(value: unknown): LanPairing | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Partial<LanPairing>;
  const peer = parsePeerAddress(
    `${typeof record.host === 'string' ? record.host : ''}:${typeof record.port === 'number' ? record.port : ''}`,
  );
  if (peer === null || !tokenLooksValid(record.token)) return null;
  const pairedAt =
    typeof record.pairedAt === 'number' && Number.isFinite(record.pairedAt) && record.pairedAt > 0
      ? record.pairedAt
      : 0;
  const name =
    typeof record.name === 'string' && record.name.trim() !== ''
      ? record.name.trim().slice(0, 48)
      : `${peer.host}:${peer.port}`;
  const id = `${peer.host}:${peer.port}`;
  return {
    id,
    name,
    host: peer.host,
    port: peer.port,
    token: record.token,
    pairedAt,
    lastSyncAt:
      typeof record.lastSyncAt === 'number' && Number.isFinite(record.lastSyncAt) && record.lastSyncAt > 0
        ? record.lastSyncAt
        : null,
  };
}

/** 解析 `app_meta` 值：结构不合法返回 `null`（读取层据此回退空列表）。 */
export function parseLanPairings(value: unknown): LanPairing[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const result: LanPairing[] = [];
  for (const item of value) {
    const pairing = parseOne(item);
    if (pairing === null || seen.has(pairing.id)) continue;
    seen.add(pairing.id);
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
      name: item.name,
      host: item.host,
      port: item.port,
      token: item.token,
      pairedAt: item.pairedAt,
      lastSyncAt: item.lastSyncAt,
    })),
  );
}

/** 新建记录：id 由地址决定，同一台设备重复配对时覆盖而不是堆叠。 */
export function createLanPairing(input: {
  peer: PeerAddress;
  token: string;
  name?: string;
  now?: number;
}): LanPairing {
  const peer = input.peer;
  const name = input.name?.trim() ?? '';
  return {
    id: `${peer.host}:${peer.port}`,
    name: name === '' ? `${peer.host}:${peer.port}` : name.slice(0, 48),
    host: peer.host,
    port: peer.port,
    token: input.token,
    pairedAt: input.now ?? Date.now(),
    lastSyncAt: null,
  };
}

/** 新增或替换同地址记录，按配对时间倒序。 */
export function upsertLanPairing(
  pairings: readonly LanPairing[],
  pairing: LanPairing,
): LanPairing[] {
  const next = pairings.filter((item) => item.id !== pairing.id);
  next.push(pairing);
  return next.sort((left, right) => right.pairedAt - left.pairedAt);
}

/** 删除一条记录。 */
export function removeLanPairing(pairings: readonly LanPairing[], id: string): LanPairing[] {
  return pairings.filter((item) => item.id !== id);
}

/** 更新最近同步时间。 */
export function markLanPairingSynced(
  pairings: readonly LanPairing[],
  id: string,
  now = Date.now(),
): LanPairing[] {
  return pairings.map((item) => (item.id === id ? { ...item, lastSyncAt: now } : item));
}

/** 更新长期令牌（刷新/换新后）。 */
export function updateLanPairingToken(
  pairings: readonly LanPairing[],
  id: string,
  token: string,
): LanPairing[] {
  return pairings.map((item) => (item.id === id ? { ...item, token } : item));
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

/** `上次同步：2026-10-25 21:30` / `尚未同步`。 */
export function formatLanPairingLastSync(pairing: LanPairing): string {
  if (pairing.lastSyncAt === null) return '尚未同步';
  const date = new Date(pairing.lastSyncAt);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `上次同步：${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 读 / 写配对列表的统一出口；Web 用 localStorage，桌面与安卓用 `app_meta`。 */
export interface LanPairingStore {
  load(): Promise<LanPairing[]>;
  save(pairings: readonly LanPairing[]): Promise<void>;
}

function localStore(local: LanLocalStorage | null): LanPairingStore | null {
  if (local === null) return null;
  return {
    async load() {
      try {
        return parseLanPairingsJson(local.getItem(LAN_PAIRINGS_STORAGE_KEY));
      } catch {
        return [];
      }
    },
    async save(pairings) {
      try {
        local.setItem(LAN_PAIRINGS_STORAGE_KEY, serializeLanPairings(pairings));
      } catch (cause: unknown) {
        logWarn('lan-sync', '写入配对列表失败', {
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}

/**
 * 创建持久化出口：Web 端优先 localStorage；localStorage 不可用（隐私模式等）时
 * 退回 `app_meta`，桌面与安卓始终用 `app_meta`。
 */
export function createLanPairingStore(
  storage: Storage,
  options: { localStorage?: LanLocalStorage | null } = {},
): LanPairingStore {
  const local =
    options.localStorage !== undefined
      ? options.localStorage
      : isWebApp()
        ? safeLocalStorage()
        : null;
  const localBacked = localStore(local);
  if (localBacked !== null && (options.localStorage !== undefined || isWebApp())) {
    return {
      async load() {
        const fromLocal = await localBacked.load();
        if (fromLocal.length > 0) return fromLocal;
        // localStorage 为空时读一次 app_meta：兼容从桌面/安卓带过来的数据
        return readMetaPairings(storage);
      },
      async save(pairings) {
        await localBacked.save(pairings);
      },
    };
  }
  return {
    load: () => readMetaPairings(storage),
    save: async (pairings) => {
      await writeMetaJson(storage, LAN_PAIRINGS_META_KEY, JSON.parse(serializeLanPairings(pairings)), {
        scope: 'lan-sync',
      });
    },
  };
}

async function readMetaPairings(storage: Storage): Promise<LanPairing[]> {
  return readMetaJson(storage, LAN_PAIRINGS_META_KEY, {
    parse: parseLanPairings,
    fallback: [],
    scope: 'lan-sync',
  });
}

function safeLocalStorage(): LanLocalStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/* ── 自动重连状态机 ───────────────────────────────────────────── */

/** `unknown` 未探测；`online` 可同步；`offline` 网络不可达；`expired` 服务端拒绝令牌。 */
export type LanPairingState = 'unknown' | 'online' | 'offline' | 'expired';

export interface LanPairingStatus {
  state: LanPairingState;
  checkedAt: number;
  error: string | null;
}

export type LanPairingStatuses = Record<string, LanPairingStatus>;

/** 状态文案：界面直接展示。 */
export function lanPairingStatusText(status: LanPairingStatus | undefined): string {
  switch (status?.state) {
    case 'online':
      return '在线';
    case 'offline':
      return LAN_PAIRING_OFFLINE_HINT;
    case 'expired':
      return '配对已失效，可移除后重新配对';
    default:
      return '未检测';
  }
}

export interface LanPairProbe {
  id: string;
  state: 'online' | 'offline' | 'expired';
  error: string | null;
  /** 在线时服务端换发的新令牌与到期时间 */
  token?: string;
  expiresAt?: number;
}

/** 一次探测：`/pair/refresh` 成功即在线，401 即失效，其它（断网/超时）都算离线。 */
export async function probeLanPairing(
  pairing: LanPairing,
  now = Date.now(),
): Promise<LanPairProbe> {
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

/** 纯状态机：把一批探测结果折进状态表；`checkedAt` 取本次时间。 */
export function reduceLanPairingStatuses(
  current: LanPairingStatuses,
  probes: readonly LanPairProbe[],
  now = Date.now(),
): LanPairingStatuses {
  const next: LanPairingStatuses = { ...current };
  for (const probe of probes) {
    next[probe.id] = {
      state: probe.state,
      checkedAt: now,
      error: probe.error,
    };
  }
  return next;
}

/** 是否该探测：从未探测过、或距上次探测已满间隔。 */
export function shouldProbePairing(
  status: LanPairingStatus | undefined,
  now = Date.now(),
  intervalMs = LAN_RECONNECT_INTERVAL_MS,
): boolean {
  if (status === undefined || status.checkedAt <= 0) return true;
  return now - status.checkedAt >= intervalMs;
}

/** 把探测结果应用到配对列表：在线时换新令牌（离线/失效不动记录）。 */
export function applyLanPairProbes(
  pairings: readonly LanPairing[],
  probes: readonly LanPairProbe[],
): LanPairing[] {
  const tokens = new Map<string, string>();
  for (const probe of probes) {
    if (probe.state === 'online' && probe.token !== undefined) tokens.set(probe.id, probe.token);
  }
  if (tokens.size === 0) return [...pairings];
  return pairings.map((item) => {
    const token = tokens.get(item.id);
    return token === undefined ? item : { ...item, token };
  });
}

/** 需要探测的条目：全量探测最简单，但无配对时返回空数组。 */
export function pairingsToProbe(pairings: readonly LanPairing[]): LanPairing[] {
  return [...pairings];
}
