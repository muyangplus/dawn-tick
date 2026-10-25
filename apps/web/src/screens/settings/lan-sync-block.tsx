import { useEffect, useMemo, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { useAction } from '../../lib/action.ts';
import { logWarn } from '../../log.ts';
import { copyText } from '../../system-actions.ts';
import {
  LAN_SYNC_POLL_INTERVAL_MS,
  applyLanReply,
  canServeLanSync,
  defaultDeviceName,
  handleLanRequest,
  lanServerContext,
  pollLanServer,
  respondLanServer,
  startLanServer,
  stopLanServer,
  type LanRuntime,
  type LanServerInfo,
} from '../../lan-sync.ts';
import {
  formatPairPayload,
  type PairPayload,
} from '../../lan-pair-payload.ts';
import {
  defaultLanNetwork,
  listLanNetworks,
  readStoredLanHost,
  resolveLanHost,
  saveStoredLanHost,
  type LanNetwork,
} from '../../lan-sync-network.ts';
import {
  createPairing,
  pruneTrustedTokens,
  type Pairing,
  type TrustedToken,
} from '../../lan-sync-protocol.ts';
import { loadTrustedTokens, sameTrustedTokens, saveTrustedTokens } from '../../lan-trust-store.ts';
import { LanSyncClientPanel } from './lan-sync-client-panel.tsx';
import { LanSyncServerPanel } from './lan-sync-server-panel.tsx';
import { said } from './format.ts';

export interface LanSyncBlockProps {
  storage: Storage;
  /** 拉取到设置范围后热加载设置 */
  onSettingsReplaced: () => Promise<void>;
  /** 拉取写入了业务数据后刷新界面 */
  onChanged: () => void;
}

/**
 * 局域网同步块（I-14 二期 + 标准化配对/持久化）：本机开配对 + 二维码 / 发现设备 /
 * 预览后拉取 / 自动同步 / 已配对设备与自动重连。
 *
 * 边界：
 * - 服务端（开配对 + 轮询原生队列 + UDP 广播）只在桌面与安卓显示；浏览器只做发起方；
 * - 原生层绑定通配地址，对外展示/广播的是选中网卡地址；轮询到的请求交给
 *   `handleLanRequest`（协议层纯函数）处理，本组件只管状态与呈现；
 * - 可信令牌只把 SHA-256 哈希写入 `app_meta`（`lan_trusted_tokens_v1`），
 *   客户端配对记录在 `lan-pairings.ts` 持久化。
 */
export function LanSyncBlock({ storage, onSettingsReplaced, onChanged }: LanSyncBlockProps) {
  const action = useAction();
  const [server, setServer] = useState<LanServerInfo | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [tokens, setTokens] = useState<readonly TrustedToken[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  /** 本机候选网络与选中地址：多网卡 / VPN 时让用户切到真正的局域网。 */
  const [networks, setNetworks] = useState<LanNetwork[]>([]);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  /** 服务端内存态：轮询回调里读，不触发重渲染 */
  const runtime = useRef<LanRuntime>({ pairing: null, tokens: [] });
  const started = useRef(false);
  const savedTokens = useRef<readonly TrustedToken[]>([]);
  const deviceName = useMemo(() => defaultDeviceName(), []);

  // 进来先读候选网络：默认选首选局域网，用户上次选过的地址优先
  useEffect(() => {
    if (!canServeLanSync()) return;
    let cancelled = false;
    void (async () => {
      const list = await listLanNetworks();
      if (cancelled) return;
      setNetworks(list);
      setSelectedHost(resolveLanHost(list, readStoredLanHost()));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNetwork: LanNetwork | null =
    networks.find((network) => selectedHost !== null && network.address === selectedHost) ??
    defaultLanNetwork(networks);

  // 离开本页即停止配对：监听与内存令牌都不留在后台（持久化令牌仍在 app_meta）
  useEffect(() => {
    return () => {
      if (!started.current) return;
      started.current = false;
      void stopLanServer();
    };
  }, []);

  // 服务端轮询：原生队列 → 协议层处理 → 回写响应 → 需要时落盘令牌哈希
  useEffect(() => {
    if (server === null) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async (): Promise<void> => {
      try {
        const request = await pollLanServer();
        if (request !== null) {
          const reply = await handleLanRequest(lanServerContext(storage, runtime.current), request);
          runtime.current = applyLanReply(runtime.current, reply);
          setPairing(runtime.current.pairing);
          setTokens(runtime.current.tokens);
          if (reply.tokens !== undefined && !sameTrustedTokens(reply.tokens, savedTokens.current)) {
            savedTokens.current = reply.tokens;
            await saveTrustedTokens(storage, reply.tokens);
          }
          await respondLanServer(request.id, reply.status, reply.body);
        }
      } catch (cause: unknown) {
        logWarn('lan-sync', '处理局域网请求失败', { message: errorMessage(cause) });
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), LAN_SYNC_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [server, storage]);

  async function startPairing(): Promise<void> {
    await action.run({
      scope: 'lan-sync',
      label: '正在开启局域网配对…',
      fail: false,
      task: async () => {
        const result = await startLanServer({ host: selectedNetwork?.address });
        if (!result.ok || result.info === null) {
          const message = result.error ?? '开启配对失败：请确认本机已连上 Wi-Fi 或有线网络';
          setStartFailed(true);
          setStatus(said(message));
          toast.error(message);
          return;
        }
        // 服务端启动时加载已持久化的可信令牌（只含哈希）
        const stored = await loadTrustedTokens(storage);
        const active = pruneTrustedTokens(stored);
        if (active.length !== stored.length) await saveTrustedTokens(storage, active);
        savedTokens.current = active;
        started.current = true;
        setStartFailed(false);
        // 切到自动选择时，把原生实际绑定的地址记下来，界面与下拉保持一致
        setSelectedHost(result.info.host);
        if (selectedNetwork === null) saveStoredLanHost(result.info.host);
        runtime.current = {
          pairing: { code: result.info.code, expiresAt: result.info.expiresAt },
          tokens: active,
        };
        setServer(result.info);
        setPairing(runtime.current.pairing);
        setTokens(active);
        const message = `已开启配对：${result.info.address}，配对码 ${result.info.code}（5 分钟内有效）`;
        setStatus(said(message));
        toast.success('已开启局域网配对');
      },
    });
  }

  async function stopPairing(): Promise<void> {
    await stopLanServer();
    started.current = false;
    savedTokens.current = [];
    runtime.current = { pairing: null, tokens: [] };
    setServer(null);
    setPairing(null);
    setTokens([]);
    setStartFailed(false);
    setStatus(said('已停止局域网配对'));
  }

  /** 生成新的配对码：服务端继续监听，已配对的长期令牌不受影响。 */
  function newPairingCode(): void {
    const next = createPairing();
    runtime.current = { ...runtime.current, pairing: next };
    setPairing(next);
    setStartFailed(false);
    setStatus(said(`已生成新配对码 ${next.code}（5 分钟内有效）`));
  }

  /** 切换网络：记住地址；已开配对时先停掉，提示用户用新地址重新开启。 */
  async function changeNetwork(address: string): Promise<void> {
    const network = networks.find((item) => item.address === address) ?? null;
    if (network === null || address === selectedNetwork?.address) return;
    setSelectedHost(address);
    saveStoredLanHost(address);
    if (server !== null) {
      await stopPairing();
      const message = `已切换网络：${network.address}；监听地址已变化，请重新开启配对`;
      setStatus(said(message));
      toast.success('已切换网络，请重新开启配对');
      return;
    }
    setStatus(said(`已切换网络：${network.address}`));
  }

  /** 复制标准配对链接：对方粘贴后由同一套解析器识别。 */
  async function copyPairing(): Promise<void> {
    if (server === null || pairing === null) return;
    const payload: PairPayload = {
      host: server.host,
      port: server.port,
      code: pairing.code,
    };
    const ok = await copyText(formatPairPayload({ ...payload, name: deviceName }));
    if (ok) toast.success('已复制配对信息');
    else toast.error('复制失败，请手动抄写地址与配对码');
  }

  return (
    <div className="flex flex-col gap-1" data-role="lan-sync">
      <span className="text-sm font-medium text-ink" data-role="lan-sync-title">
        局域网同步
      </span>
      <span className="text-xs text-muted">
        同一局域网内直接互传课表、待办与设置：一端开配对，另一端扫码或填地址与配对码。
      </span>
      {canServeLanSync() ? (
        <LanSyncServerPanel
          server={server}
          pairing={pairing}
          tokens={tokens}
          networks={networks}
          selectedHost={selectedHost}
          failed={startFailed}
          busy={action.busy}
          deviceName={deviceName}
          onStart={() => void startPairing()}
          onStop={() => void stopPairing()}
          onNewCode={newPairingCode}
          onChangeNetwork={(address) => void changeNetwork(address)}
          onCopy={() => void copyPairing()}
        />
      ) : (
        <span className="text-xs text-muted" data-role="lan-sync-server-hint">
          浏览器端只作为发起方：请先在桌面版或安卓版上开启配对，再在这里填对方地址。
        </span>
      )}
      <LanSyncClientPanel
        storage={storage}
        self={server === null ? null : { host: server.host, port: server.port }}
        onSettingsReplaced={onSettingsReplaced}
        onChanged={onChanged}
      />
      {status !== null && (
        <StatusLine dataRole="lan-sync-status" at={status.at}>
          {status.text}
        </StatusLine>
      )}
    </div>
  );
}
