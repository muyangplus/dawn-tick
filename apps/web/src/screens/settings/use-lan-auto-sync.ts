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
  onSettingsReplaced,
  onChanged,
}: UseLanAutoSyncOptions): void {
  const configRef = useRef(config);
  const launchAt = useRef(Date.now());

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (session === null || mode === 'off') return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async (): Promise<void> => {
      if (cancelled) return;
      const current = configRef.current;
      if (!shouldAutoSync(current, Date.now(), launchAt.current)) return;
      if (sessionExpired(session)) {
        onExpired();
        onNote('自动同步已暂停：配对过期，请重新配对');
        return;
      }
      const result = await runAutoWithRetry(
        () => pullFromPeer(storage, session, current.scopes),
        (value) => value.ok,
        1000,
      );
      if (cancelled) return;
      const next = { ...current, lastRunAt: Date.now() };
      configRef.current = next;
      saveAutoConfig(next);
      onConfig(next);
      if (!result.ok) {
        logWarn('lan-sync', '自动同步失败（已重试一次）', { error: result.error });
        onNote('自动同步失败，已静默重试一次');
        return;
      }
      const imported = result.value?.imported ?? 0;
      const skipped = result.value?.skipped ?? 0;
      logInfo('lan-sync', '自动同步完成', { imported, skipped });
      onNote(`自动同步完成：写入 ${imported} 条，跳过 ${skipped} 条`);
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
  }, [session, mode, storage, onConfig, onNote, onExpired, onSettingsReplaced, onChanged]);
}
