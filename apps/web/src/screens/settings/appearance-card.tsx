import {
  MOTION_LABEL,
  MOTION_MODES,
  THEME_PRESETS,
  type AppSettings,
  type MotionMode,
  type ThemePreset,
} from '@dawn-tick/core';
import { PRESETS } from '../../design/tokens.ts';
import { isAutoStartSupported } from '../../lib/capabilities.ts';
import { StartupSettings } from '../../components/startup-settings.tsx';
import { Field } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/controls.tsx';
import { appearanceCopy } from '../../copy/settings-appearance.ts';

const THEME_LABEL: Record<ThemePreset, string> = appearanceCopy.themePreset;

export interface AppearanceCardProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

/**
 * 外观与动效卡：主题风格、深浅模式与界面动效；桌面端继续把「启动」设置放在本卡末尾。
 *
 * 设置项一律通过 `onPatch` 落库；启动项仍由 `StartupSettings` 自己读写系统启动项。
 */
export function AppearanceCard({ settings, onPatch }: AppearanceCardProps) {
  return (
    <>
      <Field label={appearanceCopy.themePresetLabel}>
        <Select
          value={settings.themePreset}
          onValueChange={(value) => void onPatch({ themePreset: value as ThemePreset })}
        >
          <SelectTrigger aria-label={appearanceCopy.themePresetLabel}>
            <span>{THEME_LABEL[settings.themePreset]}</span>
          </SelectTrigger>
          <SelectContent>
            {THEME_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {PRESETS[preset].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={appearanceCopy.themeModeLabel}>
        <Select
          value={settings.theme}
          onValueChange={(value) => void onPatch({ theme: value as AppSettings['theme'] })}
        >
          <SelectTrigger aria-label={appearanceCopy.themeModeLabel}>
            <span>
              {appearanceCopy.themeMode[settings.theme]}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{appearanceCopy.themeMode.system}</SelectItem>
            <SelectItem value="light">{appearanceCopy.themeMode.light}</SelectItem>
            <SelectItem value="dark">{appearanceCopy.themeMode.dark}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={appearanceCopy.motionLabel} help={appearanceCopy.motionHelp}>
        <Select value={settings.motion} onValueChange={(value) => void onPatch({ motion: value as MotionMode })}>
          <SelectTrigger aria-label={appearanceCopy.motionLabel}>
            <span>{MOTION_LABEL[settings.motion]}</span>
          </SelectTrigger>
          <SelectContent>
            {MOTION_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {MOTION_LABEL[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <StartupSettings supported={isAutoStartSupported()} settings={settings} onPatch={onPatch} />
    </>
  );
}
