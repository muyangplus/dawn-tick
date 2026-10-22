import { useEffect, useReducer, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { fail } from '../../copy/zh.ts';
import { errorMessage } from '../../lib/errors.ts';
import { useAction } from '../../lib/action.ts';
import { logInfo, logWarn } from '../../log.ts';
import {
  LAN_CLIENT_IDLE,
  LAN_SCOPES,
  LAN_SCOPE_LABEL,
  formatPeerAddress,
  pairWithPeer,
  parsePeerAddress,
  pullFromPeer,
  pushToPeer,
  reduceLanClient,
  sessionExpired,
  type LanScope,
} from '../../lan-sync.ts';
import {
  dedupeDiscoveryPeers,
  filterDiscoverySelf,
  scanLanPeers,
  type LanDiscoveryPeer,
} from '../../lan-sync-discovery.ts';
import {
  LAN_AUTO_INTERVAL_MS,
  loadAutoConfig,
  runAutoWithRetry,
  saveAutoConfig,
  shouldAutoSync,
  type LanAutoConfig,
  type LanAutoMode,
} from '../../lan-sync-auto.ts';
import {
  applyLanPreview,
  previewPullFromPeer,
  type LanPreviewResult,
} from '../../lan-sync-preview.ts';
import { LanAutoPanel } from './lan-sync-auto-panel.tsx';
import { LanDiscoveryPanel } from './lan-sync-discovery-panel.tsx';
import { LanPreviewPanel, lanPreviewText } from './lan-sync-preview-panel.tsx';
import { said } from './format.ts';

export interface LanSyncClientPanelProps {
  storage: Storage;
  /** 本机服务端地址：发现列表里过滤自己；没开配对时为 null */
  self: { host: string; port: number } | null;
  onSettingsReplaced: () => Promise<void>;
  onChanged: () => void;
}

function autoResultText(imported: number, skipped: number): string {
  return `自动同步完成：写入 ${imported} 条，跳过 ${skipped} 条`;
}

/**
 * 局域网同步的发起方：发现设备 / 手输地址配对 / 范围 / 预览后拉取 / 推送 / 自动同步。
 *
 * 服务端与二维码在父组件；这里只在需要时用本机内存里的配对会话。
 */
export function LanSyncClientPanel({ storage, self, onSettingsReplaced, onChanged }: LanSyncClientPanelProps) {
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
  const autoRef = useRef(auto);
  const launchAt = useRef(Date.now());

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  // 后台自动同步：只在已配对且令牌有效时跑；失败静默重试一次，仍失败只记日志
  useEffect(() => {
    if (client.phase !== 'paired' || client.session === null || auto.mode === 'off') return;
    const session = client.session;
    let cancelled = false;
    let timer: number | undefined;
    const run = async (): Promise<void> => {
      if (cancelled) return;
      const config = autoRef.current;
      if (!shouldAutoSync(config, Date.now(), launchAt.current)) return;
      if (sessionExpired(session)) {
        dispatch({ type: 'expire', now: Date.now() });
        setAutoNote('自动同步已暂停：配对过期，请重新配对');
        return;
      }
      const result = await runAutoWithRetry(
        () => pullFromPeer(storage, session, config.scopes),
        (value) => value.ok,
        1000,
      );
      if (cancelled) return;
      const next = { ...config, lastRunAt: Date.now() };
      autoRef.current = next;
      setAuto(next);
      saveAutoConfig(next);
      if (!result.ok) {
        logWarn('lan-sync', '自动同步失败（已重试一次）', { error: result.error });
        setAutoNote('自动同步失败，已静默重试一次');
        return;
      }
      const imported = result.value?.imported ?? 0;
      const skipped = result.value?.skipped ?? 0;
      logInfo('lan-sync', '自动同步完成', { imported, skipped });
      setAutoNote(autoResultText(imported, skipped));
      if (config.scopes.includes('settings')) await onSettingsReplaced();
      if (imported > 0) onChanged();
    };
    void run();
    if (auto.mode === 'interval30') {
      timer = window.setInterval(() => void run(), LAN_AUTO_INTERVAL_MS);
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [client.phase, client.session, auto.mode, storage, onChanged, onSettingsReplaced]);

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
    setStatus(said(`已填入 ${peer.name} 的地址，请填对方显示的配对码`));
  }

  async function pairPeer(): Promise<void> {
    const peer = parsePeerAddress(peerInput);
    if (peer === null) {
      setStatus(said('对方地址应为局域网 IP 与端口，例如 192.168.1.5:8765'));
      return;
    }
    dispatch({ type: 'pairing' });
    setPreview(null);
    await action.run({
      scope: 'lan-sync',
      label: '正在配对…',
      fail: false,
      task: async () => {
        const result = await pairWithPeer(peer, codeInput);
        if (!result.ok || result.session === null) {
          const error = result.error ?? '配对失败';
          dispatch({ type: 'failed', error });
          toast.error(fail('配对', error, '请核对对方地址与配对码'));
          return;
        }
        dispatch({ type: 'paired', session: result.session });
        setStatus(said(`已与 ${formatPeerAddress(peer)} 建立配对，可以预览后拉取或推送`));
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
      setStatus(said('请至少勾选一个同步范围'));
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
      setStatus(said('请至少勾选一个同步范围'));
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
      },
    });
  }

  return (
    <>
      <LanDiscoveryPanel peers={peers} discovering={discovering} onDiscover={() => void discover()} onChoose={choosePeer} />
      <Field label="对方地址" hint="与本机在同一局域网" help="填对方的局域网 IP 与端口，例如 192.168.1.5:8765">
        <Input
          data-role="lan-sync-peer"
          aria-label="对方地址"
          value={peerInput}
          placeholder="192.168.1.5:8765"
          onChange={(event) => setPeerInput(event.target.value)}
        />
      </Field>
      <Field label="配对码" hint="对方「开启配对」后显示的 6 位数字">
        <Input
          data-role="lan-sync-pair-code"
          aria-label="配对码"
          inputMode="numeric"
          maxLength={6}
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="配对"
          loading={action.busy}
          disabled={client.phase === 'pairing'}
          onClick={() => void pairPeer()}
        >
          {client.phase === 'paired' ? '重新配对' : '配对'}
        </Button>
        {client.session !== null && (
          <span className="text-xs text-muted" data-role="lan-sync-session">
            已连接 {formatPeerAddress(client.session.peer)}
          </span>
        )}
      </div>
      {client.phase === 'failed' && client.error !== null && (
        <StatusLine dataRole="lan-sync-error" tone="danger">
          {client.error}
        </StatusLine>
      )}
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
