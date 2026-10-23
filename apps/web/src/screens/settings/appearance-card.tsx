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

const THEME_LABEL: Record<ThemePreset, string> = {
  vivid: '青春活力',
  fresh: '清爽学院',
  mono: '极简墨色',
  muted: '莫兰迪柔光',
};

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
      <Field label="主题风格">
        <Select
          value={settings.themePreset}
          onValueChange={(value) => void onPatch({ themePreset: value as ThemePreset })}
        >
          <SelectTrigger aria-label="主题风格">
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
      <Field label="深浅模式">
        <Select
          value={settings.theme}
          onValueChange={(value) => void onPatch({ theme: value as AppSettings['theme'] })}
        >
          <SelectTrigger aria-label="深浅模式">
            <span>
              {settings.theme === 'system' ? '跟随系统' : settings.theme === 'dark' ? '深色' : '浅色'}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">跟随系统</SelectItem>
            <SelectItem value="light">浅色</SelectItem>
            <SelectItem value="dark">深色</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="界面动效" hint="页面与弹窗过渡" help="跟随系统时遵守系统的「减少动态效果」">
        <Select value={settings.motion} onValueChange={(value) => void onPatch({ motion: value as MotionMode })}>
          <SelectTrigger aria-label="界面动效">
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
