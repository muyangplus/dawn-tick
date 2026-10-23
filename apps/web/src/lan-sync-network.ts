import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { invokeNative } from './lib/native.ts';
import { loadPlugin, type LanSyncPlugin } from './lib/plugins.ts';
import { logWarn } from './log.ts';
import { isLanAddress } from './lan-sync-protocol.ts';

/**
 * 局域网多网络识别（桌面 / 安卓）：候选排序、默认选择与界面文案。
 *
 * 边界：
 * - 排序、默认选择、地址合法性、文案都是纯函数，可直接单测；
 * - 枚举只在原生层（Rust `lan_network_list` / Android `LanSync.networks`），这里只归一数据；
 * - 选中地址存 `localStorage` 的 `dt.lan.host`（只存地址，不存配对码或令牌）；
 * - 网段优先级与 `apps/desktop/src-tauri/src/lan_network.rs`、Android `LanNetworks.kt` 一致：
 *   192.168.* > 10.* > 172.16–31.* > 100.64/10 > 169.254/16；VPN 降级但不排除。
 */

export type LanNetworkKind = 'wifi' | 'ethernet' | 'vpn' | 'other';

/** 一块网卡地址；字段与 Rust `LanNetwork`、Android `networks()` 逐字一致。 */
export interface LanNetwork {
  name: string;
  address: string;
  isLan: boolean;
  kind: LanNetworkKind;
  /** 越小越优先；原生层按网段算好，TS 只用于排序与展示。 */
  preferred: number;
}

/** 选中地址的存储键：只存「网络地址」，不存任何凭据。 */
export const LAN_HOST_STORAGE_KEY = 'dt.lan.host';

export const LAN_KIND_LABEL: Record<LanNetworkKind, string> = {
  wifi: 'Wi-Fi',
  ethernet: '有线网络',
  vpn: 'VPN',
  other: '其他',
};

const KIND_TIER: Record<LanNetworkKind, number> = {
  wifi: 0,
  ethernet: 0,
  other: 1,
  vpn: 2,
};

/** 解析 IPv4 为 32 位整数；不合法返回 null。 */
function ipv4Value(address: string): number | null {
  const parts = address.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** 常见局域网网段的优先级：数字越小越优先；非局域网为 9。 */
export function lanAddressRank(address: string): number {
  const parts = address.trim().split('.');
  if (parts.length !== 4) return 9;
  const [first, second] = parts.map(Number) as [number, number, number, number];
  if (first === 192 && second === 168) return 0;
  if (first === 10) return 1;
  if (first === 172 && second >= 16 && second <= 31) return 2;
  if (first === 100 && second >= 64 && second <= 127) return 3;
  if (first === 169 && second === 254) return 4;
  return 9;
}

/** 是否常见局域网网段（192.168 / 10 / 172.16–31）。 */
export function isPreferredLanAddress(address: string): boolean {
  return lanAddressRank(address) <= 2;
}

function kindOf(value: unknown): LanNetworkKind | null {
  return value === 'wifi' || value === 'ethernet' || value === 'vpn' || value === 'other'
    ? value
    : null;
}

/**
 * 候选排序：局域网优先 → 有线/无线优先于其它、VPN 最后 → 网段优先级 → 地址数值。
 * 与 `lan_network.rs`、`LanNetworks.kt` 保持同一顺序，三端默认选择才会一致。
 */
export function compareLanNetworks(left: LanNetwork, right: LanNetwork): number {
  if (left.isLan !== right.isLan) return left.isLan ? -1 : 1;
  const tier = KIND_TIER[left.kind] - KIND_TIER[right.kind];
  if (tier !== 0) return tier;
  if (left.preferred !== right.preferred) return left.preferred - right.preferred;
  const leftValue = ipv4Value(left.address);
  const rightValue = ipv4Value(right.address);
  if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
    return leftValue - rightValue;
  }
  return left.address.localeCompare(right.address);
}

export function sortLanNetworks(networks: readonly LanNetwork[]): LanNetwork[] {
  return [...networks].sort(compareLanNetworks);
}

/** 默认选择：排序后第一条局域网地址；没有局域网候选时返回 null。 */
export function defaultLanNetwork(networks: readonly LanNetwork[]): LanNetwork | null {
  return sortLanNetworks(networks).find((network) => network.isLan) ?? null;
}

/** 「192.168.1.23 · Wi-Fi」：网络行与下拉项共用。 */
export function formatLanNetworkLabel(network: LanNetwork): string {
  return `${network.address} · ${LAN_KIND_LABEL[network.kind]}`;
}

/** 「网络：192.168.1.23 · Wi-Fi」：设备页上的一行。 */
export function formatLanNetworkLine(network: LanNetwork): string {
  return `网络：${formatLanNetworkLabel(network)}`;
}

/**
 * 决定实际使用的地址：存储的地址仍在本机候选里就用它，否则退回默认首选。
 * 返回 null 表示没有可用局域网（交给调用方按「自动选择」处理）。
 */
export function resolveLanHost(
  networks: readonly LanNetwork[],
  stored: string | null | undefined,
): string | null {
  const text = (stored ?? '').trim();
  if (text !== '' && isLanAddress(text)) {
    const matched = networks.find((network) => network.address === text);
    if (matched !== undefined && matched.isLan) return matched.address;
  }
  return defaultLanNetwork(networks)?.address ?? null;
}

/** 归一原生返回的候选列表：字段缺失、地址非法、重复地址一律丢掉。 */
export function parseLanNetworks(raw: unknown): LanNetwork[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: LanNetwork[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Partial<LanNetwork>;
    const address = typeof record.address === 'string' ? record.address.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const kind = kindOf(record.kind);
    if (name === '' || kind === null || !isLanAddress(address)) continue;
    if (seen.has(address)) continue;
    seen.add(address);
    const preferred =
      typeof record.preferred === 'number' && Number.isFinite(record.preferred)
        ? record.preferred
        : lanAddressRank(address);
    result.push({
      name,
      address,
      isLan: record.isLan === true,
      kind,
      preferred,
    });
  }
  return sortLanNetworks(result);
}

/** `localStorage` 的最小接口；单测可传内存实现。 */
export interface LanHostStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): LanHostStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** 读取已选网络地址；没有或不是局域网地址时返回 null。 */
export function readStoredLanHost(storage: LanHostStorage | null = defaultStorage()): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(LAN_HOST_STORAGE_KEY)?.trim() ?? '';
    return value !== '' && isLanAddress(value) ? value : null;
  } catch {
    return null;
  }
}

/** 记住用户选中的网络地址；空串表示清除。 */
export function saveStoredLanHost(
  host: string,
  storage: LanHostStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    const value = host.trim();
    if (value === '') storage.removeItem?.(LAN_HOST_STORAGE_KEY);
    else storage.setItem(LAN_HOST_STORAGE_KEY, value);
  } catch {
    // 存储不可用（隐私模式等）时只是不记忆，不影响本次选择
  }
}

/** 冒烟 / 单测用固定候选列表，避免依赖真实网卡。 */
type LanNetworkLister = () => Promise<LanNetwork[]>;
let listOverride: LanNetworkLister | null = null;

export function setLanNetworkListerForTests(lister: LanNetworkLister | null): void {
  listOverride = lister;
}

/**
 * 列本机候选网络：桌面走 `lan_network_list`，安卓走 `LanSync.networks`；
 * 其它平台或失败时返回空列表（界面退回「自动选择」）。
 */
export async function listLanNetworks(): Promise<LanNetwork[]> {
  if (listOverride !== null) {
    try {
      return parseLanNetworks(await listOverride());
    } catch (cause: unknown) {
      logWarn('lan-sync', '读取本机网络失败', { message: cause instanceof Error ? cause.message : String(cause) });
      return [];
    }
  }
  try {
    if (isDesktopApp()) {
      return parseLanNetworks(await invokeNative<unknown>('lan_network_list'));
    }
    if (isAndroidApp()) {
      const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
      const result = await plugin?.networks();
      return parseLanNetworks(result?.networks);
    }
  } catch (cause: unknown) {
    logWarn('lan-sync', '读取本机网络失败', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return [];
}
