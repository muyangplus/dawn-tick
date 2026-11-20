import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import type { AppSettings } from '@dawn-tick/core';
import { CollapsibleCard } from './ui/collapsible-card.tsx';
import { SwitchField } from './ui/controls.tsx';
import { Button } from './ui/button.tsx';
import { elevateAutoStart, readAutoStart, saveStartupPrefs, writeAutoStart } from '../autostart.ts';
import { useAction } from '../lib/action.ts';
import { startupCopy } from '../copy/settings-startup.ts';

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
      scope: 'settings',
      label: startupCopy.savingLabel,
      task: async () => {
        const written = await writeAutoStart(value);
        if (written.ok) {
          setRegistered(value);
          await onPatch({ autoStart: value });
          return;
        }
        setMessage(startupCopy.registerFailed(written.error ?? null, value));
        if (value) setCanElevate(true);
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  /** 失败后申请管理员权限，由提权实例写机器级启动项。 */
  async function elevate(): Promise<void> {
    const result = await run({
      scope: 'settings',
      label: startupCopy.elevatingLabel,
      task: async () => {
        setMessage(startupCopy.elevatingMessage);
        const requested = await elevateAutoStart();
        if (!requested) {
          setMessage(startupCopy.elevateFailed);
          return;
        }
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const status = await readAutoStart();
          if (status === true) {
            setRegistered(true);
            setCanElevate(false);
            setMessage(startupCopy.elevatedRegistered);
            await onPatch({ autoStart: true });
            return;
          }
        }
        setMessage(startupCopy.elevatedNotDetected);
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  if (!supported) return null;

  return (
    <CollapsibleCard id="startup" title={startupCopy.title} icon={Power}>
      <SwitchField
        label={startupCopy.autoStartLabel}
        description={registered === true ? startupCopy.registered : startupCopy.unregistered}
        checked={settings.autoStart}
        disabled={busy}
        onCheckedChange={(value) => void toggleAutoStart(value)}
      />

      {canElevate && (
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void elevate()}>
          {startupCopy.elevateButton}
        </Button>
      )}

      <SwitchField
        label={startupCopy.startHiddenLabel}
        description={startupCopy.startHiddenDescription}
        checked={settings.startHidden}
        onCheckedChange={(value) => void onPatch({ startHidden: value })}
      />

      {message !== null && <span className="text-xs text-muted">{message}</span>}
    </CollapsibleCard>
  );
}
