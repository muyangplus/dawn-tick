import { DEFAULT_TIME_ZONE } from './time.ts';
import type { Storage } from './storage.ts';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreset = 'vivid' | 'fresh' | 'mono' | 'muted';
export type WidgetBackground = 'light' | 'dark' | 'transparent';

export const THEME_PRESETS: readonly ThemePreset[] = ['vivid', 'fresh', 'mono', 'muted'];
export const VIEW_DAY_OPTIONS: readonly number[] = [5, 6, 7];
export const WIDGET_BACKGROUNDS: readonly WidgetBackground[] = ['light', 'dark', 'transparent'];

export interface AppSettings {
  timeZone: string;
  autoTimeZone: boolean;
  viewDays: number;
  theme: ThemeMode;
  themePreset: ThemePreset;
  widgetBackground: WidgetBackground;
}

export const DEFAULT_SETTINGS: AppSettings = {
  timeZone: DEFAULT_TIME_ZONE,
  autoTimeZone: false,
  viewDays: 5,
  theme: 'system',
  themePreset: 'vivid',
  widgetBackground: 'light',
};

const KEYS = {
  timeZone: 'time_zone',
  autoTimeZone: 'auto_time_zone',
  viewDays: 'view_days',
  theme: 'theme',
  themePreset: 'theme_preset',
  widgetBackground: 'widget_background',
} as const;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

export async function readSettings(storage: Storage): Promise<AppSettings> {
  const entries = await Promise.all([
    storage.readMeta(KEYS.timeZone),
    storage.readMeta(KEYS.autoTimeZone),
    storage.readMeta(KEYS.viewDays),
    storage.readMeta(KEYS.theme),
    storage.readMeta(KEYS.themePreset),
    storage.readMeta(KEYS.widgetBackground),
  ]);
  const [timeZone, autoTimeZone, viewDays, theme, themePreset, widgetBackground] = entries;
  const parsedDays = Number(viewDays);

  return {
    timeZone: timeZone ?? DEFAULT_SETTINGS.timeZone,
    autoTimeZone: parseBoolean(autoTimeZone, DEFAULT_SETTINGS.autoTimeZone),
    viewDays: VIEW_DAY_OPTIONS.includes(parsedDays) ? parsedDays : DEFAULT_SETTINGS.viewDays,
    theme:
      theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULT_SETTINGS.theme,
    themePreset:
      themePreset !== undefined && (THEME_PRESETS as readonly string[]).includes(themePreset)
        ? (themePreset as ThemePreset)
        : DEFAULT_SETTINGS.themePreset,
    widgetBackground:
      widgetBackground !== undefined && (WIDGET_BACKGROUNDS as readonly string[]).includes(widgetBackground)
        ? (widgetBackground as WidgetBackground)
        : DEFAULT_SETTINGS.widgetBackground,
  };
}

export async function writeSettings(storage: Storage, patch: Partial<AppSettings>): Promise<AppSettings> {
  if (patch.viewDays !== undefined && !VIEW_DAY_OPTIONS.includes(patch.viewDays)) {
    throw new RangeError(`周视图天数只能是 ${VIEW_DAY_OPTIONS.join(' / ')}`);
  }
  if (patch.timeZone !== undefined && patch.timeZone.length === 0) {
    throw new RangeError('时区不能为空');
  }
  if (
    patch.widgetBackground !== undefined &&
    !(WIDGET_BACKGROUNDS as readonly string[]).includes(patch.widgetBackground)
  ) {
    throw new RangeError(`小组件背景只能是 ${WIDGET_BACKGROUNDS.join(' / ')}`);
  }

  if (patch.timeZone !== undefined) await storage.writeMeta(KEYS.timeZone, patch.timeZone);
  if (patch.autoTimeZone !== undefined) {
    await storage.writeMeta(KEYS.autoTimeZone, patch.autoTimeZone ? '1' : '0');
  }
  if (patch.viewDays !== undefined) await storage.writeMeta(KEYS.viewDays, String(patch.viewDays));
  if (patch.theme !== undefined) await storage.writeMeta(KEYS.theme, patch.theme);
  if (patch.themePreset !== undefined) await storage.writeMeta(KEYS.themePreset, patch.themePreset);
  if (patch.widgetBackground !== undefined) {
    await storage.writeMeta(KEYS.widgetBackground, patch.widgetBackground);
  }

  return readSettings(storage);
}
