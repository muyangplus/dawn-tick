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
  LAN_RECONNECT_INTERVAL_MS,
  applyLanPairProbes,
  createLanPairingStore,
  formatLanPairingLabel,
  formatLanPairingLastSync,
  lanPairingStatusText,
  markLanPairingSynced,
  pairingSession,
  probeLanPairing,
  reduceLanPairingStatuses,
  removeLanPairing,
  updateLanPairingToken,
  type LanPairing,
  type LanPairingStatuses,
} from '../../lan-pairings.ts';

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
}

const ALL_SCOPES: readonly LanScope[] = LAN_SCOPES;

/**
 * 「已配对设备」列表：名称、地址、在线状态、上次同步时间、立即同步与移除。
 *
 * 自动重连：
 * - 挂载 / 列表变化 / 浏览器 `online` 事件 / 每 30 秒各探测一次 `POST /pair/refresh`；
 * - 在线时换新令牌并顺延 180 天；离线只显示「离线，仍在重试」，不删除配对；
 * - 服务端返回 401 显示「配对已失效」，用户可移除后重新配对。
 */
export function LanSyncDevicesPanel({
  storage,
  revision,
  onSettingsReplaced,
  onChanged,
  onNote,
  onTokenRefreshed,
}: LanSyncDevicesPanelProps) {
  const store = useMemo(() => createLanPairingStore(storage), [storage]);
  const [pairings, setPairings] = useState<LanPairing[]>([]);
  const [statuses, setStatuses] = useState<LanPairingStatuses>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const pairingsRef = useRef<LanPairing[]>([]);
  const probing = useRef(false);
  const refreshedRef = useRef(onTokenRefreshed);

  useEffect(() => {
    refreshedRef.current = onTokenRefreshed;
  }, [onTokenRefreshed]);

  useEffect(() => {
    pairingsRef.current = pairings;
  }, [pairings]);

  // 挂载 / 新配对 / 在线事件 / 每 30 秒：探测全部已配对设备
  useEffect(() => {
    let cancelled = false;
    const probeAll = async (list: readonly LanPairing[]): Promise<void> => {
      if (cancelled || list.length === 0 || probing.current) return;
      probing.current = true;
      try {
        const probes = await Promise.all(list.map((pairing) => probeLanPairing(pairing)));
        if (cancelled) return;
        const now = Date.now();
        setStatuses((current) => reduceLanPairingStatuses(current, probes, now));
        for (const probe of probes) {
          if (probe.state === 'online' && probe.token !== undefined) {
            refreshedRef.current(probe.id, probe.token, probe.expiresAt ?? 0);
          }
        }
        const updated = applyLanPairProbes(list, probes);
        const tokenChanged = updated.some((item, index) => item.token !== list[index]?.token);
        if (tokenChanged) {
          setPairings(updated);
          await store.save(updated);
        }
      } finally {
        probing.current = false;
      }
    };
    void (async () => {
      const list = await store.load();
      if (cancelled) return;
      setPairings(list);
      pairingsRef.current = list;
      await probeAll(list);
    })();
    const onOnline = (): void => {
      void probeAll(pairingsRef.current);
    };
    const timer = window.setInterval(() => {
      void probeAll(pairingsRef.current);
    }, LAN_RECONNECT_INTERVAL_MS);
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [store, revision]);

  async function syncNow(pairing: LanPairing): Promise<void> {
    setBusyId(pairing.id);
    try {
      const probe = await probeLanPairing(pairing);
      setStatuses((current) => reduceLanPairingStatuses(current, [probe]));
      if (probe.state !== 'online') {
        onNote(`立即同步失败：${pairing.name} ${probe.error ?? '网络不可达'}`);
        return;
      }
      const token = probe.token ?? pairing.token;
      refreshedRef.current(pairing.id, token, probe.expiresAt ?? 0);
      const session = { ...pairingSession(pairing), token };
      if (sessionExpired(session)) {
        onNote('配对已过期，请移除后重新配对');
        return;
      }
      const result = await pullFromPeer(storage, session, ALL_SCOPES);
      if (!result.ok) {
        onNote(`立即同步失败：${result.error ?? '未知原因'}`);
        return;
      }
      const withToken = updateLanPairingToken(pairingsRef.current, pairing.id, token);
      const updated = markLanPairingSynced(withToken, pairing.id);
      setPairings(updated);
      pairingsRef.current = updated;
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
      setPairings(updated);
      pairingsRef.current = updated;
      await store.save(updated);
      setStatuses((current) => {
        const next = { ...current };
        delete next[pairing.id];
        return next;
      });
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
            return (
              <div
                key={pairing.id}
                className="flex flex-col gap-1 rounded-md border border-line p-2"
                data-role="lan-paired-item"
              >
                <span className="text-sm text-ink">{formatLanPairingLabel(pairing)}</span>
                <span className="text-xs text-muted" data-role="lan-paired-state">
                  {lanPairingStatusText(status)}
                </span>
                <span className="text-xs text-muted">{formatLanPairingLastSync(pairing)}</span>
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
