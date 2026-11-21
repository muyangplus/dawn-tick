/**
 * 助手的 web 端动作：设置、学期统计、导入导出、快照、同步、检查更新与界面跳转。
 * 平台与界面能力都经 `AssistantHost`；密码与密钥既不读也不写，开机自启要系统确认，留在设置页。
 */
import {
  AiArgError,
  DOWNLOAD_SOURCE_CHOICES,
  LOG_LEVELS,
  MOTION_MODES,
  THEME_PRESETS,
  TODO_SORTS,
  VIEW_DAY_OPTIONS,
  WAL_MODES,
  WIDGET_BACKGROUNDS,
  WIDGET_VARIANTS,
  checkQuietHours,
  defineAction,
  isValidTimeZone,
  objectSchema,
  optBool,
  optEnum,
  parseQuietHours,
  reqDate,
  reqEnum,
  reqString,
  schema,
  type AiAction,
  type AiArgs,
  type AppSettings,
  type QuietHours,
} from '@dawn-tick/core';
import { SETTINGS_GROUP_IDS } from '../screens/settings-group-summaries.ts';
import { DEVICES_GROUP_IDS, type AssistantContext, type AssistantLanScope, type AssistantNavTarget } from './host.ts';

// ---- 设置 ----

type SettingKey = keyof AppSettings;

/** 不开放的设置：密码与密钥不读不写；开机自启要经系统注册 */
export const AI_HIDDEN_SETTINGS: readonly SettingKey[] = ['webdavPassword', 'aiApiKey'];
export const AI_LOCKED_SETTINGS: readonly SettingKey[] = [...AI_HIDDEN_SETTINGS, 'autoStart'];

interface SettingSpec {
  description: string;
  schema: Record<string, unknown>;
}

const bool = (description: string): SettingSpec => ({ description, schema: { type: 'boolean' } });
const choice = (description: string, values: readonly string[]): SettingSpec => ({ description, schema: { type: 'string', enum: [...values] } });

/** 开放给助手的设置项：说明给模型看，取值范围与设置页一致，写入时仍走 core 的校验。 */
const SETTING_SPECS: Partial<Record<SettingKey, SettingSpec>> = {
  timeZone: { description: '显示时区（IANA 名称，如 Asia/Shanghai）', schema: { type: 'string' } },
  autoTimeZone: bool('跟随系统时区'),
  viewDays: { description: '课表一屏显示几天', schema: { type: 'integer', enum: [...VIEW_DAY_OPTIONS] } },
  weekStartsToday: bool('课表从今天开始排；关闭则从本周周一开始'),
  hideWeekends: bool('课表隐藏周六周日'),
  theme: choice('明暗：light 浅色 / dark 深色 / system 跟随系统', ['light', 'dark', 'system']),
  themePreset: choice('配色方案', THEME_PRESETS),
  motion: choice('界面动效：system 跟随系统 / full 始终播放 / off 关闭', MOTION_MODES),
  widgetBackground: choice('小组件背景', WIDGET_BACKGROUNDS),
  startHidden: bool('开机自启时只驻留托盘'),
  showOtherWeeks: bool('周视图用虚线显示非本周课程'),
  classReminderEnabled: bool('课前提醒总开关'),
  classReminderMinutes: { description: '课前提醒提前分钟数（1-180）', schema: { type: 'integer', minimum: 1, maximum: 180 } },
  quietHours: {
    description: '勿扰时段：{enabled, mode: defer 顺延 | skip 跳过, rules: [{days: [1-7], start: "HH:MM", end: "HH:MM"}]}，整体替换',
    schema: { type: 'object' },
  },
  tomorrowPreview: bool('某天没有日程时提示明日预告'),
  semesterCountdown: bool('显示开学倒计时'),
  holidayCountdown: bool('显示下一个假期倒计时'),
  widgetVariant: choice('Windows 悬浮窗样式', WIDGET_VARIANTS),
  receiveBeta: { description: '接收测试版更新；null 跟随渠道默认', schema: { type: ['boolean', 'null'] } },
  autoCheckUpdate: bool('启动后自动检查更新'),
  releaseNotesOnUpdate: bool('更新后弹出新版本内容'),
  downloadSource: choice('更新下载源', DOWNLOAD_SOURCE_CHOICES),
  todoSort: choice('待办排序：start 按开始时间 / type 按类型', TODO_SORTS),
  devFeatures: bool('开发者特性'),
  logEnabled: bool('写诊断日志文件'),
  logLevel: choice('日志级别', LOG_LEVELS),
  walMode: choice('数据库日志模式（重启后生效）', WAL_MODES),
  autoBackup: bool('自动备份总开关'),
  backupOnStart: bool('启动时备份一次'),
  backupDaily: bool('每天备份一次'),
  backupKeep: { description: '保留快照份数（1-100）', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  webdavUrl: { description: 'WebDAV 目录地址', schema: { type: 'string' } },
  webdavUser: { description: 'WebDAV 用户名', schema: { type: 'string' } },
  webdavAuto: bool('WebDAV 自动同步总开关'),
  webdavOnStart: bool('启动时同步一次'),
  webdavDaily: bool('每天同步一次'),
  webdavHistory: bool('远端保留历史多份'),
  aiBaseUrl: { description: 'AI 接口地址', schema: { type: 'string' } },
  aiModel: { description: 'AI 模型名称', schema: { type: 'string' } },
};

const SETTING_KEYS = Object.keys(SETTING_SPECS) as SettingKey[];

/** 当前设置去掉密码与密钥。 */
export function visibleSettings(settings: AppSettings): Partial<AppSettings> {
  const result: Record<string, unknown> = { ...settings };
  for (const key of AI_HIDDEN_SETTINGS) delete result[key];
  return result as Partial<AppSettings>;
}

function settingValue(key: SettingKey, raw: unknown, current: AppSettings): unknown {
  const spec = SETTING_SPECS[key] as SettingSpec;
  const type = spec.schema['type'];
  const values = spec.schema['enum'] as readonly unknown[] | undefined;
  if (key === 'receiveBeta') {
    if (raw !== null && typeof raw !== 'boolean') throw new AiArgError('receiveBeta 应为 true、false 或 null');
    return raw;
  }
  if (key === 'quietHours') {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new AiArgError('quietHours 应为对象');
    const record = raw as Record<string, unknown>;
    const enabled = record['enabled'] ?? current.quietHours.enabled;
    if (typeof enabled !== 'boolean') throw new AiArgError('quietHours.enabled 应为 true 或 false');
    if (record['rules'] !== undefined && !Array.isArray(record['rules'])) throw new AiArgError('quietHours.rules 应为数组');
    // 先按原样校验：parseQuietHours 会静默丢掉坏规则、截断条数、退回旧的 mode
    const value = {
      enabled,
      mode: record['mode'] ?? current.quietHours.mode,
      rules: record['rules'] ?? current.quietHours.rules,
    } as QuietHours;
    const problem = checkQuietHours(value);
    if (problem !== null) throw new AiArgError(problem);
    return parseQuietHours(JSON.stringify(value), current.quietHours);
  }
  if (typeof raw === 'string') raw = raw.trim();
  if (type === 'boolean') {
    if (typeof raw !== 'boolean') throw new AiArgError(`${key} 应为 true 或 false`);
    return raw;
  }
  if (type === 'integer') {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) throw new AiArgError(`${key} 应为整数`);
  } else if (typeof raw !== 'string') {
    throw new AiArgError(`${key} 应为文本`);
  }
  if (values !== undefined && !values.includes(raw)) throw new AiArgError(`${key} 只能是 ${values.join(' / ')}`);
  const min = spec.schema['minimum'] as number | undefined;
  const max = spec.schema['maximum'] as number | undefined;
  if (typeof raw === 'number' && ((min !== undefined && raw < min) || (max !== undefined && raw > max))) {
    throw new AiArgError(`${key} 应在 ${min}-${max} 之间`);
  }
  if (key === 'timeZone' && !isValidTimeZone(raw as string)) throw new AiArgError(`无效的时区 ${String(raw)}`);
  return raw;
}

function shown(value: unknown): string {
  if (typeof value === 'boolean') return value ? '开' : '关';
  if (value === null) return '跟随默认';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export const getSettingsAction = defineAction<AssistantContext, null>({
  name: 'get_settings',
  description: '查看当前设置（不含密码与密钥）',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  run: async (_params, context) => visibleSettings(context.host.settings()),
});

export const updateSettingsAction = defineAction<AssistantContext, Partial<AppSettings>>({
  name: 'update_settings',
  description: '修改设置，只传要改的项；密码、密钥与开机自启不能在这里改',
  parameters: objectSchema(
    Object.fromEntries(SETTING_KEYS.map((key) => [key, { ...SETTING_SPECS[key]!.schema, description: SETTING_SPECS[key]!.description }])),
  ),
  risk: 'write',
  parse(args: AiArgs, context) {
    const current = context.host.settings();
    const patch: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(args)) {
      if (raw === undefined) continue;
      if ((AI_LOCKED_SETTINGS as readonly string[]).includes(key)) throw new AiArgError(`${key} 不能由助手修改，请到设置页操作`);
      if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new AiArgError(`没有设置项 ${key}`);
      const value = settingValue(key as SettingKey, raw, current);
      if (JSON.stringify(value) !== JSON.stringify(current[key as SettingKey])) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) throw new AiArgError('没有要改的设置，或与当前值相同');
    return patch as Partial<AppSettings>;
  },
  preview: (patch, context) => {
    const current = context.host.settings();
    const parts = Object.entries(patch).map(
      ([key, value]) => `${SETTING_SPECS[key as SettingKey]!.description.split(/[（：；]/)[0]}：${shown(current[key as SettingKey])} → ${shown(value)}`,
    );
    return `修改设置：${parts.join('；')}`;
  },
  async run(patch, context) {
    await context.host.patchSettings(patch);
    return `已修改 ${Object.keys(patch).length} 项设置`;
  },
});

export const semesterStatsAction = defineAction<AssistantContext, null>({
  name: 'semester_stats',
  description: '当前学期的统计：进度、已上与剩余课时、各课程进度、考试安排',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  async run(_params, context) {
    return (await context.host.semesterStats()) ?? { error: '还没有学期' };
  },
});

// ---- 导入导出 ----

const IMPORT_TEXT_LIMIT = 200_000;

export const importTextAction = defineAction<AssistantContext, string>({
  name: 'import_timetable_text',
  description: '把用户贴在对话里的课表原文（网页文本、表格、日历）送进导入流程，由用户在导入预览里确认；原文原样传入，不要改写',
  parameters: objectSchema({ text: schema.string('课表原文') }, ['text']),
  risk: 'write',
  parse(args) {
    const text = reqString(args, 'text');
    if (text.length > IMPORT_TEXT_LIMIT) throw new AiArgError('内容太长，请改用导入页的文件导入');
    return text;
  },
  preview: (text) => `打开导入预览（${text.length} 字）`,
  async run(text, context) {
    context.host.openImport(text);
    return '已打开导入预览';
  },
});

const EXPORT_KINDS = ['backup', 'ics', 'report'] as const;
type ExportKind = (typeof EXPORT_KINDS)[number];
const EXPORT_LABEL: Record<ExportKind, string> = { backup: '完整备份', ics: '日历文件（ICS）', report: '学期统计报表' };

export const exportFileAction = defineAction<AssistantContext, { kind: ExportKind; includeEvents: boolean }>({
  name: 'export_file',
  description: '导出文件：backup 完整备份 / ics 当前学期的日历文件 / report 当前学期统计报表（CSV）',
  parameters: objectSchema(
    {
      kind: schema.enumOf('导出什么', EXPORT_KINDS),
      includeEvents: schema.boolean('ics 是否带上日程，默认只导课表'),
    },
    ['kind'],
  ),
  risk: 'write',
  parse: (args) => ({ kind: reqEnum(args, 'kind', EXPORT_KINDS), includeEvents: optBool(args, 'includeEvents') ?? false }),
  preview: ({ kind, includeEvents }) => `导出${EXPORT_LABEL[kind]}${kind === 'ics' && includeEvents ? '（含日程）' : ''}`,
  run({ kind, includeEvents }, context) {
    if (kind === 'backup') return context.host.exportBackup();
    if (kind === 'ics') return context.host.exportIcs(includeEvents);
    return context.host.exportReport();
  },
});

// ---- 快照 ----

export const listSnapshotsAction = defineAction<AssistantContext, null>({
  name: 'list_snapshots',
  description: '列出本机快照（新的在前），恢复时用其中的 id',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  async run(_params, context) {
    const entries = await context.host.listSnapshots();
    return entries.map((entry) => ({ id: entry.id, createdAt: new Date(entry.createdAt).toISOString(), bytes: entry.bytes }));
  },
});

export const createSnapshotAction = defineAction<AssistantContext, null>({
  name: 'create_snapshot',
  description: '给本机数据做一份快照',
  parameters: objectSchema({}),
  risk: 'write',
  parse: () => null,
  preview: () => '做一份快照',
  run: (_params, context) => context.host.createSnapshot(),
});

export const restoreSnapshotAction = defineAction<AssistantContext, string>({
  name: 'restore_snapshot',
  description: '用一份快照覆盖本机全部数据（高危）',
  parameters: objectSchema({ id: schema.string('快照 id（list_snapshots 返回）') }, ['id']),
  risk: 'danger',
  async parse(args, context) {
    const id = reqString(args, 'id');
    const entries = await context.host.listSnapshots();
    if (!entries.some((entry) => entry.id === id)) throw new AiArgError(`找不到快照 ${id}`);
    return id;
  },
  preview: (id) => `用快照 ${id} 覆盖本机全部数据`,
  run: (id, context) => context.host.restoreSnapshot(id),
});

// ---- 同步 ----

function requireDav(context: AssistantContext): void {
  if (!context.host.webdavConfigured()) throw new AiArgError('还没有配置 WebDAV，先在 设备与同步 → WebDAV 填好地址与密码');
}

export const webdavUploadAction = defineAction<AssistantContext, null>({
  name: 'webdav_upload',
  description: '把本机数据打包上传到 WebDAV',
  parameters: objectSchema({}),
  risk: 'write',
  parse(_args, context) {
    requireDav(context);
    return null;
  },
  preview: () => '上传同步包到 WebDAV',
  run: (_params, context) => context.host.webdavUpload(),
});

const DOWNLOAD_MODES = ['all', 'settings'] as const;

export const webdavDownloadAction = defineAction<AssistantContext, 'all' | 'settings'>({
  name: 'webdav_download',
  description: '从 WebDAV 下载最新同步包：all 覆盖本机全部数据（高危）/ settings 只应用设置与预设',
  parameters: objectSchema({ mode: schema.enumOf('应用范围，默认 all', DOWNLOAD_MODES) }),
  risk: 'danger',
  parse(args, context) {
    requireDav(context);
    return optEnum(args, 'mode', DOWNLOAD_MODES) ?? 'all';
  },
  preview: (mode) => (mode === 'all' ? '从 WebDAV 下载并覆盖本机全部数据' : '从 WebDAV 下载并只应用设置'),
  run: (mode, context) => context.host.webdavDownload(mode),
});

export const listLanDevicesAction = defineAction<AssistantContext, null>({
  name: 'list_lan_devices',
  description: '列出已配对的局域网设备',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  async run(_params, context) {
    const devices = await context.host.lanDevices();
    return devices.map((device) => ({
      id: device.id,
      name: device.name,
      lastSyncAt: device.lastSyncAt === null ? null : new Date(device.lastSyncAt).toISOString(),
    }));
  },
});

const LAN_SCOPES: readonly AssistantLanScope[] = ['timetable', 'todos', 'settings'];

export const lanSyncAction = defineAction<AssistantContext, { device: { id: string; name: string }; scopes: AssistantLanScope[] }>({
  name: 'lan_sync',
  description: '从一台已配对的局域网设备拉取数据并合并进本机（按修改时间，新的为准）；不能配对新设备',
  parameters: objectSchema(
    {
      deviceId: schema.string('设备 id（list_lan_devices 返回）；只有一台时可不填'),
      scopes: { type: 'array', items: { type: 'string', enum: [...LAN_SCOPES] }, description: '同步范围，默认 timetable 与 todos' },
    },
  ),
  risk: 'write',
  async parse(args, context) {
    const devices = await context.host.lanDevices();
    if (devices.length === 0) throw new AiArgError('没有已配对的设备，配对要在 设备与同步 → 局域网同步 里操作');
    const id = args['deviceId'] === undefined || args['deviceId'] === null ? undefined : reqString(args, 'deviceId');
    const device = id === undefined ? (devices.length === 1 ? devices[0] : undefined) : devices.find((item) => item.id === id);
    if (device === undefined) throw new AiArgError(id === undefined ? '有多台已配对设备，要给出 deviceId' : `找不到设备 ${id}`);
    const raw = args['scopes'];
    let scopes: AssistantLanScope[] = ['timetable', 'todos'];
    if (raw !== undefined && raw !== null) {
      if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => !(LAN_SCOPES as readonly unknown[]).includes(item))) {
        throw new AiArgError(`scopes 应为 ${LAN_SCOPES.join(' / ')} 组成的非空数组`);
      }
      scopes = [...new Set(raw as AssistantLanScope[])];
    }
    return { device: { id: device.id, name: device.name }, scopes };
  },
  preview: ({ device, scopes }) => `从「${device.name}」同步：${scopes.map((scope) => ({ timetable: '课表', todos: '待办', settings: '设置' })[scope]).join('、')}`,
  run: ({ device, scopes }, context) => context.host.lanSync(device.id, scopes),
});

export const checkUpdateAction = defineAction<AssistantContext, null>({
  name: 'check_update',
  description: '检查有没有新版本（只检查，不安装）',
  parameters: objectSchema({}),
  risk: 'query',
  parse: () => null,
  preview: () => '',
  run: (_params, context) => context.host.checkUpdate(),
});

// ---- 界面 ----

const PAGES = ['timetable', 'schedule', 'settings', 'devices', 'help'] as const;

export const openPageAction = defineAction<AssistantContext, AssistantNavTarget>({
  name: 'open_page',
  description:
    '打开某个页面：timetable 课表 / schedule 日程 / settings 设置 / devices 设备与同步 / help 帮助；settings 与 devices 可带 group 直接打开分组',
  parameters: objectSchema(
    {
      page: schema.enumOf('页面', PAGES),
      group: schema.string(`分组。settings：${SETTINGS_GROUP_IDS.join(' / ')}；devices：${DEVICES_GROUP_IDS.join(' / ')}`),
    },
    ['page'],
  ),
  risk: 'query',
  parse(args) {
    const page = reqEnum(args, 'page', PAGES);
    if (page === 'settings') return { kind: 'settings', group: optEnum(args, 'group', SETTINGS_GROUP_IDS) ?? null };
    if (page === 'devices') return { kind: 'devices', group: optEnum(args, 'group', DEVICES_GROUP_IDS) ?? null };
    return { kind: 'page', page };
  },
  preview: () => '',
  async run(target, context) {
    context.host.navigate(target);
    return { done: '已打开' };
  },
});

export const showDateAction = defineAction<AssistantContext, AssistantNavTarget>({
  name: 'show_date',
  description: '课表跳到某一天：mode 为 day 看这一天，week 看这一天所在的一屏',
  parameters: objectSchema(
    { date: schema.date('日期'), mode: schema.enumOf('day 单日 / week 一屏，默认 week', ['day', 'week']) },
    ['date'],
  ),
  risk: 'query',
  parse: (args) => ({ kind: 'date', date: reqDate(args, 'date'), mode: optEnum(args, 'mode', ['day', 'week'] as const) ?? 'week' }),
  preview: () => '',
  async run(target, context) {
    context.host.navigate(target);
    return { done: '已跳转' };
  },
});

export const AI_APP_ACTIONS: readonly AiAction<AssistantContext>[] = [
  getSettingsAction,
  updateSettingsAction,
  semesterStatsAction,
  importTextAction,
  exportFileAction,
  listSnapshotsAction,
  createSnapshotAction,
  restoreSnapshotAction,
  webdavUploadAction,
  webdavDownloadAction,
  listLanDevicesAction,
  lanSyncAction,
  checkUpdateAction,
  openPageAction,
  showDateAction,
];
