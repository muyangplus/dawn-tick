import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { invokeNative } from './lib/native.ts';
import { loadPlugin, type LanSyncPlugin } from './lib/plugins.ts';
import { logWarn } from './log.ts';
import { isLanAddress } from './lan-sync-protocol.ts';

/**
 * 局域网同步二期：UDP 广播自动发现。
 *
 * 边界：
 * - 编解码、去重、过期判定都是纯函数，可直接单测；
 * - 只有原生层（Rust / Kotlin）收发 UDP；Web 端返回空列表并提示手输地址；
 * - 发现包只在「开启配对」期间广播，不含配对码、令牌或任何业务数据；
 * - 协议见 `apps/mobile/docs/lan-sync.contract.md`。
 */

/** 发现包标识；防止把别的 UDP 包当设备。 */
export const LAN_DISCOVERY_KIND = 'dawn-tick-lan-discover';
/** 发现包版本；与同步信封同步升版。 */
export const LAN_DISCOVERY_SCHEMA_VERSION = 1;
/** 广播与扫描共用端口（UDP）。 */
export const LAN_DISCOVERY_PORT = 8766;
/** 扫描窗口：广播间隔 800ms，1.5 秒足够收到一轮。 */
export const LAN_DISCOVERY_TIMEOUT_MS = 1500;
/** 列表里保留多久：超时未再广播就移除。 */
export const LAN_DISCOVERY_TTL_MS = 10_000;
/** 单次扫描最多展示的设备数。 */
export const LAN_DISCOVERY_MAX_PEERS = 32;

export interface LanDiscoveryAnnounce {
  kind: typeof LAN_DISCOVERY_KIND;
  schemaVersion: number;
  name: string;
  host: string;
  port: number;
}

export interface LanDiscoveryPeer {
  name: string;
  host: string;
  port: number;
  /** 本机收到广播的时间；只用于去重与过期，不参与网络包 */
  seenAt: number;
}

/** 设备名 / 地址 / 端口的统一校验；不合法返回 null。 */
export function parseDiscoveryAnnounce(text: string): LanDiscoveryAnnounce | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const packet = parsed as Partial<LanDiscoveryAnnounce>;
  if (packet.kind !== LAN_DISCOVERY_KIND) return null;
  if (packet.schemaVersion !== LAN_DISCOVERY_SCHEMA_VERSION) return null;
  const name = typeof packet.name === 'string' ? packet.name.trim() : '';
  const host = typeof packet.host === 'string' ? packet.host.trim() : '';
  const port = packet.port;
  if (name === '' || name.length > 48) return null;
  if (!isLanAddress(host)) return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { kind: LAN_DISCOVERY_KIND, schemaVersion: LAN_DISCOVERY_SCHEMA_VERSION, name, host, port };
}

/** 生成广播正文；字段顺序固定，便于两端对照与测试。 */
export function encodeDiscoveryAnnounce(announce: Omit<LanDiscoveryAnnounce, 'kind' | 'schemaVersion'>): string {
  const name = announce.name.trim();
  if (name === '' || name.length > 48) throw new Error('设备名应为 1–48 个字符');
  if (!isLanAddress(announce.host)) throw new Error('广播地址必须是局域网地址');
  if (!Number.isInteger(announce.port) || announce.port < 1 || announce.port > 65535) {
    throw new Error('广播端口不合法');
  }
  return JSON.stringify({
    kind: LAN_DISCOVERY_KIND,
    schemaVersion: LAN_DISCOVERY_SCHEMA_VERSION,
    name,
    host: announce.host,
    port: announce.port,
  });
}

/** 同一设备（host:port）只留最后一条；按设备名、地址排序并截断。 */
export function dedupeDiscoveryPeers(
  peers: readonly LanDiscoveryPeer[],
  max = LAN_DISCOVERY_MAX_PEERS,
): LanDiscoveryPeer[] {
  const latest = new Map<string, LanDiscoveryPeer>();
  for (const peer of peers) {
    const key = `${peer.host}:${peer.port}`;
    const previous = latest.get(key);
    if (previous === undefined || peer.seenAt >= previous.seenAt) latest.set(key, peer);
  }
  return [...latest.values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.host.localeCompare(right.host))
    .slice(0, Math.max(0, max));
}

/** 丢掉超过 TTL 的广播结果。 */
export function pruneDiscoveryPeers(
  peers: readonly LanDiscoveryPeer[],
  now: number,
  ttl = LAN_DISCOVERY_TTL_MS,
): LanDiscoveryPeer[] {
  return peers.filter((peer) => now - peer.seenAt <= ttl);
}

/** 广播列表里去掉本机自己（地址与端口都相同）。 */
export function filterDiscoverySelf(
  peers: readonly LanDiscoveryPeer[],
  self: { host: string; port: number } | null,
): LanDiscoveryPeer[] {
  if (self === null) return [...peers];
  return peers.filter((peer) => !(peer.host === self.host && peer.port === self.port));
}

/** 列表一行：设备名 · IP:端口；点击后填地址也用它。 */
export function formatDiscoveryPeer(peer: LanDiscoveryPeer): string {
  return `${peer.name} · ${peer.host}:${peer.port}`;
}

/** 当前平台能不能做发现：只有桌面与安卓有原生 UDP。 */
export function canDiscoverLanPeers(): boolean {
  return scanOverride !== null || isDesktopApp() || isAndroidApp();
}

/** 冒烟专用：用固定列表替代原生 UDP，验证「发现 → 点击填入」链路。 */
type DiscoveryScanner = () => Promise<LanDiscoveryPeer[]>;
let scanOverride: DiscoveryScanner | null = null;

export function setLanDiscoveryScannerForTests(scanner: DiscoveryScanner | null): void {
  scanOverride = scanner;
}

function toPeer(raw: unknown): LanDiscoveryPeer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Partial<LanDiscoveryPeer>;
  if (typeof item.name !== 'string' || typeof item.host !== 'string') return null;
  if (typeof item.port !== 'number' || !Number.isInteger(item.port)) return null;
  if (!isLanAddress(item.host)) return null;
  return { name: item.name, host: item.host, port: item.port, seenAt: Date.now() };
}

/** 扫描一段时间，返回原生层收到的广播；失败只记日志并返回空列表。 */
export async function scanLanPeers(timeoutMs = LAN_DISCOVERY_TIMEOUT_MS): Promise<LanDiscoveryPeer[]> {
  if (scanOverride !== null) {
    try {
      return dedupeDiscoveryPeers(await scanOverride());
    } catch (cause: unknown) {
      logWarn('lan-sync', '扫描局域网设备失败', {
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return [];
    }
  }
  if (!canDiscoverLanPeers()) return [];
  try {
    let raw: unknown[] = [];
    if (isDesktopApp()) {
      const peers = await invokeNative<unknown[]>('lan_discovery_scan', { timeoutMs });
      raw = Array.isArray(peers) ? peers : [];
    } else {
      const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
      const result = await plugin?.scanDiscovery({ timeoutMs });
      raw = Array.isArray(result?.peers) ? (result.peers as unknown[]) : [];
    }
    const now = Date.now();
    return dedupeDiscoveryPeers(
      raw
        .map(toPeer)
        .filter((peer): peer is LanDiscoveryPeer => peer !== null)
        .map((peer) => ({ ...peer, seenAt: now })),
    );
  } catch (cause: unknown) {
    logWarn('lan-sync', '扫描局域网设备失败', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return [];
  }
}
