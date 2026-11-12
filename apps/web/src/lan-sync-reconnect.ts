import { scanLanPeers, type LanDiscoveryPeer } from './lan-sync-discovery.ts';
import { pingLanPeer, refreshPairing, type RefreshPairResult } from './lan-sync-client.ts';
import type { LanPairing } from './lan-pairings.ts';
import {
  isAddressLikeName,
  isEphemeralLanDeviceId,
  pairingSession,
} from './lan-pairings.ts';

/**
 * 局域网同步：已配对设备的**自动重连状态机**、**指数退避**与 **UDP 发现换地址**。
 *
 * 问题背景：安卓端停止/离开页面后监听端口关闭，桌面端仍按旧 `host:port`
 * 每 30 秒重试，形成无限刷日志；安卓再次开配对又换了随机端口，桌面不知道。
 *
 * 策略：
 * - 离线后按 30s → 60s → 120s → 240s → 300s 退避，封顶 5 分钟，不再高频打同一地址；
 * - 每次离线探测后顺带扫一次 UDP 发现，按设备名找到同一设备的新 `host:port`，
 *   原地更新持久化记录并立刻探测新地址；
 * - 401 标记「配对失效」并停止自动重试；找不到新地址就提示重新开启配对 / 重新扫码。
 *
 * 本模块是纯策略 + 扫描 / 探测调用，不碰存储；写回由已配对设备面板负责。
 */

/** 首次重试间隔：30 秒。 */
export const LAN_RECONNECT_INTERVAL_MS = 30_000;
/** 退避上限：5 分钟；超过后不再更久，网络恢复仍能较快重连。 */
export const LAN_RECONNECT_MAX_MS = 5 * 60_000;
/** 面板检查「谁该重试」的节拍：只读内存状态，不发网络请求。 */
export const LAN_RECONNECT_TICK_MS = 15_000;
/** 离线文案：明确告诉用户端口可能已变化，并给出下一步。 */
export const LAN_PAIRING_OFFLINE_HINT = '离线（端口可能已变化）：请让对方重新开启配对或重新扫码';
/** 配对失效文案。 */
export const LAN_PAIRING_EXPIRED_HINT = '配对已失效，可移除后重新配对';

/** `unknown` 未探测；`online` 可同步；`offline` 网络不可达；`expired` 服务端拒绝令牌。 */
export type LanPairingState = 'unknown' | 'online' | 'offline' | 'expired';

export interface LanPairingStatus {
  state: LanPairingState;
  checkedAt: number;
  error: string | null;
  /** 连续失败次数；在线归零，失效不再增加 */
  failures: number;
  /** 下一次允许探测的绝对时间；失效为 `Infinity`（停止自动重试） */
  nextRetryAt: number;
  /** 最近一次为这条记录扫描 UDP 发现的时间 */
  discoveredAt: number | null;
}

export type LanPairingStatuses = Record<string, LanPairingStatus>;

/** 指数退避：30s、60s、120s、240s、300s…，上限 5 分钟。 */
export function nextRetryDelayMs(failures: number): number {
  const attempts = Math.max(1, Math.floor(failures));
  return Math.min(LAN_RECONNECT_INTERVAL_MS * 2 ** (attempts - 1), LAN_RECONNECT_MAX_MS);
}

/** 状态文案：界面直接展示。 */
export function lanPairingStatusText(status: LanPairingStatus | undefined): string {
  switch (status?.state) {
    case 'online':
      return '在线';
    case 'offline':
      return LAN_PAIRING_OFFLINE_HINT;
    case 'expired':
      return LAN_PAIRING_EXPIRED_HINT;
    default:
      return '未检测';
  }
}

/** 退避倒计时文案；不在退避中返回空串。 */
export function formatLanPairingRetry(
  status: LanPairingStatus | undefined,
  now = Date.now(),
): string {
  if (status === undefined || status.state !== 'offline') return '';
  if (!Number.isFinite(status.nextRetryAt)) return '';
  const remaining = status.nextRetryAt - now;
  if (remaining <= 0) return '正在重试…';
  const seconds = Math.max(1, Math.ceil(remaining / 1000));
  if (seconds < 60) return `下次重试：${seconds} 秒后`;
  return `下次重试：${Math.ceil(seconds / 60)} 分钟后`;
}

/** 是否该探测：未探测过立即探测；失效停用；其余看退避时间。 */
export function shouldProbePairing(
  status: LanPairingStatus | undefined,
  now = Date.now(),
): boolean {
  if (status === undefined) return true;
  if (status.state === 'expired') return false;
  return now >= status.nextRetryAt;
}

/** 纯状态机：把一批探测结果折进状态表，失败累计并计算下一次退避时间。 */
export function reduceLanPairingStatuses(
  current: LanPairingStatuses,
  probes: readonly LanPairProbe[],
  now = Date.now(),
): LanPairingStatuses {
  const next: LanPairingStatuses = { ...current };
  for (const probe of probes) {
    const previous = current[probe.id];
    const base = {
      checkedAt: now,
      error: probe.error,
      discoveredAt: previous?.discoveredAt ?? null,
    };
    if (probe.state === 'online') {
      next[probe.id] = {
        ...base,
        state: 'online',
        failures: 0,
        nextRetryAt: now + LAN_RECONNECT_INTERVAL_MS,
      };
    } else if (probe.state === 'expired') {
      next[probe.id] = {
        ...base,
        state: 'expired',
        failures: previous?.failures ?? 0,
        nextRetryAt: Number.POSITIVE_INFINITY,
      };
    } else {
      const failures = (previous?.failures ?? 0) + 1;
      next[probe.id] = {
        ...base,
        state: 'offline',
        failures,
        nextRetryAt: now + nextRetryDelayMs(failures),
      };
    }
  }
  return next;
}

/** 记录「这批设备刚做过 UDP 发现」，避免界面重复提示还在找。 */
export function markLanDiscoveryAttempted(
  current: LanPairingStatuses,
  ids: readonly string[],
  now = Date.now(),
): LanPairingStatuses {
  const next: LanPairingStatuses = { ...current };
  for (const id of ids) {
    const status = next[id];
    if (status !== undefined) next[id] = { ...status, discoveredAt: now };
  }
  return next;
}

/** 当前到点、应该探测的记录；`statuses` 里没有的（新配对）立即探测。 */
export function dueLanPairings(
  pairings: readonly LanPairing[],
  statuses: LanPairingStatuses,
  now = Date.now(),
): LanPairing[] {
  return pairings.filter((pairing) => shouldProbePairing(statuses[pairing.id], now));
}

/**
 * 在 UDP 发现结果里找同一台设备：优先稳定 `deviceId`（IP / 端口变化不影响），
 * 其次按设备名；同名多台时优先同 IP。地址型兜底名不参与匹配。
 */
export function matchDiscoveryPeer(
  pairing: LanPairing,
  peers: readonly LanDiscoveryPeer[],
): LanDiscoveryPeer | null {
  const byDevice = peers.find(
    (peer) => peer.deviceId !== undefined && peer.deviceId === pairing.deviceId,
  );
  if (byDevice !== undefined) return byDevice;
  // 二维码展示名可能只是「Windows 电脑」，与 UDP 广播的计算机名不同；
  // 优先用配对时记下的广播名，其次才退回展示名（旧记录没有广播名）。
  const wanted = (pairing.discoveryName ?? pairing.name).trim();
  if (wanted === '') return null;
  if (pairing.discoveryName === null && isAddressLikeName(wanted)) return null;
  const trustedDevice = !isEphemeralLanDeviceId(pairing.deviceId);
  const sameName = peers.filter(
    (peer) =>
      peer.name.trim() === wanted &&
      // 已知道对端真实 id 时，不把另一个明确 id 不同的同名设备认成同一台
      (!trustedDevice || peer.deviceId === undefined || peer.deviceId === pairing.deviceId),
  );
  if (sameName.length === 0) return null;
  if (sameName.length === 1) return sameName[0] ?? null;
  const sameHost = sameName.filter((peer) => peer.host === pairing.host);
  return sameHost.length === 1 ? (sameHost[0] ?? null) : null;
}

/**
 * 发现到新 `host:port` 时生成更新后的记录；没发现、同名有歧义或地址没变返回 null。
 * 地址原地覆盖，`id` / 令牌 / 配对时间都保留；首次拿到对端真实 deviceId 时一并记下。
 */
export function applyDiscoveryAddress(
  pairing: LanPairing,
  peers: readonly LanDiscoveryPeer[],
  now = Date.now(),
): LanPairing | null {
  const peer = matchDiscoveryPeer(pairing, peers);
  if (peer === null) return null;
  const adoptDevice = peer.deviceId !== undefined && isEphemeralLanDeviceId(pairing.deviceId);
  const moved = peer.host !== pairing.host || peer.port !== pairing.port;
  const discoveryName = peer.name.trim().slice(0, 48);
  const renamed = discoveryName !== '' && pairing.discoveryName !== discoveryName;
  if (!moved && !adoptDevice && !renamed) return null;
  return {
    ...pairing,
    deviceId: adoptDevice && peer.deviceId !== undefined ? peer.deviceId : pairing.deviceId,
    discoveryName: discoveryName === '' ? pairing.discoveryName : discoveryName,
    host: peer.host,
    port: peer.port,
    name: isAddressLikeName(pairing.name) ? discoveryName || pairing.name : pairing.name,
    lastSeen: now,
  };
}

export interface LanDiscoveryReconnectResult {
  /** 更新后的完整配对列表（未变化时与入参等值） */
  pairings: LanPairing[];
  /** 地址被更新的记录：调用方据此立刻探测新地址并持久化 */
  updated: LanPairing[];
  /** 本次发现扫到的设备数 */
  scanned: number;
}

/**
 * 为离线设备扫一轮 UDP，按设备名换新地址。
 * 只做发现与地址替换，不探测、不写存储；失败由 `scanLanPeers` 静默返回空列表。
 */
export async function discoverPairingAddresses(
  pairings: readonly LanPairing[],
  targets: readonly LanPairing[],
  now = Date.now(),
): Promise<LanDiscoveryReconnectResult> {
  if (targets.length === 0) return { pairings: [...pairings], updated: [], scanned: 0 };
  const peers = await scanLanPeers();
  if (peers.length === 0) return { pairings: [...pairings], updated: [], scanned: 0 };
  let next = [...pairings];
  const updated: LanPairing[] = [];
  for (const target of targets) {
    const current = next.find((item) => item.id === target.id);
    if (current === undefined) continue;
    const discovered = applyDiscoveryAddress(current, peers, now);
    if (discovered === null) continue;
    next = next.map((item) => (item.id === discovered.id ? discovered : item));
    updated.push(discovered);
  }
  return { pairings: next, updated, scanned: peers.length };
}

/** 列表里是否有记录需要探测：给暂停 / 定时器判断用。 */
export function hasDueLanPairing(
  pairings: readonly LanPairing[],
  statuses: LanPairingStatuses,
  now = Date.now(),
): boolean {
  return pairings.some((pairing) => shouldProbePairing(statuses[pairing.id], now));
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
 * 本模块退避并尝试 UDP 发现新地址。
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
