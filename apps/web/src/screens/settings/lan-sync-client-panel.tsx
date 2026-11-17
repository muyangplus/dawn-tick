import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { fail } from '../../copy/zh.ts';
import { useAction } from '../../lib/action.ts';
import {
  LAN_CLIENT_IDLE, LAN_SCOPES, LAN_SCOPE_LABEL, checkPeerReachable, defaultDeviceName,
  formatPeerAddress, pairWithPeer, parsePeerAddress, pushToPeer, reduceLanClient,
  sessionExpired, type LanScope, type LanSession,
} from '../../lan-sync.ts';
import type { ScannedPairRequest } from '../../lib/scan.ts';
import {
  dedupeDiscoveryPeers, filterDiscoverySelf, scanLanPeers, type LanDiscoveryPeer,
} from '../../lan-sync-discovery.ts';
import { loadAutoConfig, saveAutoConfig, type LanAutoConfig, type LanAutoMode } from '../../lan-sync-auto.ts';
import { applyLanPreview, previewPullFromPeer, type LanPreviewResult } from '../../lan-sync-preview.ts';
import {
  createLanPairingStore,
  markLanSessionSynced,
  rememberLanPairing,
} from '../../lan-sync-pairing-store.ts';
import { LanAutoPanel } from './lan-sync-auto-panel.tsx';
import { LanDiscoveryPanel } from './lan-sync-discovery-panel.tsx';
import { LanSyncDevicesPanel } from './lan-sync-devices-panel.tsx';
import { LanSyncPairPanel } from './lan-sync-pair-panel.tsx';
import { LanPreviewPanel, lanPreviewText } from './lan-sync-preview-panel.tsx';
import { useLanAutoSync } from './use-lan-auto-sync.ts';
import { said } from './format.ts';

export interface LanSyncClientPanelProps {
  storage: Storage;
  /** 本机服务端地址：发现列表里过滤自己；没开配对时为 null */
  self: { host: string; port: number } | null;
  onSettingsReplaced: () => Promise<void>;
  onChanged: () => void;
  /** 通用扫一扫交来的配对请求：自动填入并只消费一次 */
  pendingPair?: ScannedPairRequest | null;
  onPendingPairHandled?: (() => void) | undefined;
}

/**
 * 局域网同步发起方：配对 / 发现 / 预览拉取 / 推送 / 自动同步 / 已配对设备与自动重连。
 * 服务端与二维码在父组件；配对记录持久化在 `lan-sync-pairing-store.ts`。
 */
export function LanSyncClientPanel({
  storage,
  self,
  onSettingsReplaced,
  onChanged,
  pendingPair = null,
  onPendingPairHandled,
}: LanSyncClientPanelProps) {
  const action = useAction();
  const [auto, setAuto] = useState<LanAutoConfig>(loadAutoConfig);
  const [peerInput, setPeerInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [scopes, setScopes] = useState<ReadonlySet<LanScope>>(() => new Set(auto.scopes));
  const [client, dispatch] = useReducer(reduceLanClient, LAN_CLIENT_IDLE);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [peers, setPeers] = useState<LanDiscoveryPeer[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [preview, setPreview] = useState<{ result: LanPreviewResult; scopes: LanScope[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [pairingsRevision, setPairingsRevision] = useState(0);
  const autoRef = useRef(auto);
  const pairingStore = useMemo(() => createLanPairingStore(storage), [storage]);

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  const note = useCallback((text: string): void => {
    setStatus(said(text));
  }, []);

  const applyAuto = useCallback((next: LanAutoConfig): void => {
    autoRef.current = next;
    setAuto(next);
  }, []);

  const expireSession = useCallback((): void => {
    dispatch({ type: 'expire', now: Date.now() });
  }, []);

  const rememberSynced = useCallback(
    async (session: LanSession): Promise<void> => {
      if (await markLanSessionSynced(pairingStore, session)) {
        setPairingsRevision((value) => value + 1);
      }
    },
    [pairingStore],
  );

  // 后台自动同步：只在已配对且令牌有效时跑；失败静默重试一次，仍失败只记日志
  useLanAutoSync({
    storage,
    session: client.session,
    mode: auto.mode,
    config: auto,
    onConfig: applyAuto,
    onNote: setAutoNote,
    onExpired: expireSession,
    onSynced: rememberSynced,
    onSettingsReplaced,
    onChanged,
  });

  function changeAuto(mode: LanAutoMode): void {
    const next = { ...autoRef.current, mode };
    autoRef.current = next;
    setAuto(next);
    saveAutoConfig(next);
    setAutoNote(null);
  }

  async function discover(): Promise<void> {
    setDiscovering(true);
    setStatus(said('正在发现同一局域网内的设备…'));
    const found = await scanLanPeers();
    const visible = dedupeDiscoveryPeers(filterDiscoverySelf(found, self));
    setPeers(visible);
    setDiscovering(false);
    setStatus(said(visible.length === 0 ? '未发现设备：确认对方已开启配对且在同一局域网' : `发现 ${visible.length} 台设备`));
  }

  function choosePeer(peer: LanDiscoveryPeer): void {
    setPeerInput(formatPeerAddress({ host: peer.host, port: peer.port }));
    setStatus(said(`已填入 ${peer.name} 的地址，请扫码或填对方显示的配对码`));
  }

  /** 离线设备的「重新配对」：把保存的（可能已由发现更新的）地址填回配对面板。 */
  function repairPairing(pairing: { name: string; host: string; port: number }): void {
    setPeerInput(formatPeerAddress({ host: pairing.host, port: pairing.port }));
    setCodeInput('');
    setPreview(null);
    setStatus(
      said(
        `请让对方重新开启配对，再输入新配对码与 ${pairing.name} 配对（地址 ${pairing.host}:${pairing.port}）`,
      ),
    );
  }

  async function pairPeer(peerText: string, codeText: string, name?: string, deviceId?: string): Promise<void> {
    const peer = parsePeerAddress(peerText);
    if (peer === null) {
      note('对方地址应为局域网 IP 与端口，例如 192.168.1.5:8765');
      return;
    }
    // 手输地址时也能从发现列表认出同一台：deviceId 优先，其次按地址匹配
    const discovered = peers.find((item) => formatPeerAddress(item) === peerText.trim());
    const peerDeviceId = deviceId ?? discovered?.deviceId;
    dispatch({ type: 'pairing' });
    setPreview(null);
    await action.run({
      scope: 'lan-sync',
      label: '正在配对…',
      fail: false,
      task: async () => {
        // 提交给服务端的设备名是本机名；扫码/粘贴里的 name 是「对方」的展示名，只用于本地记录
        const reachable = await checkPeerReachable(peer);
        if (!reachable.ok) {
          const detail = reachable.hint ?? '无法连接对方';
          const error = reachable.error === null || reachable.error === '' ? detail : `${detail}（${reachable.error}）`;
          dispatch({ type: 'failed', error });
          note(`配对失败：${error}`);
          toast.error(fail('配对', error, '请确认两端在同一 Wi-Fi 后重试'));
          return;
        }
        const result = await pairWithPeer(peer, codeText, Date.now(), defaultDeviceName());
        if (!result.ok || result.session === null) {
          const error = result.error ?? '配对失败';
          dispatch({ type: 'failed', error });
          note(`配对失败：${error}`);
          toast.error(fail('配对', error, '请核对对方地址与配对码'));
          return;
        }
        dispatch({ type: 'paired', session: result.session });
        await rememberLanPairing(pairingStore, result.session, { name, deviceId: peerDeviceId });
        setPairingsRevision((value) => value + 1);
        note(`已与 ${formatPeerAddress(peer)} 建立配对，可以预览后拉取或推送`);
        toast.success('已配对');
      },
    });
  }

  function toggleScope(scope: LanScope, checked: boolean): void {
    setScopes((current) => {
      const next = new Set(current);
      if (checked) next.add(scope);
      else next.delete(scope);
      const config = { ...autoRef.current, scopes: LAN_SCOPES.filter((item) => next.has(item)) };
      autoRef.current = config;
      setAuto(config);
      saveAutoConfig(config);
      return next;
    });
  }

  function selectedScopes(): LanScope[] {
    return LAN_SCOPES.filter((scope) => scopes.has(scope));
  }

  async function previewPull(): Promise<void> {
    const session = client.session;
    if (session === null) return;
    if (sessionExpired(session)) {
      dispatch({ type: 'expire', now: Date.now() });
      return;
    }
    const selected = selectedScopes();
    if (selected.length === 0) {
      note('请至少勾选一个同步范围');
      return;
    }
    setPreviewing(true);
    setStatus(said('正在读取对方变更…'));
    const result = await previewPullFromPeer(storage, session, selected);
    setPreviewing(false);
    if (!result.ok) {
      const message = fail('预览', result.error, '请检查两端是否在同一局域网后重试');
      setStatus(said(message));
      toast.error(message);
      return;
    }
    setPreview({ result, scopes: selected });
    setStatus(said(lanPreviewText(result)));
  }

  async function confirmPreview(): Promise<void> {
    if (preview === null || preview.result.envelope === null) return;
    const envelope = preview.result.envelope;
    const selected = preview.scopes;
    setProgress('正在合并对方变更…');
    await action.run({
      scope: 'lan-sync',
      label: '正在合并对方变更…',
      fail: false,
      task: async () => {
        const result = await applyLanPreview(storage, envelope, selected);
        setProgress(null);
        setPreview(null);
        if (!result.ok) {
          const message = fail('合并', result.error, '请重试或重新预览');
          setStatus(said(message));
          toast.error(message);
          return;
        }
        const message = `合并完成：写入 ${result.imported} 条，跳过 ${result.skipped} 条`;
        setStatus(said(message));
        toast.success(message);
        if (client.session !== null) await rememberSynced(client.session);
        if (selected.includes('settings')) await onSettingsReplaced();
        if (result.imported > 0) onChanged();
      },
    });
  }

  async function push(): Promise<void> {
    const session = client.session;
    if (session === null) return;
    if (sessionExpired(session)) {
      dispatch({ type: 'expire', now: Date.now() });
      return;
    }
    const selected = selectedScopes();
    if (selected.length === 0) {
      note('请至少勾选一个同步范围');
      return;
    }
    setProgress('正在推送到对方…');
    await action.run({
      scope: 'lan-sync',
      label: '正在推送到对方…',
      fail: false,
      task: async () => {
        const result = await pushToPeer(storage, session, selected);
        setProgress(null);
        if (!result.ok) {
          const message = fail('推送', result.error, '请检查两端是否在同一局域网后重试');
          setStatus(said(message));
          toast.error(message);
          return;
        }
        const message = `推送完成：写入 ${result.imported} 条，跳过 ${result.skipped} 条`;
        setStatus(said(message));
        toast.success(message);
        await rememberSynced(session);
      },
    });
  }

  return (
    <>
      <LanDiscoveryPanel peers={peers} discovering={discovering} onDiscover={() => void discover()} onChoose={choosePeer} />
      <LanSyncPairPanel
        busy={action.busy}
        paired={client.phase === 'paired'}
        peer={peerInput}
        code={codeInput}
        error={client.phase === 'failed' ? client.error : null}
        onPeerChange={setPeerInput}
        onCodeChange={setCodeInput}
        onPair={(peer, code, name, deviceId) => void pairPeer(peer, code, name, deviceId)}
        onNote={note}
        pendingPair={pendingPair}
        onPendingPairHandled={onPendingPairHandled}
      />
      {client.session !== null && (
        <span className="text-xs text-muted" data-role="lan-sync-session">
          已连接 {formatPeerAddress(client.session.peer)}
        </span>
      )}
      {client.phase === 'failed' && client.error !== null && (
        <StatusLine dataRole="lan-sync-error" tone="danger">
          {client.error}
        </StatusLine>
      )}
      <LanSyncDevicesPanel
        storage={storage}
        revision={pairingsRevision}
        onSettingsReplaced={onSettingsReplaced}
        onChanged={onChanged}
        onNote={note}
        onRepair={repairPairing}
        onTokenRefreshed={(id, token, expiresAt) => {
          const current = client.session;
          if (current === null) return;
          if (`${current.peer.host}:${current.peer.port}` !== id) return;
          dispatch({
            type: 'refresh',
            token,
            expiresAt: expiresAt > 0 ? expiresAt : current.expiresAt,
          });
        }}
      />
      <span className="text-xs font-medium text-muted">同步范围</span>
      <div className="flex flex-wrap items-center gap-3" data-role="lan-sync-scopes">
        {LAN_SCOPES.map((scope) => (
          <label key={scope} className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              checked={scopes.has(scope)}
              aria-label={`同步 ${LAN_SCOPE_LABEL[scope]}`}
              onChange={(event) => toggleScope(scope, event.target.checked)}
            />
            {LAN_SCOPE_LABEL[scope]}
          </label>
        ))}
      </div>
      <LanAutoPanel config={auto} note={autoNote} onChange={changeAuto} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="从对方拉取"
          loading={previewing || action.busy}
          disabled={client.phase !== 'paired' || previewing}
          onClick={() => void previewPull()}
        >
          从对方拉取
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label="推送到对方"
          loading={action.busy}
          disabled={client.phase !== 'paired'}
          onClick={() => void push()}
        >
          推送到对方
        </Button>
      </div>
      <span className="text-xs text-muted" data-role="lan-sync-preview-hint">
        同步前预览：拉取时先显示对方将带来的变更数量，确认后才合并。
      </span>
      {preview !== null && (
        <LanPreviewPanel
          result={preview.result}
          onConfirm={() => void confirmPreview()}
          onCancel={() => setPreview(null)}
        />
      )}
      {progress !== null && <StatusLine dataRole="lan-sync-progress">{progress}</StatusLine>}
      {status !== null && (
        <StatusLine dataRole="lan-sync-status" at={status.at}>
          {status.text}
        </StatusLine>
      )}
      <span className="text-xs text-muted">
        冲突按修改时间合并，较旧的一份跳过；只传业务数据，不含日志、快照与密码。
      </span>
    </>
  );
}
