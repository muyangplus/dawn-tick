import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { errorMessage } from './lib/errors.ts';
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
 *   安卓的 `status` 快照用于解释空态（没连 / 只有移动数据 / 有 Wi-Fi 但没有 IPv4）；
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

/**
 * 当前网络状态快照（Android `networks()` 的 `status`）：只用于解释空态，不参与配对。
 *
 * 字段与 Kotlin `LanNetworkStatus`、`apps/mobile/docs/lan-sync.contract.md` 逐字一致。
 * 旧版本原生层不返回这个字段，界面按 `null` 处理并保留原文案。
 */
export interface LanNetworkStatus {
  /** 当前至少有一个 Wi-Fi 网络（含只有 IPv6 的 Wi-Fi）。 */
  wifi: boolean;
  ethernet: boolean;
  /** 移动数据（蜂窝）。 */
  mobile: boolean;
  vpn: boolean;
  /** 可做局域网同步的 IPv4 候选数；与 `networks.length` 一致。 */
  ipv4Count: number;
  /** 一行网卡摘要，供「诊断信息」与复制使用；原生层保证非空（没有网卡时为「0 块网卡」）。 */
  interfaceSummary: string;
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

/** 没有候选地址时的默认文案：不知道网络状态（桌面 / 旧版本原生层）时继续用它。 */
export const LAN_NETWORK_EMPTY_HINT = '未发现局域网地址：请确认已连接 Wi-Fi/热点';

/** 有 Wi-Fi 但没有 IPv4：最常见的真机问题（Wi-Fi 只分到 IPv6 或 DHCP 没给地址）。 */
export const LAN_NETWORK_WIFI_IPV6_HINT =
  '已连接 Wi-Fi，但没有拿到 IPv4 地址（可能是仅 IPv6 网络），请尝试重新连接 Wi-Fi';

/** 有线同理：有线只拿到 IPv6 时给出与 Wi-Fi 不同的可操作建议。 */
export const LAN_NETWORK_ETHERNET_IPV6_HINT =
  '已连接有线网络，但没有拿到 IPv4 地址（可能是仅 IPv6 网络），请检查网线或路由器的 DHCP';

/** 只有移动数据：开配对必须与对方在同一 Wi-Fi / 局域网。 */
export const LAN_NETWORK_MOBILE_HINT =
  '当前没有 Wi-Fi/有线连接：开配对需要两台设备在同一 Wi-Fi，请先连接';

/**
 * 空态文案：先看原生报告的当前传输类型，再看有没有候选 IPv4。
 *
 * 调用前提是候选列表本来就是空的；`status` 为 null 表示原生层没提供状态（桌面或旧版本），
 * 此时保留原文案。只有 Wi-Fi / 有线时才提示「没拿到 IPv4」，避免把「没连 Wi-Fi」
 * 误报成「Wi-Fi 连上了但没地址」。
 */
export function lanNetworkEmptyHint(status: LanNetworkStatus | null): string {
  if (status === null) return LAN_NETWORK_EMPTY_HINT;
  if (status.wifi) return LAN_NETWORK_WIFI_IPV6_HINT;
  if (status.ethernet) return LAN_NETWORK_ETHERNET_IPV6_HINT;
  if (status.mobile) return LAN_NETWORK_MOBILE_HINT;
  return LAN_NETWORK_EMPTY_HINT;
}

/** 空态附加诊断信息是否显示：只有「状态里什么传输都没有」时展开网卡摘要。 */
export function shouldShowLanNetworkDiagnostics(status: LanNetworkStatus | null): boolean {
  if (status === null) return false;
  if (status.wifi || status.ethernet || status.mobile) return false;
  return status.interfaceSummary.trim() !== '';
}

/** 「复制诊断信息」的文本：只含网卡 / 状态，不含配对码、令牌或任何业务数据。 */
export interface LanNetworkDiagnosticsInput {
  networks: readonly LanNetwork[];
  status: LanNetworkStatus | null;
  error?: string | null;
}

export function formatLanNetworkDiagnostics(input: LanNetworkDiagnosticsInput): string {
  const yes = (value: boolean): string => (value ? '是' : '否');
  const lines: string[] = ['晓刻局域网诊断'];
  lines.push(`候选 IPv4：${input.networks.length} 个`);
  if (input.networks.length === 0) {
    lines.push('候选列表：（空）');
  } else {
    for (const network of input.networks) {
      const flag = network.isLan ? '' : '（非局域网）';
      lines.push(`- ${network.address} / ${network.name} / ${network.kind}${flag}`);
    }
  }
  if (input.status === null) {
    lines.push('网络状态：（原生层未返回）');
  } else {
    lines.push(
      `网络状态：Wi-Fi=${yes(input.status.wifi)} 有线=${yes(input.status.ethernet)} ` +
        `移动数据=${yes(input.status.mobile)} VPN=${yes(input.status.vpn)} ` +
        `IPv4=${input.status.ipv4Count}`,
    );
    lines.push(`网卡摘要：${input.status.interfaceSummary.trim() || '（空）'}`);
  }
  const error = (input.error ?? '').trim();
  if (error !== '') lines.push(`读取错误：${error}`);
  return lines.join('\n');
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

/** 原生返回的原始结构：桌面是数组，Android 是 `{networks, status}`。 */
export interface LanNetworkRawResult {
  networks?: unknown;
  status?: unknown;
}

/**
 * 归一原生 `status`：不是对象就当「未提供」（旧版本 / 桌面返回 null），
 * 字段缺失或类型不对按 false / 0 / 空串处理，避免一行坏数据让整个空态异常。
 */
export function parseLanNetworkStatus(raw: unknown): LanNetworkStatus | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Partial<LanNetworkStatus>;
  const ipv4Count =
    typeof record.ipv4Count === 'number' && Number.isFinite(record.ipv4Count)
      ? Math.max(0, Math.trunc(record.ipv4Count))
      : 0;
  return {
    wifi: record.wifi === true,
    ethernet: record.ethernet === true,
    mobile: record.mobile === true,
    vpn: record.vpn === true,
    ipv4Count,
    interfaceSummary:
      typeof record.interfaceSummary === 'string' ? record.interfaceSummary.trim() : '',
  };
}

/** 归一原生返回：兼容桌面数组与 Android `{networks, status}` 两种形状。 */
export function parseLanNetworkResult(raw: unknown): {
  networks: LanNetwork[];
  status: LanNetworkStatus | null;
} {
  if (Array.isArray(raw)) return { networks: parseLanNetworks(raw), status: null };
  if (typeof raw !== 'object' || raw === null) return { networks: [], status: null };
  const record = raw as LanNetworkRawResult;
  return {
    networks: parseLanNetworks(record.networks),
    status: parseLanNetworkStatus(record.status),
  };
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

/**
 * 冒烟 / 单测用的固定网络源，避免依赖真实网卡。
 * 可以返回旧形状（只有数组），也可以返回原生新形状 `{networks, status}`。
 */
type LanNetworkLister = () => Promise<LanNetwork[] | LanNetworkRawResult>;
let listOverride: LanNetworkLister | null = null;

export function setLanNetworkListerForTests(lister: LanNetworkLister | null): void {
  listOverride = lister;
}

/**
 * 候选网络 + 当前网络状态 + 可读错误：
 * Android 在权限/ROM 异常时不再把失败伪装成「没有网络」，空态也能按状态给出原因。
 */
export interface LanNetworkListResult {
  networks: LanNetwork[];
  /** 原生提供的传输类型快照；桌面 / 旧版本为 null（界面保留原文案）。 */
  status: LanNetworkStatus | null;
  error: string | null;
}

/**
 * 列本机候选网络：桌面走 `lan_network_list`，安卓走 `LanSync.networks`；
 * 其它平台返回空列表且没有错误。原生失败时保留「异常类: message」级别的可读原因。
 */
export async function readLanNetworks(): Promise<LanNetworkListResult> {
  if (listOverride !== null) {
    try {
      return { ...parseLanNetworkResult(await listOverride()), error: null };
    } catch (cause: unknown) {
      const message = errorMessage(cause, '读取本机网络失败');
      logWarn('lan-sync', '读取本机网络失败', { message, raw: String(cause) });
      return { networks: [], status: null, error: message };
    }
  }
  try {
    if (isDesktopApp()) {
      return {
        ...parseLanNetworkResult(await invokeNative<unknown>('lan_network_list')),
        error: null,
      };
    }
    if (isAndroidApp()) {
      const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
      if (plugin === null) {
        return { networks: [], status: null, error: '没有可用的局域网插件，请重新安装应用' };
      }
      return { ...parseLanNetworkResult(await plugin.networks()), error: null };
    }
  } catch (cause: unknown) {
    const message = errorMessage(cause, '读取本机网络失败');
    logWarn('lan-sync', '读取本机网络失败', { message, raw: String(cause) });
    return { networks: [], status: null, error: message };
  }
  return { networks: [], status: null, error: null };
}

/**
 * 列本机候选网络：失败时返回空列表，界面退回「自动选择」。
 * 需要把失败原因展示给用户时用 `readLanNetworks()`。
 */
export async function listLanNetworks(): Promise<LanNetwork[]> {
  return (await readLanNetworks()).networks;
}
