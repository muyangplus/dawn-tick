import { useEffect, useReducer, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { fail } from '../../copy/zh.ts';
import { errorMessage } from '../../lib/errors.ts';
import { useAction } from '../../lib/action.ts';
import { logWarn } from '../../log.ts';
import {
  LAN_CLIENT_IDLE,
  LAN_SCOPES,
  LAN_SCOPE_LABEL,
  LAN_SYNC_POLL_INTERVAL_MS,
  applyLanReply,
  canServeLanSync,
  formatPeerAddress,
  handleLanRequest,
  pairWithPeer,
  parsePeerAddress,
  pollLanServer,
  pullFromPeer,
  pushToPeer,
  reduceLanClient,
  respondLanServer,
  sessionExpired,
  startLanServer,
  stopLanServer,
  type LanRuntime,
  type LanScope,
  type LanServerInfo,
  type Pairing,
  type SessionGrant,
} from '../../lan-sync.ts';
import { said } from './format.ts';

export interface LanSyncBlockProps {
  storage: Storage;
  /** 拉取到设置范围后热加载设置 */
  onSettingsReplaced: () => Promise<void>;
  /** 拉取写入了业务数据后刷新界面 */
  onChanged: () => void;
}

/**
 * 局域网同步块（I-14 一期）：本机开配对 / 对方地址配对 / 范围勾选 / 拉取与推送。
 *
 * 边界：
 * - 服务端（开配对 + 轮询原生队列）只在桌面与安卓显示；浏览器只做发起方；
 * - 轮询到请求交给 `handleLanRequest`（协议层纯函数）处理，本组件只管状态与呈现；
 * - 无长期凭据：配对码与令牌只放内存，停止配对或离开本页即失效。
 */
export function LanSyncBlock({ storage, onSettingsReplaced, onChanged }: LanSyncBlockProps) {
  const action = useAction();
  const [server, setServer] = useState<LanServerInfo | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [grant, setGrant] = useState<SessionGrant | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [peerInput, setPeerInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [scopes, setScopes] = useState<ReadonlySet<LanScope>>(() => new Set(LAN_SCOPES));
  const [client, dispatch] = useReducer(reduceLanClient, LAN_CLIENT_IDLE);
  /** 服务端内存态：轮询回调里读，不触发重渲染 */
  const runtime = useRef<LanRuntime>({ pairing: null, session: null });
  const started = useRef(false);

  // 离开本页即停止配对：监听与令牌都不留在后台（一期明确不做常驻）
  useEffect(() => {
    return () => {
      if (!started.current) return;
      started.current = false;
      void stopLanServer();
    };
  }, []);

  // 服务端轮询：原生队列 → 协议层处理 → 回写响应
  useEffect(() => {
    if (server === null) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async (): Promise<void> => {
      try {
        const request = await pollLanServer();
        if (request !== null) {
          const reply = await handleLanRequest(
            { storage, pairing: runtime.current.pairing, session: runtime.current.session },
            request,
          );
          runtime.current = applyLanReply(runtime.current, reply);
          setPairing(runtime.current.pairing);
          setGrant(runtime.current.session);
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
        const result = await startLanServer();
        if (!result.ok || result.info === null) {
          const message = fail('开启局域网配对', result.error, '请确认本机已连上 Wi-Fi 或有线网络');
          setStatus(said(message));
          toast.error(message);
          return;
        }
        started.current = true;
        runtime.current = {
          pairing: { code: result.info.code, expiresAt: result.info.expiresAt },
          session: null,
        };
        setServer(result.info);
        setPairing(runtime.current.pairing);
        setGrant(null);
        const message = `已开启配对：${result.info.address}，配对码 ${result.info.code}（5 分钟内有效）`;
        setStatus(said(message));
        toast.success('已开启局域网配对');
      },
    });
  }

  async function stopPairing(): Promise<void> {
    await stopLanServer();
    started.current = false;
    runtime.current = { pairing: null, session: null };
    setServer(null);
    setPairing(null);
    setGrant(null);
    setStatus(said('已停止局域网配对'));
  }

  async function pairPeer(): Promise<void> {
    const peer = parsePeerAddress(peerInput);
    if (peer === null) {
      setStatus(said('对方地址应为局域网 IP 与端口，例如 192.168.1.5:8765'));
      return;
    }
    dispatch({ type: 'pairing' });
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
        setStatus(said(`已与 ${formatPeerAddress(peer)} 建立配对，可以拉取或推送`));
        toast.success('已配对');
      },
    });
  }

  function toggleScope(scope: LanScope, checked: boolean): void {
    setScopes((current) => {
      const next = new Set(current);
      if (checked) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  async function transfer(direction: 'pull' | 'push'): Promise<void> {
    const session = client.session;
    if (session === null) return;
    if (sessionExpired(session)) {
      dispatch({ type: 'expire', now: Date.now() });
      return;
    }
    const selected = LAN_SCOPES.filter((scope) => scopes.has(scope));
    if (selected.length === 0) {
      setStatus(said('请至少勾选一个同步范围'));
      return;
    }
    const what = direction === 'pull' ? '拉取' : '推送';
    setProgress(direction === 'pull' ? '正在从对方拉取…' : '正在推送到对方…');
    await action.run({
      scope: 'lan-sync',
      label: direction === 'pull' ? '正在从对方拉取…' : '正在推送到对方…',
      fail: false,
      task: async () => {
        const result =
          direction === 'pull'
            ? await pullFromPeer(storage, session, selected)
            : await pushToPeer(storage, session, selected);
        setProgress(null);
        if (!result.ok) {
          const message = fail(what, result.error, '请检查两端是否在同一局域网后重试');
          setStatus(said(message));
          toast.error(message);
          return;
        }
        const message = `${what}完成：写入 ${result.imported} 条，跳过 ${result.skipped} 条`;
        setStatus(said(message));
        toast.success(message);
        if (direction === 'pull') {
          if (selected.includes('settings')) await onSettingsReplaced();
          if (result.imported > 0) onChanged();
        }
      },
    });
  }

  return (
    <div className="flex flex-col gap-1" data-role="lan-sync">
      <span className="text-sm font-medium text-ink" data-role="lan-sync-title">
        局域网同步
      </span>
      <span className="text-xs text-muted">
        同一局域网内直接互传课表、待办与设置：一端开配对，另一端填地址与配对码。
      </span>
      {canServeLanSync() ? (
        <div className="flex flex-col gap-1" data-role="lan-sync-server">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label="开启局域网配对"
              loading={action.busy}
              disabled={server !== null}
              onClick={() => void startPairing()}
            >
              开启配对
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="停止局域网配对"
              disabled={server === null}
              onClick={() => void stopPairing()}
            >
              停止配对
            </Button>
          </div>
          {server !== null && (
            <span className="text-xs text-muted" data-role="lan-sync-address">
              本机地址：{server.address}
            </span>
          )}
          {pairing !== null && (
            <span className="text-sm text-ink" data-role="lan-sync-code">
              配对码：{pairing.code}（5 分钟内有效）
            </span>
          )}
          {server !== null && pairing === null && (
            <span className="text-xs text-muted" data-role="lan-sync-granted">
              {grant === null ? '等待对方请求…' : '已有设备配对，可以拉取或推送；重新配对请先停止再开启'}
            </span>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted" data-role="lan-sync-server-hint">
          浏览器端只作为发起方：请先在桌面版或安卓版上开启配对，再在这里填对方地址。
        </span>
      )}
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
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="从对方拉取"
          loading={action.busy}
          disabled={client.phase !== 'paired'}
          onClick={() => void transfer('pull')}
        >
          从对方拉取
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label="推送到对方"
          loading={action.busy}
          disabled={client.phase !== 'paired'}
          onClick={() => void transfer('push')}
        >
          推送到对方
        </Button>
      </div>
      {progress !== null && <StatusLine dataRole="lan-sync-progress">{progress}</StatusLine>}
      {status !== null && (
        <StatusLine dataRole="lan-sync-status" at={status.at}>
          {status.text}
        </StatusLine>
      )}
      <span className="text-xs text-muted">
        冲突按修改时间合并，较旧的一份跳过；只传业务数据，不含日志、快照与密码。
      </span>
    </div>
  );
}
