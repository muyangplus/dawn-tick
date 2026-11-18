import { checkQuietHours, DEFAULT_QUIET_HOURS, encodeQuietHours, parseQuietHours, type QuietHours } from './quiet-hours.ts';
import { DEFAULT_TIME_ZONE } from './time.ts';
import type { Storage } from './storage.ts';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreset = 'vivid' | 'fresh' | 'mono' | 'muted';
export type WidgetBackground = 'light' | 'dark' | 'transparent';
/** Windows 悬浮窗样式 */
export type WidgetVariant = 'bar' | 'today' | 'minimal' | 'combo' | 'exam';
export const WIDGET_VARIANTS: readonly WidgetVariant[] = ['bar', 'today', 'minimal', 'combo', 'exam'];
/** 悬浮窗样式选择器的中文名；新增样式时只改这里，设置页与测试同源。 */
export const WIDGET_VARIANT_LABEL: Record<WidgetVariant, string> = {
  bar: '紧凑条：下一节课 + 倒计时',
  today: '今日课表：今天的课，当前课高亮',
  minimal: '极简数字：只显示大号倒计时',
  combo: '组合卡：下一节课 + 待办作业',
  exam: '考试倒计时：下一场考试 + 剩余天数',
};

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

/** 更新下载源：auto 自动探测延迟，gitee 国内镜像，github 国际源。 */
export type DownloadSourceChoice = 'auto' | 'gitee' | 'github';
export const DOWNLOAD_SOURCE_CHOICES: readonly DownloadSourceChoice[] = ['auto', 'gitee', 'github'];
export const DOWNLOAD_SOURCE_CHOICE_LABEL: Record<DownloadSourceChoice, string> = {
  auto: '自动检测',
  gitee: '国内（Gitee）',
  github: '国际（GitHub）',
};

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
  /** 勿扰时段：按星期的时段，内含的提醒顺延或跳过 */
  quietHours: QuietHours;
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
  /** 更新到新版本后弹出新版本内容 */
  releaseNotesOnUpdate: boolean;
  /** 更新下载源：自动探测 / 国内 Gitee / 国际 GitHub；旧库缺键按 auto */
  downloadSource: DownloadSourceChoice;
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
  /** WebDAV 密码：`enc:v1:` 信封（平台密钥加密），旧版明文读取时自动迁移；只存本机，不参与导出 */
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
  /** 新安装默认 5 天：一周工作日，列宽最宽；存量用户已落库的值不受影响 */
  viewDays: 5,
  weekStartsToday: true,
  /** 新安装默认不显示周末；存量用户显式存过的 0/1 优先 */
  hideWeekends: true,
  theme: 'system',
  themePreset: 'vivid',
  motion: 'system',
  widgetBackground: 'light',
  autoStart: false,
  startHidden: true,
  showOtherWeeks: true,
  classReminderEnabled: true,
  classReminderMinutes: 20,
  quietHours: DEFAULT_QUIET_HOURS,
  tomorrowPreview: true,
  semesterCountdown: true,
  holidayCountdown: true,
  widgetVariant: 'bar',
  receiveBeta: null,
  autoCheckUpdate: true,
  releaseNotesOnUpdate: true,
  downloadSource: 'auto',
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

/** 一个设置项：存在 app_meta 的哪个键、怎么从字符串读回、怎么写成字符串、写之前怎么校验。 */
interface SettingField<V> {
  key: string;
  /** 读回：值缺失或不合法时用默认值 */
  parse: (raw: string | undefined, fallback: V) => V;
  /** 写入：返回 null 表示不写（例如「跟随渠道」的 receiveBeta） */
  encode: (value: V) => string | null;
  /** 写之前校验，返回错误文案；所有字段校验通过后才开始写，不会只写一半 */
  check?: (value: V) => string | null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

function flag(key: string): SettingField<boolean> {
  return { key, parse: parseBoolean, encode: (value) => (value ? '1' : '0') };
}

function oneOf<V extends string>(key: string, options: readonly V[], label: string): SettingField<V> {
  return {
    key,
    parse: (raw, fallback) => (raw !== undefined && (options as readonly string[]).includes(raw) ? (raw as V) : fallback),
    encode: (value) => value,
    check: (value) => ((options as readonly string[]).includes(value) ? null : `${label}只能是 ${options.join(' / ')}`),
  };
}

function intRange(key: string, min: number, max: number, message: string): SettingField<number> {
  return {
    key,
    parse: (raw, fallback) => {
      const parsed = Number(raw);
      return raw !== undefined && Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed) : fallback;
    },
    encode: (value) => String(Math.round(value)),
    check: (value) => (Number.isFinite(value) && value >= min && value <= max ? null : message),
  };
}

function text(key: string, trim: boolean): SettingField<string> {
  return {
    key,
    parse: (raw) => (trim ? (raw ?? '').trim() : (raw ?? '')),
    encode: (value) => (trim ? value.trim() : value),
  };
}

/** 全部设置项，顺序即 `SETTING_META_KEYS` 的顺序。 */
const FIELDS: { readonly [K in keyof AppSettings]: SettingField<AppSettings[K]> } = {
  timeZone: {
    key: 'time_zone',
    parse: (raw, fallback) => raw ?? fallback,
    encode: (value) => value,
    check: (value) => (value.length === 0 ? '时区不能为空' : null),
  },
  autoTimeZone: flag('auto_time_zone'),
  viewDays: {
    key: 'view_days',
    parse: (raw, fallback) => (VIEW_DAY_OPTIONS.includes(Number(raw)) ? Number(raw) : fallback),
    encode: (value) => String(value),
    check: (value) => (VIEW_DAY_OPTIONS.includes(value) ? null : `周视图天数只能是 ${VIEW_DAY_OPTIONS.join(' / ')}`),
  },
  weekStartsToday: flag('week_starts_today'),
  hideWeekends: flag('hide_weekends'),
  theme: oneOf<ThemeMode>('theme', ['light', 'dark', 'system'], '主题'),
  themePreset: oneOf('theme_preset', THEME_PRESETS, '配色'),
  motion: oneOf('motion', MOTION_MODES, '动效'),
  widgetBackground: oneOf('widget_background', WIDGET_BACKGROUNDS, '小组件背景'),
  autoStart: flag('auto_start'),
  startHidden: flag('start_hidden'),
  showOtherWeeks: flag('show_other_weeks'),
  classReminderEnabled: flag('class_reminder_enabled'),
  classReminderMinutes: intRange('class_reminder_minutes', 1, 180, '提醒提前分钟数需要在 1 到 180 之间'),
  quietHours: { key: 'quiet_hours', parse: parseQuietHours, encode: encodeQuietHours, check: checkQuietHours },
  tomorrowPreview: flag('tomorrow_preview'),
  semesterCountdown: flag('semester_countdown'),
  holidayCountdown: flag('holiday_countdown'),
  widgetVariant: oneOf('widget_variant', WIDGET_VARIANTS, '悬浮窗样式'),
  receiveBeta: {
    key: 'receive_beta',
    // 没设置过是 null：跟随当前渠道
    parse: (raw) => (raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : null),
    encode: (value) => (value === null ? null : value ? '1' : '0'),
  },
  autoCheckUpdate: flag('auto_check_update'),
  releaseNotesOnUpdate: flag('release_notes_on_update'),
  downloadSource: oneOf('download_source', DOWNLOAD_SOURCE_CHOICES, '下载源'),
  todoSort: oneOf('todo_sort', TODO_SORTS, '待办排序'),
  devFeatures: flag('dev_features'),
  logEnabled: flag('log_enabled'),
  logLevel: oneOf('log_level', LOG_LEVELS, '日志级别'),
  walMode: oneOf(WAL_META_KEY, WAL_MODES, '数据库日志模式'),
  autoBackup: flag('auto_backup'),
  backupOnStart: flag('backup_on_start'),
  backupDaily: flag('backup_daily'),
  backupKeep: intRange('backup_keep', BACKUP_KEEP_MIN, BACKUP_KEEP_MAX, `保留份数需要在 ${BACKUP_KEEP_MIN} 到 ${BACKUP_KEEP_MAX} 之间`),
  webdavUrl: text('webdav_url', true),
  webdavUser: text('webdav_user', true),
  webdavPassword: text('webdav_password', false),
  webdavAuto: flag('webdav_auto'),
  webdavOnStart: flag('webdav_on_start'),
  webdavDaily: flag('webdav_daily'),
  webdavHistory: flag('webdav_history'),
};

const FIELD_ENTRIES = Object.entries(FIELDS) as Array<[keyof AppSettings, SettingField<unknown>]>;

export const SETTING_META_KEYS: readonly string[] = FIELD_ENTRIES.map(([, field]) => field.key);

/**
 * 不进备份导出的设置键：备份文件可能被分享出去（WebDAV 密码），
 * 以及只对本机有意义的项（数据库日志模式、开机自启、启动时隐藏）——带到另一台设备会改动那台的系统行为。
 */
export const DEVICE_LOCAL_KEYS: readonly string[] = [WAL_META_KEY, 'auto_start', 'start_hidden'];
export const EXPORT_EXCLUDED_KEYS: readonly string[] = ['webdav_password', ...DEVICE_LOCAL_KEYS];
/** 局域网同步另外不带 WebDAV 地址与用户名：密码不随行，带过去只会得到一份配不全的 WebDAV。 */
export const LAN_EXCLUDED_KEYS: readonly string[] = ['webdav_url', 'webdav_user'];

export async function readSettings(storage: Storage): Promise<AppSettings> {
  const values = await Promise.all(FIELD_ENTRIES.map(([, field]) => storage.readMeta(field.key)));
  const settings: Record<string, unknown> = {};
  FIELD_ENTRIES.forEach(([name, field], index) => {
    settings[name] = field.parse(values[index], DEFAULT_SETTINGS[name]);
  });
  return settings as unknown as AppSettings;
}

export async function writeSettings(storage: Storage, patch: Partial<AppSettings>): Promise<AppSettings> {
  const writes: Array<[string, string]> = [];
  for (const [name, field] of FIELD_ENTRIES) {
    const value = patch[name];
    if (value === undefined) continue;
    const problem = field.check?.(value) ?? null;
    if (problem !== null) throw new RangeError(problem);
    const encoded = field.encode(value);
    if (encoded !== null) writes.push([field.key, encoded]);
  }
  for (const [key, value] of writes) await storage.writeMeta(key, value);
  return readSettings(storage);
}
