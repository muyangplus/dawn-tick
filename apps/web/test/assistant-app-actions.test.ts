import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiArgError,
  DEFAULT_SETTINGS,
  checkQuietHours,
  executePlan,
  findAction,
  runAssistantTurn,
  validatedStorage,
  type AiArgs,
  type AiChatReply,
  type AiClient,
  type AiToolCall,
  type AppSettings,
  type QuietHours,
} from '@dawn-tick/core';
import { createStorage } from '@dawn-tick/core/testing';
import { AI_APP_ACTIONS } from '../src/assistant/actions-app.ts';
import type {
  AssistantContext,
  AssistantHost,
  AssistantLanDevice,
  AssistantLanScope,
  AssistantNavTarget,
  AssistantSnapshot,
} from '../src/assistant/host.ts';

const NOW = Date.UTC(2026, 10, 21, 2, 0);

type Call = [method: string, ...args: unknown[]];

interface FakeOptions {
  settings?: Partial<AppSettings>;
  snapshots?: AssistantSnapshot[];
  devices?: AssistantLanDevice[];
  webdav?: boolean;
  stats?: unknown;
  update?: unknown;
  /** 这些方法被调用时抛错 */
  failOn?: readonly string[];
}

interface FakeHost extends AssistantHost {
  calls: Call[];
  current: AppSettings;
}

function fakeHost(options: FakeOptions = {}): FakeHost {
  const calls: Call[] = [];
  const fail = (method: string): void => {
    if (options.failOn?.includes(method)) throw new Error(`${method} 失败`);
  };
  const record = (method: string, ...args: unknown[]): void => {
    calls.push([method, ...args]);
    fail(method);
  };
  const host: FakeHost = {
    calls,
    current: { ...DEFAULT_SETTINGS, ...options.settings },
    settings: () => host.current,
    async patchSettings(patch) {
      record('patchSettings', patch);
      host.current = { ...host.current, ...patch };
    },
    navigate: (target: AssistantNavTarget) => record('navigate', target),
    openImport: (text: string) => record('openImport', text),
    async exportBackup() {
      record('exportBackup');
      return '已导出备份';
    },
    async exportIcs(includeEvents: boolean) {
      record('exportIcs', includeEvents);
      return '已导出 ICS';
    },
    async exportReport() {
      record('exportReport');
      return '已导出报表';
    },
    async semesterStats() {
      record('semesterStats');
      return options.stats === undefined ? null : options.stats;
    },
    async createSnapshot() {
      record('createSnapshot');
      return '已做快照';
    },
    async listSnapshots() {
      return options.snapshots ?? [];
    },
    async restoreSnapshot(id: string) {
      record('restoreSnapshot', id);
      return `已恢复 ${id}`;
    },
    webdavConfigured: () => options.webdav ?? false,
    async webdavUpload() {
      record('webdavUpload');
      return '已上传';
    },
    async webdavDownload(mode) {
      record('webdavDownload', mode);
      return '已下载';
    },
    async lanDevices() {
      return options.devices ?? [];
    },
    async lanSync(deviceId: string, scopes: readonly AssistantLanScope[]) {
      record('lanSync', deviceId, [...scopes]);
      return '已同步';
    },
    async checkUpdate() {
      record('checkUpdate');
      return options.update ?? { available: false };
    },
  };
  return host;
}

function contextOf(host: AssistantHost): AssistantContext {
  return { storage: validatedStorage(createStorage()), userId: 'u1', now: () => NOW, timeZone: 'Asia/Shanghai', host };
}

function action(name: string) {
  const found = findAction(AI_APP_ACTIONS, name);
  assert.ok(found, `缺少动作 ${name}`);
  return found;
}

async function parse(name: string, args: AiArgs, host: AssistantHost): Promise<unknown> {
  return action(name).parse(args, contextOf(host));
}

/** parse 后直接 run，返回 run 的结果。 */
async function invoke(name: string, args: AiArgs, host: AssistantHost): Promise<unknown> {
  const context = contextOf(host);
  const found = action(name);
  return found.run(await found.parse(args, context), context);
}

async function previewOf(name: string, args: AiArgs, host: AssistantHost): Promise<string> {
  const context = contextOf(host);
  const found = action(name);
  return found.preview(await found.parse(args, context), context);
}

function argError(pattern: RegExp): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof AiArgError, `应为 AiArgError：${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  };
}

// ---- 设置 ----

test('get_settings 不含 WebDAV 密码与 AI 密钥', async () => {
  const host = fakeHost({ settings: { webdavPassword: 'enc:v1:secret', aiApiKey: 'sk-secret', aiModel: 'gpt' } });
  const result = (await invoke('get_settings', {}, host)) as Record<string, unknown>;
  assert.equal('webdavPassword' in result, false);
  assert.equal('aiApiKey' in result, false);
  assert.equal(result['aiModel'], 'gpt');
  assert.equal(result['theme'], DEFAULT_SETTINGS.theme);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(action('get_settings').risk, 'query');
});

test('update_settings 接受布尔、枚举与整数范围内的值', async () => {
  const host = fakeHost();
  const patch = await parse(
    'update_settings',
    { hideWeekends: false, theme: 'dark', themePreset: 'mono', viewDays: 7, classReminderMinutes: 180, backupKeep: 1 },
    host,
  );
  assert.deepEqual(patch, { hideWeekends: false, theme: 'dark', themePreset: 'mono', viewDays: 7, classReminderMinutes: 180, backupKeep: 1 });
  assert.equal(action('update_settings').risk, 'write');
});

test('update_settings 的 receiveBeta 接受 true / false / null', async () => {
  assert.deepEqual(await parse('update_settings', { receiveBeta: true }, fakeHost()), { receiveBeta: true });
  assert.deepEqual(await parse('update_settings', { receiveBeta: false }, fakeHost()), { receiveBeta: false });
  assert.deepEqual(await parse('update_settings', { receiveBeta: null }, fakeHost({ settings: { receiveBeta: true } })), { receiveBeta: null });
  await assert.rejects(parse('update_settings', { receiveBeta: 'yes' }, fakeHost()), argError(/receiveBeta/));
});

test('update_settings 的 quietHours 整体替换，并通过 core 校验', async () => {
  const value: QuietHours = { enabled: true, mode: 'skip', rules: [{ days: [6, 7], start: '22:30', end: '08:00' }] };
  assert.equal(checkQuietHours(value), null);
  const patch = (await parse('update_settings', { quietHours: value }, fakeHost())) as { quietHours: QuietHours };
  assert.deepEqual(patch.quietHours, value);
  assert.equal(checkQuietHours(patch.quietHours), null);
  await assert.rejects(parse('update_settings', { quietHours: 'off' }, fakeHost()), argError(/quietHours/));
  await assert.rejects(parse('update_settings', { quietHours: null }, fakeHost()), argError(/quietHours/));
  await assert.rejects(parse('update_settings', { quietHours: [] }, fakeHost()), argError(/quietHours/));
});

/** 拒绝时的消息应与 core checkQuietHours 对同一取值给出的文案一致 */
function quietProblem(value: unknown): (error: unknown) => boolean {
  const problem = checkQuietHours(value as QuietHours);
  assert.ok(problem !== null, '用例应为 core 判定不合法的取值');
  return (error) => {
    assert.ok(error instanceof AiArgError, `应为 AiArgError：${String(error)}`);
    assert.equal(error.message, problem);
    return true;
  };
}

test('update_settings 的 quietHours 规则超过上限时拒绝', async () => {
  const rules = Array.from({ length: 9 }, () => ({ days: [1], start: '22:00', end: '23:00' }));
  const value = { enabled: true, mode: 'defer', rules };
  await assert.rejects(parse('update_settings', { quietHours: value }, fakeHost()), quietProblem(value));
  // 恰好 8 条可以
  const eight = { enabled: true, mode: 'defer', rules: rules.slice(0, 8) };
  assert.equal(((await parse('update_settings', { quietHours: eight }, fakeHost())) as { quietHours: QuietHours }).quietHours.rules.length, 8);
});

test('update_settings 的 quietHours 有不合法的规则时拒绝', async () => {
  const cases = [
    { enabled: true, mode: 'defer', rules: [{ days: [], start: '22:00', end: '07:00' }] },
    { enabled: true, mode: 'defer', rules: [{ days: [1], start: '25:00', end: '07:00' }] },
    { enabled: true, mode: 'defer', rules: [{ days: [1, 2], start: '22:00', end: '07:00' }, { days: [8], start: '22:00', end: '07:00' }] },
  ];
  for (const value of cases) {
    await assert.rejects(parse('update_settings', { quietHours: value }, fakeHost()), quietProblem(value), JSON.stringify(value));
  }
});

test('update_settings 的 quietHours 处理方式不合法时拒绝', async () => {
  const value = { enabled: true, mode: 'later', rules: [{ days: [1], start: '22:00', end: '07:00' }] };
  await assert.rejects(parse('update_settings', { quietHours: value }, fakeHost()), quietProblem(value));
});

test('update_settings 的 quietHours 缺的字段沿用当前值', async () => {
  const current: QuietHours = { enabled: true, mode: 'skip', rules: [{ days: [1, 2], start: '12:00', end: '13:00' }] };
  const host = fakeHost({ settings: { quietHours: current } });
  assert.deepEqual(await parse('update_settings', { quietHours: { enabled: false } }, host), { quietHours: { ...current, enabled: false } });
  const rules = [{ days: [7], start: '23:00', end: '07:00' }];
  assert.deepEqual(await parse('update_settings', { quietHours: { rules } }, host), { quietHours: { ...current, rules } });
  assert.deepEqual(await parse('update_settings', { quietHours: { mode: 'defer' } }, host), { quietHours: { ...current, mode: 'defer' } });
  await assert.rejects(parse('update_settings', { quietHours: {} }, host), argError(/没有要改的设置/));
});

test('update_settings 的 quietHours 的 enabled 与 rules 类型不对时拒绝', async () => {
  await assert.rejects(parse('update_settings', { quietHours: { enabled: 'yes' } }, fakeHost()), argError(/quietHours\.enabled/));
  await assert.rejects(parse('update_settings', { quietHours: { enabled: 1 } }, fakeHost()), argError(/quietHours\.enabled/));
  await assert.rejects(parse('update_settings', { quietHours: { rules: { days: [1] } } }, fakeHost()), argError(/quietHours\.rules/));
  await assert.rejects(parse('update_settings', { quietHours: { rules: 'none' } }, fakeHost()), argError(/quietHours\.rules/));
});

test('update_settings 的 quietHours 规整星期：排序并去重', async () => {
  const value = { enabled: true, mode: 'defer', rules: [{ days: [7, 1, 3, 1], start: '22:00', end: '07:00' }] };
  const patch = (await parse('update_settings', { quietHours: value }, fakeHost())) as { quietHours: QuietHours };
  assert.deepEqual(patch.quietHours, { enabled: true, mode: 'defer', rules: [{ days: [1, 3, 7], start: '22:00', end: '07:00' }] });
});

test('update_settings 的 timeZone 校验 IANA 名称', async () => {
  assert.deepEqual(await parse('update_settings', { timeZone: 'Asia/Tokyo' }, fakeHost()), { timeZone: 'Asia/Tokyo' });
  await assert.rejects(parse('update_settings', { timeZone: 'Mars/Olympus' }, fakeHost()), argError(/无效的时区/));
  await assert.rejects(parse('update_settings', { timeZone: 8 }, fakeHost()), argError(/timeZone 应为文本/));
});

test('update_settings 拒绝密码、密钥与开机自启', async () => {
  for (const key of ['webdavPassword', 'aiApiKey', 'autoStart']) {
    const value = key === 'autoStart' ? true : 'x';
    await assert.rejects(parse('update_settings', { [key]: value }, fakeHost()), argError(/不能由助手修改/), key);
  }
  // 混在合法项里也拒绝，不会只改其余项
  await assert.rejects(parse('update_settings', { theme: 'dark', aiApiKey: 'sk' }, fakeHost()), argError(/不能由助手修改/));
});

test('update_settings 拒绝未知设置项', async () => {
  await assert.rejects(parse('update_settings', { fontSize: 14 }, fakeHost()), argError(/没有设置项 fontSize/));
});

test('update_settings 拒绝类型不对、枚举外与越界的值', async () => {
  const cases: Array<[AiArgs, RegExp]> = [
    [{ hideWeekends: 'true' }, /hideWeekends 应为 true 或 false/],
    [{ hideWeekends: 1 }, /hideWeekends 应为 true 或 false/],
    [{ theme: 1 }, /theme 应为文本/],
    [{ theme: 'blue' }, /theme 只能是 light \/ dark \/ system/],
    [{ viewDays: 8 }, /viewDays 只能是/],
    [{ viewDays: '5' }, /viewDays 应为整数/],
    [{ classReminderMinutes: 0 }, /classReminderMinutes 应在 1-180 之间/],
    [{ classReminderMinutes: 181 }, /classReminderMinutes 应在 1-180 之间/],
    [{ classReminderMinutes: 10.5 }, /classReminderMinutes 应为整数/],
    [{ backupKeep: 101 }, /backupKeep 应在 1-100 之间/],
    [{ hideWeekends: null }, /hideWeekends 应为 true 或 false/],
  ];
  for (const [args, pattern] of cases) {
    await assert.rejects(parse('update_settings', args, fakeHost()), argError(pattern), JSON.stringify(args));
  }
});

test('update_settings 去掉与当前相同的值；全部相同时报错', async () => {
  const host = fakeHost({ settings: { theme: 'dark' } });
  assert.deepEqual(await parse('update_settings', { theme: 'dark', hideWeekends: false }, host), { hideWeekends: false });
  await assert.rejects(parse('update_settings', { theme: 'dark' }, host), argError(/没有要改的设置/));
  await assert.rejects(parse('update_settings', {}, host), argError(/没有要改的设置/));
  await assert.rejects(parse('update_settings', { receiveBeta: null }, fakeHost()), argError(/没有要改的设置/));
  await assert.rejects(parse('update_settings', { quietHours: DEFAULT_SETTINGS.quietHours }, fakeHost()), argError(/没有要改的设置/));
});

test('update_settings 去掉文本首尾空白，去空白后与当前相同也算没改', async () => {
  const host = fakeHost({ settings: { aiModel: 'gpt-4o' } });
  assert.deepEqual(await parse('update_settings', { webdavUrl: '  https://dav.example.com/dt/  ', aiBaseUrl: '\thttps://api.example.com/v1\n' }, host), {
    webdavUrl: 'https://dav.example.com/dt/',
    aiBaseUrl: 'https://api.example.com/v1',
  });
  await assert.rejects(parse('update_settings', { aiModel: ' gpt-4o ' }, host), argError(/没有要改的设置/));
});

test('update_settings 先去掉首尾空白再校验时区与枚举', async () => {
  assert.deepEqual(await parse('update_settings', { timeZone: ' Asia/Tokyo ' }, fakeHost()), { timeZone: 'Asia/Tokyo' });
  assert.deepEqual(await parse('update_settings', { theme: ' dark ', downloadSource: '\tgitee\n' }, fakeHost()), { theme: 'dark', downloadSource: 'gitee' });
  // 去空白后与当前相同也算没改
  await assert.rejects(parse('update_settings', { theme: ' system ' }, fakeHost()), argError(/没有要改的设置/));
  await assert.rejects(parse('update_settings', { timeZone: ' Mars/Olympus ' }, fakeHost()), argError(/无效的时区/));
});

test('update_settings 的预览逐项列出「旧 → 新」', async () => {
  const host = fakeHost();
  const preview = await previewOf('update_settings', { theme: 'dark', hideWeekends: false, classReminderMinutes: 15, receiveBeta: true }, host);
  assert.match(preview, /^修改设置：/);
  assert.ok(preview.includes('明暗：system → dark'), preview);
  assert.ok(preview.includes('课表隐藏周六周日：开 → 关'), preview);
  assert.ok(preview.includes('课前提醒提前分钟数：20 → 15'), preview);
  assert.ok(preview.includes('接收测试版更新：跟随默认 → 开'), preview);
  assert.equal(preview.split('；').length, 4);
});

test('update_settings 的 run 把补丁交给 host.patchSettings', async () => {
  const host = fakeHost();
  const result = await invoke('update_settings', { theme: 'light', backupKeep: 30 }, host);
  assert.deepEqual(host.calls, [['patchSettings', { theme: 'light', backupKeep: 30 }]]);
  assert.equal(result, '已修改 2 项设置');
  assert.equal(host.current.theme, 'light');
});

test('semester_stats 返回 host 的统计，没有学期时返回 error', async () => {
  const stats = { progress: 0.5, courses: [] };
  assert.deepEqual(await invoke('semester_stats', {}, fakeHost({ stats })), stats);
  const none = (await invoke('semester_stats', {}, fakeHost())) as { error?: string };
  assert.equal(typeof none.error, 'string');
  assert.equal(action('semester_stats').risk, 'query');
});

// ---- 导入导出 ----

test('import_timetable_text 拒绝空文本与超长文本', async () => {
  await assert.rejects(parse('import_timetable_text', {}, fakeHost()), AiArgError);
  await assert.rejects(parse('import_timetable_text', { text: '' }, fakeHost()), AiArgError);
  await assert.rejects(parse('import_timetable_text', { text: '   ' }, fakeHost()), AiArgError);
  await assert.rejects(parse('import_timetable_text', { text: 'x'.repeat(200_001) }, fakeHost()), argError(/太长/));
  assert.equal((await parse('import_timetable_text', { text: 'x'.repeat(200_000) }, fakeHost()) as string).length, 200_000);
});

test('import_timetable_text 原样把文本交给 openImport', async () => {
  const text = '周一\t高等数学\t1-2节\n周三\t大学英语\t3-4节';
  const host = fakeHost();
  assert.equal(action('import_timetable_text').risk, 'write');
  await invoke('import_timetable_text', { text }, host);
  assert.deepEqual(host.calls, [['openImport', text]]);
  assert.match(await previewOf('import_timetable_text', { text }, host), new RegExp(`${text.length} 字`));
});

test('export_file 按 kind 调对应的 host 方法，includeEvents 默认 false 且只给 ics', async () => {
  const backup = fakeHost();
  assert.equal(await invoke('export_file', { kind: 'backup', includeEvents: true }, backup), '已导出备份');
  assert.deepEqual(backup.calls, [['exportBackup']]);

  const ics = fakeHost();
  await invoke('export_file', { kind: 'ics' }, ics);
  assert.deepEqual(ics.calls, [['exportIcs', false]]);

  const icsEvents = fakeHost();
  await invoke('export_file', { kind: 'ics', includeEvents: true }, icsEvents);
  assert.deepEqual(icsEvents.calls, [['exportIcs', true]]);

  const report = fakeHost();
  await invoke('export_file', { kind: 'report' }, report);
  assert.deepEqual(report.calls, [['exportReport']]);

  await assert.rejects(parse('export_file', { kind: 'pdf' }, fakeHost()), AiArgError);
  await assert.rejects(parse('export_file', {}, fakeHost()), AiArgError);
  await assert.rejects(parse('export_file', { kind: 'ics', includeEvents: 'yes' }, fakeHost()), AiArgError);
});

test('export_file 的预览', async () => {
  const host = fakeHost();
  assert.equal(await previewOf('export_file', { kind: 'backup' }, host), '导出完整备份');
  assert.equal(await previewOf('export_file', { kind: 'ics' }, host), '导出日历文件（ICS）');
  assert.equal(await previewOf('export_file', { kind: 'ics', includeEvents: true }, host), '导出日历文件（ICS）（含日程）');
  assert.equal(await previewOf('export_file', { kind: 'report', includeEvents: true }, host), '导出学期统计报表');
});

// ---- 快照 ----

const SNAPSHOTS: AssistantSnapshot[] = [
  { id: 'snap-2', createdAt: Date.UTC(2026, 10, 20, 16, 0), bytes: 2048 },
  { id: 'snap-1', createdAt: Date.UTC(2026, 10, 1, 0, 30), bytes: 1024 },
];

test('list_snapshots 给出 ISO 时刻', async () => {
  const result = await invoke('list_snapshots', {}, fakeHost({ snapshots: SNAPSHOTS }));
  assert.deepEqual(result, [
    { id: 'snap-2', createdAt: '2026-11-20T16:00:00.000Z', bytes: 2048 },
    { id: 'snap-1', createdAt: '2026-11-01T00:30:00.000Z', bytes: 1024 },
  ]);
  assert.equal(action('list_snapshots').risk, 'query');
});

test('create_snapshot 是写入，run 调 createSnapshot', async () => {
  assert.equal(action('create_snapshot').risk, 'write');
  const host = fakeHost();
  assert.equal(await invoke('create_snapshot', {}, host), '已做快照');
  assert.deepEqual(host.calls, [['createSnapshot']]);
});

test('restore_snapshot 是高危；未知 id 在解析时拒绝；run 调 restoreSnapshot', async () => {
  assert.equal(action('restore_snapshot').risk, 'danger');
  const host = fakeHost({ snapshots: SNAPSHOTS });
  await assert.rejects(parse('restore_snapshot', { id: 'snap-9' }, host), argError(/找不到快照 snap-9/));
  await assert.rejects(parse('restore_snapshot', {}, host), AiArgError);
  assert.equal(host.calls.length, 0);
  assert.equal(await invoke('restore_snapshot', { id: 'snap-1' }, host), '已恢复 snap-1');
  assert.deepEqual(host.calls, [['restoreSnapshot', 'snap-1']]);
  assert.match(await previewOf('restore_snapshot', { id: 'snap-1' }, host), /snap-1/);
});

// ---- 同步 ----

test('webdav_upload / webdav_download 未配置 WebDAV 时在解析时拒绝', async () => {
  const host = fakeHost({ webdav: false });
  await assert.rejects(parse('webdav_upload', {}, host), argError(/WebDAV/));
  await assert.rejects(parse('webdav_download', {}, host), argError(/WebDAV/));
  await assert.rejects(parse('webdav_download', { mode: 'settings' }, host), argError(/WebDAV/));
  assert.equal(host.calls.length, 0);
});

test('webdav_upload 是写入，run 调 webdavUpload', async () => {
  assert.equal(action('webdav_upload').risk, 'write');
  const host = fakeHost({ webdav: true });
  assert.equal(await invoke('webdav_upload', {}, host), '已上传');
  assert.deepEqual(host.calls, [['webdavUpload']]);
});

test('webdav_download 是高危，mode 默认 all', async () => {
  assert.equal(action('webdav_download').risk, 'danger');
  const host = fakeHost({ webdav: true });
  assert.equal(await parse('webdav_download', {}, host), 'all');
  assert.equal(await parse('webdav_download', { mode: 'settings' }, host), 'settings');
  await assert.rejects(parse('webdav_download', { mode: 'partial' }, host), AiArgError);
  await invoke('webdav_download', {}, host);
  await invoke('webdav_download', { mode: 'settings' }, host);
  assert.deepEqual(host.calls, [['webdavDownload', 'all'], ['webdavDownload', 'settings']]);
  assert.notEqual(await previewOf('webdav_download', {}, host), await previewOf('webdav_download', { mode: 'settings' }, host));
});

const DEVICES: AssistantLanDevice[] = [
  { id: 'dev-pc', name: '宿舍电脑', lastSyncAt: Date.UTC(2026, 10, 20, 12, 0) },
  { id: 'dev-phone', name: '我的手机', lastSyncAt: null },
];

test('list_lan_devices 给出 ISO 或 null 的 lastSyncAt', async () => {
  assert.deepEqual(await invoke('list_lan_devices', {}, fakeHost({ devices: DEVICES })), [
    { id: 'dev-pc', name: '宿舍电脑', lastSyncAt: '2026-11-20T12:00:00.000Z' },
    { id: 'dev-phone', name: '我的手机', lastSyncAt: null },
  ]);
});

test('lan_sync 没有已配对设备时拒绝并提示去配对', async () => {
  await assert.rejects(parse('lan_sync', {}, fakeHost()), argError(/配对/));
});

test('lan_sync 只有一台设备时可省略 id；多台时必须给出', async () => {
  const single = fakeHost({ devices: [DEVICES[0]!] });
  assert.deepEqual(await parse('lan_sync', {}, single), { device: { id: 'dev-pc', name: '宿舍电脑' }, scopes: ['timetable', 'todos'] });
  assert.deepEqual(await parse('lan_sync', { deviceId: null }, single), { device: { id: 'dev-pc', name: '宿舍电脑' }, scopes: ['timetable', 'todos'] });

  const several = fakeHost({ devices: DEVICES });
  await assert.rejects(parse('lan_sync', {}, several), argError(/deviceId/));
  assert.deepEqual(await parse('lan_sync', { deviceId: 'dev-phone' }, several), {
    device: { id: 'dev-phone', name: '我的手机' },
    scopes: ['timetable', 'todos'],
  });
});

test('lan_sync 拒绝未知设备 id', async () => {
  await assert.rejects(parse('lan_sync', { deviceId: 'dev-x' }, fakeHost({ devices: DEVICES })), argError(/找不到设备 dev-x/));
  // 只有一台时给错 id 也不会退回到那一台
  await assert.rejects(parse('lan_sync', { deviceId: 'dev-x' }, fakeHost({ devices: [DEVICES[0]!] })), argError(/找不到设备 dev-x/));
});

test('lan_sync 的范围：默认课表与待办，去重，非法或空时拒绝', async () => {
  const host = fakeHost({ devices: [DEVICES[0]!] });
  const scopesOf = async (scopes: unknown) => ((await parse('lan_sync', { scopes }, host)) as { scopes: AssistantLanScope[] }).scopes;
  assert.deepEqual(await scopesOf(undefined), ['timetable', 'todos']);
  assert.deepEqual(await scopesOf(null), ['timetable', 'todos']);
  assert.deepEqual(await scopesOf(['settings', 'todos', 'settings']), ['settings', 'todos']);
  for (const bad of [[], ['photos'], ['timetable', 'photos'], 'timetable', [1]]) {
    await assert.rejects(parse('lan_sync', { scopes: bad }, host), argError(/scopes/), JSON.stringify(bad));
  }
});

test('lan_sync 的预览写出设备名与中文范围，run 调 lanSync', async () => {
  const host = fakeHost({ devices: DEVICES });
  assert.equal(await previewOf('lan_sync', { deviceId: 'dev-pc' }, host), '从「宿舍电脑」同步：课表、待办');
  assert.equal(await previewOf('lan_sync', { deviceId: 'dev-phone', scopes: ['settings', 'timetable'] }, host), '从「我的手机」同步：设置、课表');
  assert.equal(action('lan_sync').risk, 'write');
  await invoke('lan_sync', { deviceId: 'dev-phone', scopes: ['todos', 'todos'] }, host);
  assert.deepEqual(host.calls, [['lanSync', 'dev-phone', ['todos']]]);
});

test('check_update 是查询，返回 host.checkUpdate()', async () => {
  assert.equal(action('check_update').risk, 'query');
  const update = { available: true, version: '1.2.0' };
  const host = fakeHost({ update });
  assert.deepEqual(await invoke('check_update', {}, host), update);
  assert.deepEqual(host.calls, [['checkUpdate']]);
});

// ---- 界面 ----

test('open_page：settings / devices 带分组，其余页面只给 page', async () => {
  assert.equal(action('open_page').risk, 'query');
  assert.deepEqual(await parse('open_page', { page: 'settings', group: 'reminders' }, fakeHost()), { kind: 'settings', group: 'reminders' });
  assert.deepEqual(await parse('open_page', { page: 'settings' }, fakeHost()), { kind: 'settings', group: null });
  assert.deepEqual(await parse('open_page', { page: 'devices', group: 'webdav' }, fakeHost()), { kind: 'devices', group: 'webdav' });
  assert.deepEqual(await parse('open_page', { page: 'devices' }, fakeHost()), { kind: 'devices', group: null });
  assert.deepEqual(await parse('open_page', { page: 'timetable' }, fakeHost()), { kind: 'page', page: 'timetable' });
  assert.deepEqual(await parse('open_page', { page: 'help' }, fakeHost()), { kind: 'page', page: 'help' });
  // devices 的分组不能用在 settings 上，反之亦然
  await assert.rejects(parse('open_page', { page: 'settings', group: 'webdav' }, fakeHost()), AiArgError);
  await assert.rejects(parse('open_page', { page: 'devices', group: 'reminders' }, fakeHost()), AiArgError);
  await assert.rejects(parse('open_page', { page: 'profile' }, fakeHost()), AiArgError);
  await assert.rejects(parse('open_page', {}, fakeHost()), AiArgError);
});

test('open_page 的 run 直接跳转', async () => {
  const host = fakeHost();
  await invoke('open_page', { page: 'devices', group: 'lan' }, host);
  assert.deepEqual(host.calls, [['navigate', { kind: 'devices', group: 'lan' }]]);
});

test('show_date：mode 默认 week，日期不合法时拒绝', async () => {
  assert.equal(action('show_date').risk, 'query');
  assert.deepEqual(await parse('show_date', { date: '2026-11-23' }, fakeHost()), { kind: 'date', date: '2026-11-23', mode: 'week' });
  assert.deepEqual(await parse('show_date', { date: '2026-11-23', mode: 'day' }, fakeHost()), { kind: 'date', date: '2026-11-23', mode: 'day' });
  for (const bad of [{}, { date: '2026-02-30' }, { date: '2026/11/23' }, { date: 'tomorrow' }, { date: '2026-11-23', mode: 'month' }]) {
    await assert.rejects(parse('show_date', bad, fakeHost()), AiArgError, JSON.stringify(bad));
  }
  const host = fakeHost();
  await invoke('show_date', { date: '2026-12-31', mode: 'day' }, host);
  assert.deepEqual(host.calls, [['navigate', { kind: 'date', date: '2026-12-31', mode: 'day' }]]);
});

test('AI_APP_ACTIONS 名称不重复且合法', () => {
  const names = AI_APP_ACTIONS.map((item) => item.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z0-9_]+$/);
});

// ---- 与对话循环、计划执行的衔接 ----

function call(id: string, name: string, args: unknown): AiToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function scriptedClient(script: AiChatReply[]): AiClient {
  const queue = [...script];
  return {
    async complete() {
      throw new Error('不该走 JSON 方式');
    },
    async chat() {
      const next = queue.shift();
      if (next === undefined) throw new Error('chat 脚本已用完');
      return next;
    },
  };
}

function turnInput(client: AiClient, context: AssistantContext) {
  return { client, actions: AI_APP_ACTIONS, context, history: [], userText: '帮我改设置', contextNote: '今天 2026-11-21' };
}

test('对话里的查询动作 open_page 当场执行并跳转，不进计划', async () => {
  const host = fakeHost();
  const result = await runAssistantTurn(
    turnInput(
      scriptedClient([
        { content: '', toolCalls: [call('c1', 'open_page', { page: 'settings', group: 'appearance' })] },
        { content: '已打开外观设置', toolCalls: [] },
      ]),
      contextOf(host),
    ),
  );
  assert.equal(result.plan.length, 0);
  assert.equal(result.reply, '已打开外观设置');
  assert.deepEqual(host.calls, [['navigate', { kind: 'settings', group: 'appearance' }]]);
});

test('update_settings 与 restore_snapshot 进计划；executePlan 按顺序执行', async () => {
  const host = fakeHost({ snapshots: SNAPSHOTS });
  const context = contextOf(host);
  const result = await runAssistantTurn(
    turnInput(
      scriptedClient([
        {
          content: '',
          toolCalls: [call('c1', 'update_settings', { theme: 'dark' }), call('c2', 'restore_snapshot', { id: 'snap-2' })],
        },
        { content: '计划里有两步', toolCalls: [] },
      ]),
      context,
    ),
  );
  assert.deepEqual(
    result.plan.map((step) => [step.action, step.risk]),
    [
      ['update_settings', 'write'],
      ['restore_snapshot', 'danger'],
    ],
  );
  assert.equal(result.plan[0]!.preview, '修改设置：明暗：system → dark');
  // 进计划时还没有执行任何操作
  assert.deepEqual(host.calls, []);

  const execution = await executePlan(result.plan, AI_APP_ACTIONS, context);
  assert.equal(execution.failed, null);
  assert.deepEqual(execution.done.map((item) => item.summary), ['已修改 1 项设置', '已恢复 snap-2']);
  assert.deepEqual(host.calls, [['patchSettings', { theme: 'dark' }], ['restoreSnapshot', 'snap-2']]);
});

test('对话里参数不合法的写入动作不进计划，错误回给模型', async () => {
  const host = fakeHost();
  const result = await runAssistantTurn(
    turnInput(
      scriptedClient([
        { content: '', toolCalls: [call('c1', 'update_settings', { aiApiKey: 'sk' })] },
        { content: '密钥要到设置页改', toolCalls: [] },
      ]),
      contextOf(host),
    ),
  );
  assert.equal(result.plan.length, 0);
  const tool = result.history.find((message) => message.role === 'tool');
  assert.ok(tool);
  assert.match(tool.content, /不能由助手修改/);
});

test('executePlan 在 host 第一次失败处停下', async () => {
  const host = fakeHost({ snapshots: SNAPSHOTS, failOn: ['patchSettings'] });
  const context = contextOf(host);
  const result = await runAssistantTurn(
    turnInput(
      scriptedClient([
        {
          content: '',
          toolCalls: [
            call('c1', 'create_snapshot', {}),
            call('c2', 'update_settings', { hideWeekends: false }),
            call('c3', 'restore_snapshot', { id: 'snap-1' }),
          ],
        },
        { content: '好', toolCalls: [] },
      ]),
      context,
    ),
  );
  assert.equal(result.plan.length, 3);
  const progress: number[] = [];
  const execution = await executePlan(result.plan, AI_APP_ACTIONS, context, (done) => progress.push(done));
  assert.deepEqual(execution.done.map((item) => item.step.action), ['create_snapshot']);
  assert.equal(execution.failed?.step.action, 'update_settings');
  assert.equal(execution.failed?.message, 'patchSettings 失败');
  assert.deepEqual(progress, [1]);
  // 失败之后的恢复快照没有执行
  assert.deepEqual(host.calls.map(([method]) => method), ['createSnapshot', 'patchSettings']);
});
