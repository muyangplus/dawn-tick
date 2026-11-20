import { useEffect, useMemo, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { useAction } from '../../lib/action.ts';
import { isAndroidApp } from '../../lib/capabilities.ts';
import { getOrCreateLanDeviceId } from '../../lib/lan-device-id.ts';
import type { ScannedPairRequest } from '../../lib/scan.ts';
import { logDebug, logWarn } from '../../log.ts';
import { copyText } from '../../system-actions.ts';
import {
  LAN_SERVER_START_HINT,
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
  formatLanNetworkDiagnostics,
  readLanNetworks,
  readStoredLanHost,
  resolveLanHost,
  saveStoredLanHost,
  type LanNetwork,
  type LanNetworkStatus,
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
import { lanSyncPanelCopy as copy } from '../../copy/sync-lan-panel.ts';
import { HelpLink } from '../../components/help-link.tsx';

export interface LanSyncBlockProps {
  storage: Storage;
  /** 拉取到设置范围后热加载设置 */
  onSettingsReplaced: () => Promise<void>;
  /** 拉取写入了业务数据后刷新界面 */
  onChanged: () => void;
  /** 通用扫一扫交来的配对请求：自动填入并只消费一次 */
  pendingPair?: ScannedPairRequest | null;
  onPendingPairHandled?: (() => void) | undefined;
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
export function LanSyncBlock({
  storage,
  onSettingsReplaced,
  onChanged,
  pendingPair = null,
  onPendingPairHandled,
}: LanSyncBlockProps) {
  const action = useAction();
  const [server, setServer] = useState<LanServerInfo | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [tokens, setTokens] = useState<readonly TrustedToken[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  /** 本机候选网络与选中地址：多网卡 / VPN 时让用户切到真正的局域网。 */
  const [networks, setNetworks] = useState<LanNetwork[]>([]);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  /** 原生报告的当前网络状态：空态文案按 Wi-Fi / 有线 / 移动数据区分原因。 */
  const [networkStatus, setNetworkStatus] = useState<LanNetworkStatus | null>(null);
  /** 读取网络失败的可读原因；Android 上仍显示网络行并允许重试 */
  const [networkError, setNetworkError] = useState<string | null>(null);
  /** 服务端内存态：轮询回调里读，不触发重渲染 */
  const runtime = useRef<LanRuntime>({ pairing: null, tokens: [] });
  const started = useRef(false);
  const savedTokens = useRef<readonly TrustedToken[]>([]);
  const deviceName = useMemo(() => defaultDeviceName(), []);
  /** 本机稳定设备 id：二维码 / 复制信息带它；监听时也由 `startLanServer` 取同一份 */
  const deviceId = useMemo(() => getOrCreateLanDeviceId(), []);

  /** 读候选网络：Android 失败时把可读原因留在网络行，不静默当成「没有网络」。 */
  const refreshNetworks = async (): Promise<void> => {
    const result = await readLanNetworks();
    setNetworks(result.networks);
    setNetworkStatus(result.status);
    setNetworkError(result.error);
    setSelectedHost((current) => resolveLanHost(result.networks, current ?? readStoredLanHost()));
    if (result.error !== null) {
      logDebug('sync', '本机网络读取失败', { message: result.error });
      setStatus(said(copy.networkReadFailed(result.error)));
    }
  };

  // 进来先读候选网络：默认选首选局域网，用户上次选过的地址优先
  useEffect(() => {
    if (!canServeLanSync()) return;
    let cancelled = false;
    void (async () => {
      const result = await readLanNetworks();
      if (cancelled) return;
      setNetworks(result.networks);
      setNetworkStatus(result.status);
      setNetworkError(result.error);
      setSelectedHost(resolveLanHost(result.networks, readStoredLanHost()));
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
        logWarn('sync', '局域网请求处理失败', { message: errorMessage(cause) });
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), LAN_SYNC_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [server, storage]);

  async function startPairing(hostOverride?: string): Promise<void> {
    const host = hostOverride ?? selectedNetwork?.address;
    await action.run({
      scope: 'sync',
      label: copy.starting,
      fail: false,
      task: async () => {
        const result = await startLanServer(host === undefined ? {} : { host });
        if (!result.ok || result.info === null) {
          const message = result.error ?? copy.startFailedFallback;
          const shown = copy.startFailedWithHint(message, LAN_SERVER_START_HINT);
          setStartFailed(true);
          setStatus(said(shown));
          toast.error(shown);
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
        const message = copy.started(result.info.address, result.info.code);
        setStatus(said(message));
        toast.success(copy.startedToast);
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
    setStatus(said(copy.stopped));
  }

  /** 生成新的配对码：服务端继续监听，已配对的长期令牌不受影响。 */
  function newPairingCode(): void {
    const next = createPairing();
    runtime.current = { ...runtime.current, pairing: next };
    setPairing(next);
    setStartFailed(false);
    setStatus(said(copy.newCodeIssued(next.code)));
  }

  /** 切换网络：记住地址；已开配对时自动停掉并用新地址重启监听。 */
  async function changeNetwork(address: string): Promise<void> {
    const network = networks.find((item) => item.address === address) ?? null;
    if (network === null || address === selectedNetwork?.address) return;
    setSelectedHost(address);
    saveStoredLanHost(address);
    if (server !== null) {
      // 先停旧监听再按新地址重启：广播与展示地址都跟着换
      await stopPairing();
      const message = copy.networkSwitchedRestarting(network.address);
      setStatus(said(message));
      await startPairing(network.address);
      return;
    }
    setStatus(said(copy.networkSwitched(network.address)));
  }

  /** 复制标准配对链接：对方粘贴后由同一套解析器识别。 */
  async function copyPairing(): Promise<void> {
    if (server === null || pairing === null) return;
    const payload: PairPayload = {
      host: server.host,
      port: server.port,
      code: pairing.code,
    };
    const ok = await copyText(formatPairPayload({ ...payload, name: deviceName, deviceId }));
    if (ok) toast.success(copy.pairingCopied);
    else toast.error(copy.pairingCopyFailed);
  }

  /** 复制网络诊断：网卡 / 状态 / 读取错误，不含配对码或令牌。 */
  async function copyNetworkDiagnostics(): Promise<void> {
    const text = formatLanNetworkDiagnostics({
      networks,
      status: networkStatus,
      error: networkError,
    });
    const ok = await copyText(text);
    if (ok) toast.success(copy.diagnosticsCopied);
    else toast.error(copy.diagnosticsCopyFailed);
  }

  return (
    <div className="flex flex-col gap-1" data-role="lan-sync">
      <span className="text-sm font-medium text-ink" data-role="lan-sync-title">
        {copy.title}
      </span>
      <HelpLink entryId="lan-pair" />
      {canServeLanSync() ? (
        <LanSyncServerPanel
          server={server}
          pairing={pairing}
          tokens={tokens}
          networks={networks}
          selectedHost={selectedHost}
          alwaysShowNetwork={isAndroidApp()}
          networkStatus={networkStatus}
          networkError={networkError}
          failed={startFailed}
          busy={action.busy}
          deviceName={deviceName}
          deviceId={deviceId}
          onStart={() => void startPairing()}
          onStop={() => void stopPairing()}
          onNewCode={newPairingCode}
          onChangeNetwork={(address) => void changeNetwork(address)}
          onRefreshNetworks={() => void refreshNetworks()}
          onCopyDiagnostics={() => void copyNetworkDiagnostics()}
          onCopy={() => void copyPairing()}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="text-xs text-muted" data-role="lan-sync-server-hint">
            {copy.browserClientOnly}
          </span>
          <HelpLink entryId="lan-web" />
        </div>
      )}
      <LanSyncClientPanel
        storage={storage}
        self={server === null ? null : { host: server.host, port: server.port }}
        onSettingsReplaced={onSettingsReplaced}
        onChanged={onChanged}
        pendingPair={pendingPair}
        onPendingPairHandled={onPendingPairHandled}
      />
      {status !== null && (
        <StatusLine dataRole="lan-sync-status" at={status.at}>
          {status.text}
        </StatusLine>
      )}
    </div>
  );
}
