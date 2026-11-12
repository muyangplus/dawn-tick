import type { Storage } from '@dawn-tick/core';
import { isWebApp } from './lib/capabilities.ts';
import { normalizeLanDeviceId } from './lib/lan-device-id.ts';
import { readMetaJson, writeMetaJson } from './lib/meta.ts';
import { LAN_PAIRINGS_META_KEY } from './lib/meta-keys.ts';
import { logWarn } from './log.ts';
import type { LanSession } from './lan-sync-client.ts';
import { scanLanPeers } from './lan-sync-discovery.ts';
import {
  createLanPairing,
  findLanPairingByPeer,
  markLanPairingDiscoveryName,
  markLanPairingSynced,
  parseLanPairings,
  parseLanPairingsJson,
  serializeLanPairings,
  upsertLanPairing,
  type LanPairing,
} from './lan-pairings.ts';

/**
 * 局域网同步：配对记录的持久化出口与「配对成功 / 同步成功」写回。
 *
 * 桌面与安卓写 `app_meta` 键 `lan_pairings_v1`；Web 端优先 localStorage
 *（`dt.lan.pairings.v1`），不可用时退回 `app_meta`。令牌明文只在本机保存，
 * 服务端只存 SHA-256 哈希；这里不碰网络。
 */

/** Web 端 localStorage 键：与 `app_meta` 同语义，只是存储位置不同。 */
export const LAN_PAIRINGS_STORAGE_KEY = 'dt.lan.pairings.v1';

/** localStorage 的最小接口；单测可传内存实现。 */
export interface LanLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
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

/** 配对成功要写回的对端元信息：`name` 来自二维码/发现，`deviceId` 来自二维码或 UDP 广播。 */
export interface RememberLanPairingOptions {
  name?: string | undefined;
  /** 对端稳定设备 id：优先级高于本机扫描结果 */
  deviceId?: string | undefined;
  now?: number | undefined;
}

/**
 * 配对成功：立即写回令牌与对端元信息（同 deviceId / 同地址覆盖，不堆叠旧地址）。
 *
 * 先用 payload / 发现提供的真实 `deviceId` 建记录；都没给时本机生成临时 id，
 * 后续 UDP 发现拿到真实 id 会原地替换。顺带记下广播设备名，换 IP 后靠它兜底。
 */
export async function rememberLanPairing(
  store: LanPairingStore,
  session: LanSession,
  options: RememberLanPairingOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  const displayName = options.name?.trim() ?? '';
  const explicitDeviceId = normalizeLanDeviceId(options.deviceId) ?? undefined;
  // 配对时对方正在广播：顺手记下真实 deviceId 与广播名，换 IP/换局域网后靠它认回同一台
  const peers = await scanLanPeers();
  const found =
    peers.find(
      (peer) => explicitDeviceId !== undefined && peer.deviceId === explicitDeviceId,
    ) ??
    peers.find((peer) => peer.host === session.peer.host && peer.port === session.peer.port) ??
    null;
  const deviceId = explicitDeviceId ?? found?.deviceId;
  const pairing = createLanPairing({
    peer: session.peer,
    token: session.token,
    ...(displayName === '' ? {} : { name: displayName }),
    ...(deviceId === undefined ? {} : { deviceId }),
    now,
  });
  const next = upsertLanPairing(await store.load(), pairing);
  const saved =
    next.find((item) => item.deviceId === pairing.deviceId) ??
    next.find((item) => item.host === session.peer.host && item.port === session.peer.port);
  await store.save(
    saved === undefined || found === null
      ? next
      : markLanPairingDiscoveryName(next, saved.id, found.name),
  );
}

/** 同步成功：按「最近地址」找回记录并回写 `lastSyncAt` / `lastSeen`；未保存返回 false。 */
export async function markLanSessionSynced(
  store: LanPairingStore,
  session: LanSession,
  now = Date.now(),
): Promise<boolean> {
  const existing = await store.load();
  const target = findLanPairingByPeer(existing, session.peer);
  if (target === null) return false;
  await store.save(markLanPairingSynced(existing, target.id, now));
  return true;
}
