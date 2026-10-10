import {
  THEME_PRESETS,
  VIEW_DAY_OPTIONS,
  formatDateTime,
  isValidTimeZone,
  type AppSettings,
  type ThemePreset,
} from '@dawn-tick/core';
import type { ReminderView } from '../useReminders.ts';
import { THEMES } from '../theme.ts';

interface Props {
  settings: AppSettings;
  persistent: boolean | null;
  reminders: ReminderView;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

const PERMISSION_LABEL: Record<ReminderView['permission'], string> = {
  unsupported: '当前环境不支持通知',
  default: '未申请',
  granted: '已授权',
  denied: '已被拒绝',
};

const PRESET_LABELS = THEMES as Record<ThemePreset, { label: string }>;

export function Settings({ settings, persistent, reminders, onPatch }: Props) {
  const zoneInvalid = !isValidTimeZone(settings.timeZone);
  const next = reminders.upcoming[0];

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
        <div className="row">
          <span className="muted">通知权限：{PERMISSION_LABEL[reminders.permission]}</span>
          <button
            type="button"
            onClick={() => void reminders.request()}
            disabled={reminders.permission === 'unsupported' || reminders.permission === 'granted'}
          >
            申请通知权限
          </button>
        </div>
        <div className="muted">网页关闭后无法提醒（页面打开时才生效）</div>
        <div className="muted">
          接下来 7 天待提醒 {reminders.upcoming.length} 条
          {next !== undefined && ` · 最近 ${formatDateTime(next.triggerAt, settings.timeZone)} ${next.title}`}
        </div>
      </div>

      <div className="card">
        <div className="muted">
          本地数据持久化：{persistent === null ? '未申请' : persistent ? '已授权' : '未授权（浏览器可能清理数据）'}
        </div>
      </div>
    </div>
  );
}
