import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import type { AppSettings } from '@dawn-tick/core';
import { Card, CardTitle } from './ui/card.tsx';
import { Switch } from './ui/controls.tsx';
import { readAutoStart, saveStartupPrefs, writeAutoStart } from '../autostart.ts';
import { logWarn } from '../log.ts';

export interface StartupSettingsProps {
  supported: boolean;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

export function StartupSettings({ supported, settings, onPatch }: StartupSettingsProps) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      const enabled = await readAutoStart();
      if (!cancelled) setRegistered(enabled);
      // 与系统实际状态对齐：设置说开就注册，说关就移除
      if (enabled !== null && enabled !== settings.autoStart) {
        const ok = await writeAutoStart(settings.autoStart);
        if (!cancelled && ok) setRegistered(settings.autoStart);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, settings.autoStart]);

  useEffect(() => {
    if (!supported) return;
    void saveStartupPrefs(settings.startHidden);
  }, [supported, settings.startHidden]);

  async function toggleAutoStart(value: boolean): Promise<void> {
    setMessage(null);
    const ok = await writeAutoStart(value);
    if (!ok) {
      setMessage('注册失败，请检查系统权限');
      logWarn('autostart', '切换开机自启未成功', { value });
      return;
    }
    setRegistered(value);
    await onPatch({ autoStart: value });
  }

  if (!supported) return null;

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="flex items-center gap-2">
        <Power className="size-4" aria-hidden />
        启动
      </CardTitle>

      <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
        <span className="flex flex-col">
          <span>开机自动启动</span>
          <span className="text-xs text-muted">
            当前状态：{registered === null ? '未注册' : registered ? '已注册' : '未注册'}
          </span>
        </span>
        <Switch checked={settings.autoStart} onCheckedChange={(value) => void toggleAutoStart(value)} />
      </label>

      <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
        <span className="flex flex-col">
          <span>启动时隐藏窗口</span>
          <span className="text-xs text-muted">仅开机自启时生效，手动打开始终显示主窗口，只驻留托盘</span>
        </span>
        <Switch
          checked={settings.startHidden}
          onCheckedChange={(value) => void onPatch({ startHidden: value })}
        />
      </label>

      {message !== null && <span className="text-xs text-danger-strong">{message}</span>}
    </Card>
  );
}
