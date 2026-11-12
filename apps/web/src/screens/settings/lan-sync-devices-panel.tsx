import { useEffect, useMemo, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { LAN_SCOPES, type LanScope } from '../../lan-sync-protocol.ts';
import {
  pullFromPeer,
  revokePairing,
  sessionExpired,
} from '../../lan-sync-client.ts';
import {
  formatLanPairingLabel,
  formatLanPairingLastSeen,
  formatLanPairingLastSync,
  markLanPairingSynced,
  pairingSession,
  removeLanPairing,
  updateLanPairingToken,
  type LanPairing,
} from '../../lan-pairings.ts';
import { createLanPairingStore } from '../../lan-sync-pairing-store.ts';
import {
  LAN_RECONNECT_TICK_MS,
  applyLanPairProbes,
  discoverPairingAddresses,
  formatLanPairingRetry,
  lanPairingStatusText,
  markLanDiscoveryAttempted,
  probeLanPairing,
  reduceLanPairingStatuses,
  shouldProbePairing,
  type LanPairingStatuses,
} from '../../lan-sync-reconnect.ts';

export interface LanSyncDevicesPanelProps {
  storage: Storage;
  /** 新增配对后递增：重新读取列表并立刻探测 */
  revision: number;
  onSettingsReplaced: () => Promise<void>;
  onChanged: () => void;
  /** 状态行 / toast 文案由父组件统一展示 */
  onNote: (text: string) => void;
  /** 探测换新令牌后同步给父组件的当前会话，避免拉取/推送用到旧令牌 */
  onTokenRefreshed: (id: string, token: string, expiresAt: number) => void;
  /** 离线设备的「重新配对」：父组件把地址填进配对面板并清空旧配对码 */
  onRepair: (pairing: LanPairing) => void;
}

const ALL_SCOPES: readonly LanScope[] = LAN_SCOPES;

function pairingFingerprint(pairings: readonly LanPairing[]): string {
  return JSON.stringify(
    pairings.map((item) => [
      item.id,
      item.deviceId,
      item.name,
      item.discoveryName,
      item.host,
      item.port,
      item.token,
      item.lastSeen,
      item.lastSyncAt,
    ]),
  );
}

/**
 * 「已配对设备」列表：名称、地址、在线状态、上次同步 / 最近在线、立即同步、
 * 重新配对与移除。
 *
 * 自动重连（`lan-sync-reconnect.ts`）：
 * - 挂载 / 列表变化 / 浏览器 `online` 事件立即探测；之后每 15 秒只检查「谁到点」；
 * - 在线 → 换新令牌、刷新 `lastSeen`；离线 → 30s 起指数退避（上限 5 分钟），
 *   顺带扫 UDP 发现，按设备名找到新端口就原地覆盖地址并立即重试；
 * - 401 → 「配对已失效」，停止自动重试，用户可重新配对或移除。
 */
export function LanSyncDevicesPanel({
  storage,
  revision,
  onSettingsReplaced,
  onChanged,
  onNote,
  onTokenRefreshed,
  onRepair,
}: LanSyncDevicesPanelProps) {
  const store = useMemo(() => createLanPairingStore(storage), [storage]);
  const [pairings, setPairings] = useState<LanPairing[]>([]);
  const [statuses, setStatuses] = useState<LanPairingStatuses>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const pairingsRef = useRef<LanPairing[]>([]);
  const statusesRef = useRef<LanPairingStatuses>({});
  const probing = useRef(false);
  const refreshedRef = useRef(onTokenRefreshed);

  useEffect(() => {
    refreshedRef.current = onTokenRefreshed;
  }, [onTokenRefreshed]);

  useEffect(() => {
    pairingsRef.current = pairings;
  }, [pairings]);

  function commitPairings(next: LanPairing[]): void {
    pairingsRef.current = next;
    setPairings(next);
  }

  function commitStatuses(next: LanPairingStatuses): void {
    statusesRef.current = next;
    setStatuses(next);
  }

  // 挂载 / 新配对 / 在线事件 / 每 15 秒：只探测到点记录；离线自动找新端口
  useEffect(() => {
    let cancelled = false;

    const runProbes = async (force: boolean): Promise<void> => {
      if (cancelled || probing.current) return;
      const list = pairingsRef.current;
      const now = Date.now();
      const due = force
        ? list.filter((pairing) => statusesRef.current[pairing.id]?.state !== 'expired')
        : list.filter((pairing) => shouldProbePairing(statusesRef.current[pairing.id], now));
      if (due.length === 0) return;
      probing.current = true;
      try {
        const probes = await Promise.all(due.map((pairing) => probeLanPairing(pairing)));
        if (cancelled) return;
        const finalProbes = [...probes];
        let updated = list;
        const offlineIds = due
          .filter((_, index) => probes[index]?.state === 'offline')
          .map((pairing) => pairing.id);
        const offline = due.filter((pairing) => offlineIds.includes(pairing.id));
        if (offline.length > 0) {
          // 端口可能已经变了：按设备名扫 UDP，找到新地址就原地覆盖并立刻重试
          const discovery = await discoverPairingAddresses(updated, offline, Date.now());
          if (cancelled) return;
          updated = discovery.pairings;
          if (discovery.updated.length > 0) {
            const reprobes = await Promise.all(
              discovery.updated.map((pairing) => probeLanPairing(pairing)),
            );
            if (cancelled) return;
            for (const reprobe of reprobes) {
              const index = finalProbes.findIndex((item) => item.id === reprobe.id);
              if (index >= 0) finalProbes[index] = reprobe;
            }
          }
        }
        if (cancelled) return;
        const stamp = Date.now();
        commitStatuses(
          markLanDiscoveryAttempted(
            reduceLanPairingStatuses(statusesRef.current, finalProbes, stamp),
            offlineIds,
            stamp,
          ),
        );
        for (const probe of finalProbes) {
          if (probe.state === 'online' && probe.token !== undefined) {
            refreshedRef.current(probe.id, probe.token, probe.expiresAt ?? 0);
          }
        }
        const applied = applyLanPairProbes(updated, finalProbes, stamp);
        if (pairingFingerprint(applied) !== pairingFingerprint(list)) {
          commitPairings(applied);
          await store.save(applied);
        }
      } finally {
        probing.current = false;
      }
    };

    void (async () => {
      const list = await store.load();
      if (cancelled) return;
      commitPairings(list);
      await runProbes(true);
    })();
    const onOnline = (): void => {
      void runProbes(true);
    };
    const timer = window.setInterval(() => {
      void runProbes(false);
    }, LAN_RECONNECT_TICK_MS);
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [store, revision]);

  /** 手动同步失败后先找一次新端口，找到就原地更新记录并返回新地址。 */
  async function reconnectViaDiscovery(pairing: LanPairing): Promise<LanPairing | null> {
    const result = await discoverPairingAddresses(pairingsRef.current, [pairing], Date.now());
    if (result.updated.length === 0) return null;
    commitPairings(result.pairings);
    await store.save(result.pairings);
    return result.updated[0] ?? null;
  }

  async function syncNow(pairing: LanPairing): Promise<void> {
    setBusyId(pairing.id);
    try {
      let target = pairing;
      let probe = await probeLanPairing(target);
      if (probe.state === 'offline') {
        const discovered = await reconnectViaDiscovery(target);
        if (discovered !== null) {
          target = discovered;
          probe = await probeLanPairing(target);
        }
      }
      commitStatuses(reduceLanPairingStatuses(statusesRef.current, [probe]));
      if (probe.state !== 'online') {
        onNote(`立即同步失败：${pairing.name} ${probe.error ?? '网络不可达'}`);
        return;
      }
      const token = probe.token ?? target.token;
      refreshedRef.current(target.id, token, probe.expiresAt ?? 0);
      const session = { ...pairingSession(target), token };
      if (sessionExpired(session)) {
        onNote('配对已过期，请移除后重新配对');
        return;
      }
      const result = await pullFromPeer(storage, session, ALL_SCOPES);
      if (!result.ok) {
        onNote(`立即同步失败：${result.error ?? '未知原因'}`);
        return;
      }
      const withToken = updateLanPairingToken(pairingsRef.current, target.id, token);
      const updated = markLanPairingSynced(withToken, target.id);
      commitPairings(updated);
      await store.save(updated);
      onNote(`已与 ${pairing.name} 同步：写入 ${result.imported} 条，跳过 ${result.skipped} 条`);
      await onSettingsReplaced();
      if (result.imported > 0) onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(pairing: LanPairing): Promise<void> {
    setBusyId(pairing.id);
    try {
      const revoked = await revokePairing(pairingSession(pairing));
      const updated = removeLanPairing(pairingsRef.current, pairing.id);
      commitPairings(updated);
      await store.save(updated);
      const next = { ...statusesRef.current };
      delete next[pairing.id];
      commitStatuses(next);
      onNote(
        revoked.ok
          ? `已移除配对：${pairing.name}`
          : `已在本机移除 ${pairing.name}；对方未响应，可能仍保留授权`,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-role="lan-paired">
      <span className="text-xs font-medium text-muted">已配对设备</span>
      {pairings.length === 0 ? (
        <span className="text-xs text-muted" data-role="lan-paired-empty">
          还没有已配对设备：配对成功后会自动保存，重启或断网后自动重连，不需要重新输配对码。
        </span>
      ) : (
        <div className="flex flex-col gap-2" data-role="lan-paired-list">
          {pairings.map((pairing) => {
            const status = statuses[pairing.id];
            const offline = status?.state === 'offline' || status?.state === 'expired';
            return (
              <div
                key={pairing.id}
                className="flex flex-col gap-1 rounded-md border border-line p-2"
                data-role="lan-paired-item"
                data-state={status?.state ?? 'unknown'}
              >
                <span className="text-sm text-ink">{formatLanPairingLabel(pairing)}</span>
                <span className="text-xs text-muted" data-role="lan-paired-state">
                  {lanPairingStatusText(status)}
                </span>
                <span className="text-xs text-muted" data-role="lan-paired-last-sync">
                  {formatLanPairingLastSync(pairing)}
                </span>
                <span className="text-xs text-muted" data-role="lan-paired-last-seen">
                  {formatLanPairingLastSeen(pairing)}
                </span>
                {status?.state === 'offline' && (
                  <span className="text-xs text-muted" data-role="lan-paired-retry">
                    {formatLanPairingRetry(status)}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`立即同步 ${pairing.name}`}
                    loading={busyId === pairing.id}
                    disabled={busyId !== null}
                    onClick={() => void syncNow(pairing)}
                  >
                    立即同步
                  </Button>
                  {offline && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`重新配对 ${pairing.name}`}
                      disabled={busyId !== null}
                      onClick={() => onRepair(pairing)}
                    >
                      重新配对
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`移除配对 ${pairing.name}`}
                    disabled={busyId !== null}
                    onClick={() => void remove(pairing)}
                  >
                    移除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <span className="text-xs text-muted">
        配对设备可长期访问本机同步接口（180 天），可随时在列表里移除。
      </span>
    </div>
  );
}
