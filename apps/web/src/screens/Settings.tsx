import {
  THEME_PRESETS,
  VIEW_DAY_OPTIONS,
  isValidTimeZone,
  type AppSettings,
  type ThemePreset,
} from '@dawn-tick/core';
import { THEMES } from '../theme.ts';

interface Props {
  settings: AppSettings;
  persistent: boolean | null;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

const PRESET_LABELS = THEMES as Record<ThemePreset, { label: string }>;

export function Settings({ settings, persistent, onPatch }: Props) {
  const zoneInvalid = !isValidTimeZone(settings.timeZone);

  return (
    <div className="list">
      <div className="card form">
        <label className="field">
          <span>主题风格</span>
          <select
            value={settings.themePreset}
            onChange={(event) => void onPatch({ themePreset: event.target.value as ThemePreset })}
          >
            {THEME_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {PRESET_LABELS[preset].label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>深浅模式</span>
          <select
            value={settings.theme}
            onChange={(event) => void onPatch({ theme: event.target.value as AppSettings['theme'] })}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>

        <label className="field">
          <span>周视图天数</span>
          <select
            value={settings.viewDays}
            onChange={(event) => void onPatch({ viewDays: Number(event.target.value) })}
          >
            {VIEW_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} 天
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>时区（时区自动同步关闭时生效）</span>
          <input
            value={settings.timeZone}
            onChange={(event) => void onPatch({ timeZone: event.target.value })}
          />
        </label>
        {zoneInvalid && <p className="error">时区名无效</p>}

        <label className="row">
          <input
            type="checkbox"
            checked={settings.autoTimeZone}
            onChange={(event) => void onPatch({ autoTimeZone: event.target.checked })}
          />
          <span>时区自动同步（跟随设备）</span>
        </label>
      </div>

      <div className="card">
        <div className="muted">
          本地数据持久化：{persistent === null ? '未申请' : persistent ? '已授权' : '未授权（浏览器可能清理数据）'}
        </div>
      </div>
    </div>
  );
}
