import { useEffect, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { fail } from '../../copy/zh.ts';
import { errorMessage } from '../../lib/errors.ts';
import { useAction } from '../../lib/action.ts';
import { logWarn } from '../../log.ts';
import { copyText } from '../../system-actions.ts';
import {
  LAN_SYNC_POLL_INTERVAL_MS,
  applyLanReply,
  canServeLanSync,
  handleLanRequest,
  pollLanServer,
  respondLanServer,
  startLanServer,
  stopLanServer,
  type LanRuntime,
  type LanServerInfo,
  type Pairing,
  type SessionGrant,
} from '../../lan-sync.ts';
import { pairingQrText } from '../../lan-sync-qr.ts';
import { LanSyncClientPanel } from './lan-sync-client-panel.tsx';
import { LanSyncQrCode } from './lan-sync-qr-code.tsx';
import { said } from './format.ts';

export interface LanSyncBlockProps {
  storage: Storage;
  /** 拉取到设置范围后热加载设置 */
  onSettingsReplaced: () => Promise<void>;
  /** 拉取写入了业务数据后刷新界面 */
  onChanged: () => void;
}

/**
 * 局域网同步块（I-14 二期）：本机开配对 + 二维码 / 发现设备 / 预览后拉取 / 自动同步。
 *
 * 边界：
 * - 服务端（开配对 + 轮询原生队列 + UDP 广播）只在桌面与安卓显示；浏览器只做发起方；
 * - 轮询到请求交给 `handleLanRequest`（协议层纯函数）处理，本组件只管状态与呈现；
 * - 无长期凭据：配对码与令牌只放内存，停止配对或离开本页即失效；自动同步只用当前会话。
 */
export function LanSyncBlock({ storage, onSettingsReplaced, onChanged }: LanSyncBlockProps) {
  const action = useAction();
  const [server, setServer] = useState<LanServerInfo | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [grant, setGrant] = useState<SessionGrant | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  /** 服务端内存态：轮询回调里读，不触发重渲染 */
  const runtime = useRef<LanRuntime>({ pairing: null, session: null });
  const started = useRef(false);

  // 离开本页即停止配对：监听与令牌都不留在后台
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

  async function copyPairing(): Promise<void> {
    if (server === null || pairing === null) return;
    const ok = await copyText(pairingQrText(server.host, server.port, pairing.code));
    if (ok) toast.success('已复制配对信息');
    else toast.error('复制失败，请手动抄写地址与配对码');
  }

  const qrText = server !== null && pairing !== null ? pairingQrText(server.host, server.port, pairing.code) : '';

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
          {server !== null && pairing !== null && (
            <div className="flex flex-wrap items-start gap-3" data-role="lan-sync-pairing-info">
              <LanSyncQrCode text={qrText} />
              <div className="flex max-w-56 flex-col gap-1">
                <span className="text-xs text-muted">
                  二维码内容为「IP:端口 配对码」；对方扫码后手动输入，或复制下面的信息发过去。
                </span>
                <Button size="sm" variant="ghost" aria-label="复制配对信息" onClick={() => void copyPairing()}>
                  复制配对信息
                </Button>
                <span className="break-all text-xs text-muted" data-role="lan-sync-pairing-text">
                  {qrText}
                </span>
              </div>
            </div>
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
