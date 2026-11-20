import { useEffect, useRef } from 'react';
import type { Storage } from '@dawn-tick/core';
import { logInfo, logWarn } from '../../log.ts';
import {
  LAN_AUTO_INTERVAL_MS,
  runAutoWithRetry,
  saveAutoConfig,
  shouldAutoSync,
  type LanAutoConfig,
  type LanAutoMode,
} from '../../lan-sync-auto.ts';
import { pullFromPeer, sessionExpired, type LanSession } from '../../lan-sync-client.ts';
import { lanSyncPanelCopy as copy } from '../../copy/sync-lan-panel.ts';

/** 应用本次启动的时刻：「每次启动」按应用启动算，而不是按打开设置面板算 */
const APP_LAUNCHED_AT = Date.now();

export interface UseLanAutoSyncOptions {
  storage: Storage;
  session: LanSession | null;
  mode: LanAutoMode;
  /** 当前配置（模式 / 范围 / 上次运行时间），由父组件持有 */
  config: LanAutoConfig;
  /** 自动同步跑完后回写 `lastRunAt`；父组件同步更新 ref 与状态 */
  onConfig: (next: LanAutoConfig) => void;
  onNote: (note: string | null) => void;
  /** 会话已过期：父组件把客户端状态机退回空闲 */
  onExpired: () => void;
  /** 自动同步成功：父组件回写「上次同步时间」并持久化 */
  onSynced?: ((session: LanSession) => Promise<void>) | undefined;
  onSettingsReplaced: () => Promise<void>;
  onChanged: () => void;
}

/**
 * 后台自动同步（二期能力，三期继续复用长期令牌）：
 * 只在已配对且令牌有效时跑；失败静默重试一次，仍失败只记日志。
 * 独立成 hook 是为了让 `lan-sync-client-panel.tsx` 保持在 400 行以内。
 */
export function useLanAutoSync({
  storage,
  session,
  mode,
  config,
  onConfig,
  onNote,
  onExpired,
  onSynced,
  onSettingsReplaced,
  onChanged,
}: UseLanAutoSyncOptions): void {
  const configRef = useRef(config);
  // 回调放进 ref：父组件每次渲染都会给出新函数，若作为 effect 依赖，进行中的拉取会被中途取消，
  // 取消后已写入的数据不再触发刷新，lastRunAt 也没记上，下次又整份重拉
  const callbacks = useRef({ onConfig, onNote, onExpired, onSynced, onSettingsReplaced, onChanged });
  callbacks.current = { onConfig, onNote, onExpired, onSynced, onSettingsReplaced, onChanged };

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (session === null || mode === 'off') return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async (): Promise<void> => {
      if (cancelled) return;
      const { onConfig, onNote, onExpired, onSynced, onSettingsReplaced, onChanged } = callbacks.current;
      const current = configRef.current;
      if (!shouldAutoSync(current, Date.now(), APP_LAUNCHED_AT)) return;
      if (sessionExpired(session)) {
        onExpired();
        onNote(copy.autoPaused);
        return;
      }
      const result = await runAutoWithRetry(
        () => pullFromPeer(storage, session, current.scopes),
        (value) => value.ok,
        1000,
      );
      // 拉取已经写进本机：即使面板在这期间卸载，也要记下运行时间并通知刷新
      const next = { ...current, lastRunAt: Date.now() };
      configRef.current = next;
      saveAutoConfig(next);
      onConfig(next);
      if (!result.ok) {
        logWarn('sync', '自动同步失败，已重试一次', { error: result.error });
        onNote(copy.autoFailedRetried);
        return;
      }
      const imported = result.value?.imported ?? 0;
      const skipped = result.value?.skipped ?? 0;
      logInfo('sync', '自动同步完成', { imported, skipped });
      onNote(copy.autoDone(imported, skipped));
      if (onSynced !== undefined) await onSynced(session);
      if (current.scopes.includes('settings')) await onSettingsReplaced();
      if (imported > 0) onChanged();
    };
    void run();
    if (mode === 'interval30') {
      timer = window.setInterval(() => void run(), LAN_AUTO_INTERVAL_MS);
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [session, mode, storage]);
}
