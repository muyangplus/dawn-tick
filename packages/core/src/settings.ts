import { DEFAULT_TIME_ZONE } from './time.ts';
import type { Storage } from './storage.ts';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreset = 'vivid' | 'fresh' | 'mono' | 'muted';
export type WidgetBackground = 'light' | 'dark' | 'transparent';
/** Windows 悬浮窗样式 */
export type WidgetVariant = 'bar' | 'today' | 'minimal' | 'combo';
export const WIDGET_VARIANTS: readonly WidgetVariant[] = ['bar', 'today', 'minimal', 'combo'];

export const THEME_PRESETS: readonly ThemePreset[] = ['vivid', 'fresh', 'mono', 'muted'];
/** 周视图可显示的天数：1–7 天任意一天。 */
export const VIEW_DAY_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const WIDGET_BACKGROUNDS: readonly WidgetBackground[] = ['light', 'dark', 'transparent'];

/** 日志级别；dev 渠道默认 trace，其余默认 info。 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];

/** 待办排序方式：按开始时间、或按类型。 */
export type TodoSort = 'start' | 'type';
export const TODO_SORTS: readonly TodoSort[] = ['start', 'type'];

/** 数据库日志模式：auto 随存储位置（便携关、安装开），on 用 WAL，off 用单文件 DELETE。 */
export type WalMode = 'auto' | 'on' | 'off';
export const WAL_MODES: readonly WalMode[] = ['auto', 'on', 'off'];

/** 界面动效：system 跟随系统「减少动态效果」，full 始终播放，off 全部关闭。 */
export type MotionMode = 'system' | 'full' | 'off';
export const MOTION_MODES: readonly MotionMode[] = ['system', 'full', 'off'];
export const MOTION_LABEL: Record<MotionMode, string> = {
  system: '跟随系统',
  full: '始终播放',
  off: '关闭动效',
};

export interface AppSettings {
  timeZone: string;
  autoTimeZone: boolean;
  viewDays: number;
  /** 课表窗口以今天为第一天；关闭后从本周周一开头 */
  weekStartsToday: boolean;
  /** 课表窗口与一周概览跳过周六与周日 */
  hideWeekends: boolean;
  theme: ThemeMode;
  themePreset: ThemePreset;
  /** 界面动效：跟随系统 / 始终播放 / 关闭 */
  motion: MotionMode;
  widgetBackground: WidgetBackground;
  /** 注册开机自启 */
  autoStart: boolean;
  /** 开机自启时隐藏主窗口，仅驻留托盘 */
  startHidden: boolean;
  /** 周视图里用虚线显示非本周课程 */
  showOtherWeeks: boolean;
  /** 课前提醒总开关：未单独设置的课程按下面的分钟数提醒 */
  classReminderEnabled: boolean;
  /** 课前提醒默认提前分钟数 */
  classReminderMinutes: number;
  /** 某天没有日程时提示明日预告 */
  tomorrowPreview: boolean;
  /** 显示开学倒计时 */
  semesterCountdown: boolean;
  /** 显示下一个假期倒计时 */
  holidayCountdown: boolean;
  /** Windows 悬浮窗样式 */
  widgetVariant: WidgetVariant;
  /** 是否接收测试版更新；null 表示未设置（beta 渠道默认开，其余默认关） */
  receiveBeta: boolean | null;
  /** 启动后自动检查一次版本更新 */
  autoCheckUpdate: boolean;
  /** 待办排序：按开始时间 / 按类型 */
  todoSort: TodoSort;
  /** 开发者特性：默认关闭；打开后按开发版特性运行（更新渠道不受影响） */
  devFeatures: boolean;
  /** 应用诊断日志：是否写 dawn-tick.log */
  logEnabled: boolean;
  /** 日志级别：error / warn / info / debug / trace */
  logLevel: LogLevel;
  /** 数据库日志模式：auto / on / off */
  walMode: WalMode;
  /** 自动备份总开关 */
  autoBackup: boolean;
  /** 启动时备份一次 */
  backupOnStart: boolean;
  /** 每天备份一次 */
  backupDaily: boolean;
  /** 保留最近多少份快照 */
  backupKeep: number;
  /** WebDAV 目录地址（完整 URL） */
  webdavUrl: string;
  webdavUser: string;
  /** WebDAV 密码：只存本机，不参与导出 */
  webdavPassword: string;
  /** 自动同步总开关 */
  webdavAuto: boolean;
  /** 启动时同步一次 */
  webdavOnStart: boolean;
  /** 每天同步一次 */
  webdavDaily: boolean;
  /** 远端保留历史多份（关闭时固定文件名覆盖） */
  webdavHistory: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  timeZone: DEFAULT_TIME_ZONE,
  autoTimeZone: false,
  viewDays: 5,
  weekStartsToday: true,
  hideWeekends: false,
  theme: 'system',
  themePreset: 'vivid',
  motion: 'system',
  widgetBackground: 'light',
  autoStart: false,
  startHidden: true,
  showOtherWeeks: true,
  classReminderEnabled: true,
  classReminderMinutes: 20,
  tomorrowPreview: true,
  semesterCountdown: true,
  holidayCountdown: true,
  widgetVariant: 'bar',
  receiveBeta: null,
  autoCheckUpdate: true,
  todoSort: 'start',
  devFeatures: false,
  logEnabled: true,
  logLevel: 'info',
  walMode: 'auto',
  autoBackup: true,
  backupOnStart: true,
  backupDaily: true,
  backupKeep: 10,
  webdavUrl: '',
  webdavUser: '',
  webdavPassword: '',
  webdavAuto: false,
  webdavOnStart: true,
  webdavDaily: true,
  webdavHistory: false,
};

/** 快照保留份数的取值范围。 */
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 100;

/** 数据库日志模式的存储键；开启数据库前要先读它。 */
export const WAL_META_KEY = 'wal_mode';

const KEYS = {
  timeZone: 'time_zone',
  autoTimeZone: 'auto_time_zone',
  viewDays: 'view_days',
  weekStartsToday: 'week_starts_today',
  hideWeekends: 'hide_weekends',
  theme: 'theme',
  themePreset: 'theme_preset',
  motion: 'motion',
  widgetBackground: 'widget_background',
  autoStart: 'auto_start',
  startHidden: 'start_hidden',
  showOtherWeeks: 'show_other_weeks',
  classReminderEnabled: 'class_reminder_enabled',
  classReminderMinutes: 'class_reminder_minutes',
  tomorrowPreview: 'tomorrow_preview',
  semesterCountdown: 'semester_countdown',
  holidayCountdown: 'holiday_countdown',
  widgetVariant: 'widget_variant',
  receiveBeta: 'receive_beta',
  autoCheckUpdate: 'auto_check_update',
  todoSort: 'todo_sort',
  devFeatures: 'dev_features',
  logEnabled: 'log_enabled',
  logLevel: 'log_level',
  walMode: WAL_META_KEY,
  autoBackup: 'auto_backup',
  backupOnStart: 'backup_on_start',
  backupDaily: 'backup_daily',
  backupKeep: 'backup_keep',
  webdavUrl: 'webdav_url',
  webdavUser: 'webdav_user',
  webdavPassword: 'webdav_password',
  webdavAuto: 'webdav_auto',
  webdavOnStart: 'webdav_on_start',
  webdavDaily: 'webdav_daily',
  webdavHistory: 'webdav_history',
} as const;

/** 设置项的全部存储键；备份键清单由它派生，避免两处手抄漂移。 */
export const SETTING_META_KEYS: readonly string[] = Object.values(KEYS);

/** 不进备份导出的设置键：备份文件可能被分享出去。 */
export const EXPORT_EXCLUDED_KEYS: readonly string[] = ['webdav_password'];

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
    storage.readMeta(KEYS.weekStartsToday),
    storage.readMeta(KEYS.hideWeekends),
    storage.readMeta(KEYS.theme),
    storage.readMeta(KEYS.themePreset),
    storage.readMeta(KEYS.motion),
    storage.readMeta(KEYS.widgetBackground),
    storage.readMeta(KEYS.autoStart),
    storage.readMeta(KEYS.startHidden),
    storage.readMeta(KEYS.showOtherWeeks),
    storage.readMeta(KEYS.classReminderEnabled),
    storage.readMeta(KEYS.classReminderMinutes),
    storage.readMeta(KEYS.tomorrowPreview),
    storage.readMeta(KEYS.semesterCountdown),
    storage.readMeta(KEYS.holidayCountdown),
    storage.readMeta(KEYS.widgetVariant),
    storage.readMeta(KEYS.receiveBeta),
    storage.readMeta(KEYS.autoCheckUpdate),
    storage.readMeta(KEYS.todoSort),
    storage.readMeta(KEYS.devFeatures),
    storage.readMeta(KEYS.logEnabled),
    storage.readMeta(KEYS.logLevel),
    storage.readMeta(KEYS.walMode),
    storage.readMeta(KEYS.autoBackup),
    storage.readMeta(KEYS.backupOnStart),
    storage.readMeta(KEYS.backupDaily),
    storage.readMeta(KEYS.backupKeep),
    storage.readMeta(KEYS.webdavUrl),
    storage.readMeta(KEYS.webdavUser),
    storage.readMeta(KEYS.webdavPassword),
    storage.readMeta(KEYS.webdavAuto),
    storage.readMeta(KEYS.webdavOnStart),
    storage.readMeta(KEYS.webdavDaily),
    storage.readMeta(KEYS.webdavHistory),
  ]);
  const [
    timeZone,
    autoTimeZone,
    viewDays,
    weekStartsToday,
    hideWeekends,
    theme,
    themePreset,
    motion,
    widgetBackground,
    autoStart,
    startHidden,
    showOtherWeeks,
    classReminderEnabled,
    classReminderMinutes,
    tomorrowPreview,
    semesterCountdown,
    holidayCountdown,
    widgetVariant,
    receiveBeta,
    autoCheckUpdate,
    todoSort,
    devFeatures,
    logEnabled,
    logLevel,
    walMode,
    autoBackup,
    backupOnStart,
    backupDaily,
    backupKeep,
    webdavUrl,
    webdavUser,
    webdavPassword,
    webdavAuto,
    webdavOnStart,
    webdavDaily,
    webdavHistory,
  ] = entries;
  const parsedDays = Number(viewDays);
  const parsedMinutes = Number(classReminderMinutes);
  const parsedKeep = Number(backupKeep);

  return {
    timeZone: timeZone ?? DEFAULT_SETTINGS.timeZone,
    autoTimeZone: parseBoolean(autoTimeZone, DEFAULT_SETTINGS.autoTimeZone),
    viewDays: VIEW_DAY_OPTIONS.includes(parsedDays) ? parsedDays : DEFAULT_SETTINGS.viewDays,
    weekStartsToday: parseBoolean(weekStartsToday, DEFAULT_SETTINGS.weekStartsToday),
    hideWeekends: parseBoolean(hideWeekends, DEFAULT_SETTINGS.hideWeekends),
    theme:
      theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULT_SETTINGS.theme,
    themePreset:
      themePreset !== undefined && (THEME_PRESETS as readonly string[]).includes(themePreset)
        ? (themePreset as ThemePreset)
        : DEFAULT_SETTINGS.themePreset,
    motion:
      motion !== undefined && (MOTION_MODES as readonly string[]).includes(motion)
        ? (motion as MotionMode)
        : DEFAULT_SETTINGS.motion,
    widgetBackground:
      widgetBackground !== undefined && (WIDGET_BACKGROUNDS as readonly string[]).includes(widgetBackground)
        ? (widgetBackground as WidgetBackground)
        : DEFAULT_SETTINGS.widgetBackground,
    autoStart: parseBoolean(autoStart, DEFAULT_SETTINGS.autoStart),
    startHidden: parseBoolean(startHidden, DEFAULT_SETTINGS.startHidden),
    showOtherWeeks: parseBoolean(showOtherWeeks, DEFAULT_SETTINGS.showOtherWeeks),
    classReminderEnabled: parseBoolean(classReminderEnabled, DEFAULT_SETTINGS.classReminderEnabled),
    classReminderMinutes:
      Number.isFinite(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= 180
        ? Math.round(parsedMinutes)
        : DEFAULT_SETTINGS.classReminderMinutes,
    tomorrowPreview: parseBoolean(tomorrowPreview, DEFAULT_SETTINGS.tomorrowPreview),
    semesterCountdown: parseBoolean(semesterCountdown, DEFAULT_SETTINGS.semesterCountdown),
    holidayCountdown: parseBoolean(holidayCountdown, DEFAULT_SETTINGS.holidayCountdown),
    widgetVariant:
      widgetVariant !== undefined && (WIDGET_VARIANTS as readonly string[]).includes(widgetVariant)
        ? (widgetVariant as WidgetVariant)
        : DEFAULT_SETTINGS.widgetVariant,
    receiveBeta:
      receiveBeta === '1' || receiveBeta === 'true' ? true : receiveBeta === '0' || receiveBeta === 'false' ? false : null,
    autoCheckUpdate: parseBoolean(autoCheckUpdate, DEFAULT_SETTINGS.autoCheckUpdate),
    todoSort:
      todoSort !== undefined && (TODO_SORTS as readonly string[]).includes(todoSort)
        ? (todoSort as TodoSort)
        : DEFAULT_SETTINGS.todoSort,
    devFeatures: parseBoolean(devFeatures, DEFAULT_SETTINGS.devFeatures),
    logEnabled: parseBoolean(logEnabled, DEFAULT_SETTINGS.logEnabled),
    logLevel:
      logLevel !== undefined && (LOG_LEVELS as readonly string[]).includes(logLevel)
        ? (logLevel as LogLevel)
        : DEFAULT_SETTINGS.logLevel,
    walMode:
      walMode !== undefined && (WAL_MODES as readonly string[]).includes(walMode)
        ? (walMode as WalMode)
        : DEFAULT_SETTINGS.walMode,
    autoBackup: parseBoolean(autoBackup, DEFAULT_SETTINGS.autoBackup),
    backupOnStart: parseBoolean(backupOnStart, DEFAULT_SETTINGS.backupOnStart),
    backupDaily: parseBoolean(backupDaily, DEFAULT_SETTINGS.backupDaily),
    backupKeep:
      Number.isFinite(parsedKeep) && parsedKeep >= BACKUP_KEEP_MIN && parsedKeep <= BACKUP_KEEP_MAX
        ? Math.round(parsedKeep)
        : DEFAULT_SETTINGS.backupKeep,
    webdavUrl: (webdavUrl ?? '').trim(),
    webdavUser: (webdavUser ?? '').trim(),
    webdavPassword: webdavPassword ?? '',
    webdavAuto: parseBoolean(webdavAuto, DEFAULT_SETTINGS.webdavAuto),
    webdavOnStart: parseBoolean(webdavOnStart, DEFAULT_SETTINGS.webdavOnStart),
    webdavDaily: parseBoolean(webdavDaily, DEFAULT_SETTINGS.webdavDaily),
    webdavHistory: parseBoolean(webdavHistory, DEFAULT_SETTINGS.webdavHistory),
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
  if (patch.weekStartsToday !== undefined) {
    await storage.writeMeta(KEYS.weekStartsToday, patch.weekStartsToday ? '1' : '0');
  }
  if (patch.hideWeekends !== undefined) {
    await storage.writeMeta(KEYS.hideWeekends, patch.hideWeekends ? '1' : '0');
  }
  if (patch.theme !== undefined) await storage.writeMeta(KEYS.theme, patch.theme);
  if (patch.themePreset !== undefined) await storage.writeMeta(KEYS.themePreset, patch.themePreset);
  if (patch.motion !== undefined) await storage.writeMeta(KEYS.motion, patch.motion);
  if (patch.widgetBackground !== undefined) {
    await storage.writeMeta(KEYS.widgetBackground, patch.widgetBackground);
  }
  if (patch.autoStart !== undefined) await storage.writeMeta(KEYS.autoStart, patch.autoStart ? '1' : '0');
  if (patch.startHidden !== undefined) {
    await storage.writeMeta(KEYS.startHidden, patch.startHidden ? '1' : '0');
  }
  if (patch.showOtherWeeks !== undefined) {
    await storage.writeMeta(KEYS.showOtherWeeks, patch.showOtherWeeks ? '1' : '0');
  }
  if (patch.classReminderEnabled !== undefined) {
    await storage.writeMeta(KEYS.classReminderEnabled, patch.classReminderEnabled ? '1' : '0');
  }
  if (patch.classReminderMinutes !== undefined) {
    if (!Number.isFinite(patch.classReminderMinutes) || patch.classReminderMinutes < 1 || patch.classReminderMinutes > 180) {
      throw new RangeError('提醒提前分钟数需要在 1 到 180 之间');
    }
    await storage.writeMeta(KEYS.classReminderMinutes, String(Math.round(patch.classReminderMinutes)));
  }
  if (patch.tomorrowPreview !== undefined) {
    await storage.writeMeta(KEYS.tomorrowPreview, patch.tomorrowPreview ? '1' : '0');
  }
  if (patch.semesterCountdown !== undefined) {
    await storage.writeMeta(KEYS.semesterCountdown, patch.semesterCountdown ? '1' : '0');
  }
  if (patch.holidayCountdown !== undefined) {
    await storage.writeMeta(KEYS.holidayCountdown, patch.holidayCountdown ? '1' : '0');
  }
  if (patch.widgetVariant !== undefined) {
    await storage.writeMeta(KEYS.widgetVariant, patch.widgetVariant);
  }
  if (patch.receiveBeta !== undefined && patch.receiveBeta !== null) {
    await storage.writeMeta(KEYS.receiveBeta, patch.receiveBeta ? '1' : '0');
  }
  if (patch.autoCheckUpdate !== undefined) {
    await storage.writeMeta(KEYS.autoCheckUpdate, patch.autoCheckUpdate ? '1' : '0');
  }
  if (patch.todoSort !== undefined) {
    if (!(TODO_SORTS as readonly string[]).includes(patch.todoSort)) {
      throw new RangeError(`待办排序只能是 ${TODO_SORTS.join(' / ')}`);
    }
    await storage.writeMeta(KEYS.todoSort, patch.todoSort);
  }
  if (patch.devFeatures !== undefined) {
    await storage.writeMeta(KEYS.devFeatures, patch.devFeatures ? '1' : '0');
  }
  if (patch.logEnabled !== undefined) {
    await storage.writeMeta(KEYS.logEnabled, patch.logEnabled ? '1' : '0');
  }
  if (patch.logLevel !== undefined) {
    if (!(LOG_LEVELS as readonly string[]).includes(patch.logLevel)) {
      throw new RangeError(`日志级别只能是 ${LOG_LEVELS.join(' / ')}`);
    }
    await storage.writeMeta(KEYS.logLevel, patch.logLevel);
  }
  if (patch.walMode !== undefined) {
    if (!(WAL_MODES as readonly string[]).includes(patch.walMode)) {
      throw new RangeError(`数据库日志模式只能是 ${WAL_MODES.join(' / ')}`);
    }
    await storage.writeMeta(KEYS.walMode, patch.walMode);
  }
  if (patch.autoBackup !== undefined) {
    await storage.writeMeta(KEYS.autoBackup, patch.autoBackup ? '1' : '0');
  }
  if (patch.backupOnStart !== undefined) {
    await storage.writeMeta(KEYS.backupOnStart, patch.backupOnStart ? '1' : '0');
  }
  if (patch.backupDaily !== undefined) {
    await storage.writeMeta(KEYS.backupDaily, patch.backupDaily ? '1' : '0');
  }
  if (patch.backupKeep !== undefined) {
    if (
      !Number.isFinite(patch.backupKeep) ||
      patch.backupKeep < BACKUP_KEEP_MIN ||
      patch.backupKeep > BACKUP_KEEP_MAX
    ) {
      throw new RangeError(`保留份数需要在 ${BACKUP_KEEP_MIN} 到 ${BACKUP_KEEP_MAX} 之间`);
    }
    await storage.writeMeta(KEYS.backupKeep, String(Math.round(patch.backupKeep)));
  }
  if (patch.webdavUrl !== undefined) await storage.writeMeta(KEYS.webdavUrl, patch.webdavUrl.trim());
  if (patch.webdavUser !== undefined) await storage.writeMeta(KEYS.webdavUser, patch.webdavUser.trim());
  if (patch.webdavPassword !== undefined) {
    await storage.writeMeta(KEYS.webdavPassword, patch.webdavPassword);
  }
  if (patch.webdavAuto !== undefined) {
    await storage.writeMeta(KEYS.webdavAuto, patch.webdavAuto ? '1' : '0');
  }
  if (patch.webdavOnStart !== undefined) {
    await storage.writeMeta(KEYS.webdavOnStart, patch.webdavOnStart ? '1' : '0');
  }
  if (patch.webdavDaily !== undefined) {
    await storage.writeMeta(KEYS.webdavDaily, patch.webdavDaily ? '1' : '0');
  }
  if (patch.webdavHistory !== undefined) {
    await storage.writeMeta(KEYS.webdavHistory, patch.webdavHistory ? '1' : '0');
  }

  return readSettings(storage);
}
