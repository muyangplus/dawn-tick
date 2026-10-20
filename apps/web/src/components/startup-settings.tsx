import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import type { AppSettings } from '@dawn-tick/core';
import { CollapsibleCard } from './ui/collapsible-card.tsx';
import { SwitchField } from './ui/controls.tsx';
import { Button } from './ui/button.tsx';
import { elevateAutoStart, readAutoStart, saveStartupPrefs, writeAutoStart } from '../autostart.ts';
import { useAction } from '../lib/action.ts';

export interface StartupSettingsProps {
  supported: boolean;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

export function StartupSettings({ supported, settings, onPatch }: StartupSettingsProps) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canElevate, setCanElevate] = useState(false);
  const { busy, run } = useAction();

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
    const result = await run({
      scope: 'autostart',
      label: '正在设置开机自启…',
      task: async () => {
        const written = await writeAutoStart(value);
        if (written.ok) {
          setRegistered(value);
          await onPatch({ autoStart: value });
          return;
        }
        setMessage(`注册失败：${written.error ?? '未知原因'}`);
        if (value) setCanElevate(true);
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  /** 失败后申请管理员权限，由提权实例写机器级启动项。 */
  async function elevate(): Promise<void> {
    const result = await run({
      scope: 'autostart',
      label: '正在申请管理员权限…',
      task: async () => {
        setMessage('正在申请管理员权限，请在系统提示中允许…');
        const requested = await elevateAutoStart();
        if (!requested) {
          setMessage('提权失败，请手动以管理员身份运行一次');
          return;
        }
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const status = await readAutoStart();
          if (status === true) {
            setRegistered(true);
            setCanElevate(false);
            setMessage('开机自启已注册（管理员权限）');
            await onPatch({ autoStart: true });
            return;
          }
        }
        setMessage('未检测到启动项：请以管理员身份运行一次');
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  if (!supported) return null;

  return (
    <CollapsibleCard id="startup" title="启动" icon={Power}>
      <SwitchField
        label="开机自动启动"
        description={`当前状态：${registered === null ? '未注册' : registered ? '已注册' : '未注册'}`}
        checked={settings.autoStart}
        disabled={busy}
        onCheckedChange={(value) => void toggleAutoStart(value)}
      />

      {canElevate && (
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void elevate()}>
          以管理员权限注册
        </Button>
      )}

      <SwitchField
        label="启动时隐藏窗口"
        description="仅开机自启生效；手动启动显示主窗口"
        checked={settings.startHidden}
        onCheckedChange={(value) => void onPatch({ startHidden: value })}
      />

      {message !== null && <span className="text-xs text-muted">{message}</span>}
    </CollapsibleCard>
  );
}
