import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import type { AppSettings } from '@dawn-tick/core';
import { Card, CardTitle } from './ui/card.tsx';
import { Switch } from './ui/controls.tsx';
import { Button } from './ui/button.tsx';
import { elevateAutoStart, readAutoStart, saveStartupPrefs, writeAutoStart } from '../autostart.ts';

export interface StartupSettingsProps {
  supported: boolean;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

export function StartupSettings({ supported, settings, onPatch }: StartupSettingsProps) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canElevate, setCanElevate] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      const enabled = await readAutoStart();
      if (!cancelled) setRegistered(enabled);
      if (enabled !== null && enabled !== settings.autoStart) {
        const result = await writeAutoStart(settings.autoStart);
        if (cancelled) return;
        if (result.ok) setRegistered(settings.autoStart);
        else setCanElevate(true);
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
    setCanElevate(false);
    setBusy(true);
    try {
      const result = await writeAutoStart(value);
      if (result.ok) {
        setRegistered(value);
        await onPatch({ autoStart: value });
        return;
      }
      setMessage(`注册失败：${result.error ?? '未知原因'}`);
      if (value) setCanElevate(true);
    } finally {
      setBusy(false);
    }
  }

  /** 失败后申请管理员权限，由提权实例写机器级启动项。 */
  async function elevate(): Promise<void> {
    setBusy(true);
    setMessage('正在申请管理员权限，请在系统提示中允许…');
    try {
      const requested = await elevateAutoStart();
      if (!requested) {
        setMessage('申请管理员权限失败，请在系统提示中允许或手动以管理员身份运行一次');
        return;
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const status = await readAutoStart();
        if (status === true) {
          setRegistered(true);
          setCanElevate(false);
          setMessage('已通过管理员权限注册开机自启');
          await onPatch({ autoStart: true });
          return;
        }
      }
      setMessage('提权后仍未检测到启动项，请手动以管理员身份运行一次程序');
    } finally {
      setBusy(false);
    }
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
        <Switch
          checked={settings.autoStart}
          disabled={busy}
          onCheckedChange={(value) => void toggleAutoStart(value)}
        />
      </label>

      {canElevate && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void elevate()}>
          以管理员权限注册
        </Button>
      )}

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

      {message !== null && <span className="text-xs text-muted">{message}</span>}
    </Card>
  );
}
