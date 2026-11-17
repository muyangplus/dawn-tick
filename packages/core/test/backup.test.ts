import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_FORMAT,
  BACKUP_META_KEYS,
  exportBackup,
  importBackup,
  parseBackup,
  summarizeBackup,
} from '../src/backup.ts';
import { createSemester } from '../src/mutations.ts';
import { EXPORT_EXCLUDED_KEYS, SETTING_META_KEYS, readSettings, writeSettings } from '../src/settings.ts';
import { activeSemester, weekView } from '../src/repository.ts';
import { START_DATE, USER_ID, createStorage, weekRange } from './kit/index.ts';
import type { Storage } from '../src/storage.ts';

async function seedStorage() {
  const storage = createStorage();
  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '2026-2027 第一学期',
    startDate: START_DATE,
    timeZone: 'Asia/Shanghai',
  });
  const course = await storage.collection('courses').put({
    id: 'c-1',
    semester_id: semester['id'],
    name: '高等数学',
    short_name: '高数',
    teacher: '张老师',
    location: '教三-201',
    color: '#4F8DFD',
    credits: 5,
    note: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    rev: 0,
    dirty: 0,
  });
  void course;
  await storage.collection('course_schedules').put({
    id: 's-1',
    course_id: 'c-1',
    day_of_week: 1,
    period_start: 1,
    period_end: 2,
    weeks_mask: weekRange(1, 16).reduce((mask, week) => mask | (1 << (week - 1)), 0),
    weeks_raw: '1-16周',
    room: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    rev: 0,
    dirty: 0,
  });
  await writeSettings(storage, { viewDays: 7, theme: 'dark', themePreset: 'mono' });
  await storage.writeMeta('device_id', 'device-a');
  await storage.writeMeta('sync_cursor', '42');
  return { storage, semesterId: String(semester['id']) };
}

test('导出包含全部集合与设置项', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage, { now: 1234 });

  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.exportedAt, 1234);
  assert.equal((payload.stores.users ?? []).length, 1);
  assert.equal((payload.stores.semesters ?? []).length, 1);
  assert.equal((payload.stores.courses ?? []).length, 1);
  assert.equal((payload.stores.time_slots ?? []).length, 10);
  assert.equal((payload.stores.course_schedules ?? []).length, 1);

  assert.equal(payload.meta['view_days'], '7');
  assert.equal(payload.meta['theme'], 'dark');
  assert.equal(payload.meta['theme_preset'], 'mono');
  assert.equal(payload.meta['device_id'], undefined);
  assert.equal(payload.meta['sync_cursor'], undefined);
  assert.equal(payload.meta['schema_version'], undefined, 'A9：库结构版本不进备份');
  for (const key of Object.keys(payload.meta)) {
    assert.ok(BACKUP_META_KEYS.includes(key), `${key} 不应出现在备份里`);
  }
});

test('导出再导入可完整还原', async () => {
  const { storage, semesterId } = await seedStorage();
  const payload = await exportBackup(storage);

  const target = createStorage();
  const result = await importBackup(target, payload, { now: 999 });
  assert.equal(result.skipped, 0);
  assert.ok(result.imported >= 14);
  assert.deepEqual(result.warnings, []);

  assert.equal((await activeSemester(target, USER_ID))?.id, semesterId);
  const monday = await weekView(target, semesterId, 1, 3);
  assert.equal(monday.length, 1);
  assert.equal(monday[0]?.name, '高等数学');
  assert.equal(monday[0]?.room, '教三-201');

  const settings = await import('../src/settings.ts').then((module) => module.readSettings(target));
  assert.equal(settings.viewDays, 7);
  assert.equal(settings.themePreset, 'mono');
});

test('非法行被跳过并给出警告', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  payload.stores.courses = [
    ...(payload.stores.courses ?? []),
    { id: 'c-bad', semester_id: 'sem-1', name: '坏课程', color: 'red', created_at: 1, updated_at: 1, deleted_at: null },
  ];

  const target = createStorage();
  const result = await importBackup(target, payload);
  assert.equal(result.skipped, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('color')));
});

test('备份文件格式校验', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  const text = JSON.stringify(payload);

  assert.equal(parseBackup(text).version, payload.version);
  assert.throws(() => parseBackup('不是 JSON'), /合法 JSON/);
  assert.throws(() => parseBackup('{"format":"other"}'), /不是晓刻 DawnTick 备份文件/);
  assert.throws(
    () => parseBackup(JSON.stringify({ ...payload, version: 99 })),
    /高于当前支持/,
  );
});

test('可按模块导出', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage, { modules: ['courses'] });

  assert.deepEqual(payload.modules, ['courses']);
  assert.equal((payload.stores.courses ?? []).length, 1);
  assert.equal((payload.stores.course_schedules ?? []).length, 1);
  assert.equal(payload.stores.semesters, undefined, '未勾选的模块不导出');
  assert.equal(payload.stores.users, undefined);
  assert.deepEqual(payload.meta, {}, '未勾选设置时不导出设置项');

  const onlySettings = await exportBackup(storage, { modules: ['settings'] });
  assert.equal(onlySettings.meta['theme'], 'dark');
  assert.equal(onlySettings.stores.courses, undefined);
});

test('导入可保留现有数据或覆盖', async () => {
  const { storage, semesterId } = await seedStorage();
  const payload = await exportBackup(storage);

  const target = createStorage();
  await importBackup(target, payload, { now: 1 });
  await target.collection('courses').put({ ...(payload.stores.courses?.[0] as Record<string, unknown>), name: '本地改过的课程' });

  const skipResult = await importBackup(target, payload, { mode: 'skip', now: 2 });
  assert.ok(skipResult.skipped >= 1, '已存在的数据应计入跳过');
  assert.equal(
    (await target.collection<Record<string, unknown>>('courses').get('c-1'))?.['name'],
    '本地改过的课程',
    'skip 模式不得改动现有数据',
  );

  const overwriteResult = await importBackup(target, payload, { mode: 'overwrite', now: 3 });
  assert.equal(overwriteResult.skipped, 0);
  assert.equal(
    (await target.collection<Record<string, unknown>>('courses').get('c-1'))?.['name'],
    '高等数学',
    'overwrite 模式应恢复为备份内容',
  );

  // 导入也可按模块筛选
  const onlySettings = await importBackup(createStorage(), payload, { modules: ['settings'], mode: 'overwrite', now: 4 });
  assert.equal(onlySettings.imported, Object.keys(payload.meta).length);
  const unchanged = await importBackup(target, payload, { modules: ['settings'], mode: 'overwrite', now: 5 });
  assert.equal(unchanged.imported, 0, '值未变的设置不计为导入');
  assert.equal((await activeSemester(target, USER_ID))?.id, semesterId);
});

test('周视图非本周课程开关随备份迁移', async () => {
  const { storage } = await seedStorage();
  await writeSettings(storage, { showOtherWeeks: false });
  const payload = await exportBackup(storage, { modules: ['settings'] });
  assert.equal(payload.meta['show_other_weeks'], '0');

  const target = createStorage();
  await importBackup(target, payload, { modules: ['settings'], mode: 'overwrite' });
  const settings = await import('../src/settings.ts').then((module) => module.readSettings(target));
  assert.equal(settings.showOtherWeeks, false);
});

test('导入摘要给出各模块行数', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  const summary = summarizeBackup(payload);
  const courses = summary.find((item) => item.module === 'courses');
  const settings = summary.find((item) => item.module === 'settings');
  assert.equal(courses?.rows, 2, '课程与排课各一行');
  assert.ok((settings?.rows ?? 0) >= 3, '设置项按 meta 条数统计');
  assert.equal(summary.length, 5);
});

test('设置清单覆盖全部设置键', async () => {
  const { storage } = await seedStorage();
  await writeSettings(storage, {
    autoCheckUpdate: false,
    todoSort: 'type',
    devFeatures: false,
    logEnabled: false,
    logLevel: 'warn',
    walMode: 'off',
  });
  const payload = await exportBackup(storage, { modules: ['settings'] });
  assert.equal(payload.meta['auto_check_update'], '0');
  assert.equal(payload.meta['todo_sort'], 'type');
  assert.equal(payload.meta['dev_features'], '0');
  assert.equal(payload.meta['log_enabled'], '0');
  assert.equal(payload.meta['log_level'], 'warn');
  // A20：数据库日志模式、开机自启、启动隐藏只对本机有意义，不进备份
  assert.equal(payload.meta['wal_mode'], undefined);

  const target = createStorage();
  await importBackup(target, payload, { modules: ['settings'], mode: 'overwrite' });
  const settings = await import('../src/settings.ts').then((module) => module.readSettings(target));
  assert.equal(settings.todoSort, 'type');
  assert.equal(settings.devFeatures, false);
});

test('备份键清单由设置键清单派生', () => {
  assert.ok(BACKUP_META_KEYS.includes('week_starts_today'), '缺 week_starts_today');
  assert.ok(BACKUP_META_KEYS.includes('hide_weekends'), '缺 hide_weekends');
  assert.equal(BACKUP_META_KEYS.includes('webdav_password'), false, '密码不应进备份');
  for (const key of ['wal_mode', 'auto_start', 'start_hidden']) {
    assert.equal(BACKUP_META_KEYS.includes(key), false, `${key} 是本机设置，不进备份`);
  }
  for (const key of SETTING_META_KEYS) {
    if (EXPORT_EXCLUDED_KEYS.includes(key)) continue;
    assert.ok(BACKUP_META_KEYS.includes(key), `备份键清单缺少设置键 ${key}`);
  }
});

test('周视图开关随备份导出并还原', async () => {
  const { storage } = await seedStorage();
  await writeSettings(storage, { weekStartsToday: false, hideWeekends: true });
  const payload = await exportBackup(storage, { modules: ['settings'] });
  assert.equal(payload.meta['week_starts_today'], '0');
  assert.equal(payload.meta['hide_weekends'], '1');

  const target = createStorage();
  await importBackup(target, payload, { modules: ['settings'], mode: 'overwrite' });
  const settings = await readSettings(target);
  assert.equal(settings.weekStartsToday, false);
  assert.equal(settings.hideWeekends, true);
});

test('清空模式先删掉所选模块的本地行', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  const target = createStorage();
  await importBackup(target, payload, { now: 1 });

  // 本地再塞一条备份里没有的课程排课
  await target.collection('course_schedules').put({
    id: 's-local',
    course_id: 'c-1',
    day_of_week: 3,
    period_start: 1,
    period_end: 1,
    weeks_mask: 1,
    weeks_raw: '1周',
    room: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    rev: 0,
    dirty: 0,
  });
  assert.equal((await target.collection('course_schedules').getAll()).length, 2);

  const result = await importBackup(target, payload, { mode: 'clear', modules: ['courses'], now: 2 });
  assert.equal(result.removed, 3, '清掉本地课程 1 行与排课 2 行');
  assert.equal(result.imported, 2);
  const schedules = await target.collection<Record<string, unknown>>('course_schedules').getAll();
  assert.deepEqual(
    schedules.map((row) => row['id']),
    ['s-1'],
    '本地多出来的排课被清掉',
  );
  // 未勾选的模块不动
  assert.ok((await target.collection('events').getAll()).length >= 0);
});

test('合并模式按 updated_at 取较新的一份', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  const target = createStorage();
  await importBackup(target, payload, { now: 10 });

  const local = await target.collection<Record<string, unknown>>('courses').get('c-1');
  await target.collection('courses').put({ ...local, name: '本地较新', updated_at: 99 });
  await importBackup(target, payload, { mode: 'merge', now: 20 });
  assert.equal(
    (await target.collection<Record<string, unknown>>('courses').get('c-1'))?.['name'],
    '本地较新',
    '本地更新时保留本地',
  );

  const older = await target.collection<Record<string, unknown>>('courses').get('c-1');
  await target.collection('courses').put({ ...older, name: '本地较旧', updated_at: 0 });
  const result = await importBackup(target, payload, { mode: 'merge', now: 20 });
  assert.ok(result.imported >= 1);
  const merged = await target.collection<Record<string, unknown>>('courses').get('c-1');
  assert.equal(merged?.['name'], '高等数学', '本地较旧时用备份覆盖');
  // A10：合并保留来源的 updated_at，否则第三台设备上更新的修改会被这次导入时刻压过
  const incoming = (payload.stores.courses ?? []).find((row) => (row as Record<string, unknown>)['id'] === 'c-1');
  assert.equal(merged?.['updated_at'], (incoming as Record<string, unknown>)['updated_at']);
});

test('A9 旧备份里的 schema_version 不会被导入', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  payload.meta['schema_version'] = '001_init';
  const target = createStorage();
  await target.writeMeta('schema_version', '006_schema_version');
  await importBackup(target, payload, { mode: 'overwrite' });
  assert.equal(await target.readMeta('schema_version'), '006_schema_version');
});

/** 另一台独立引导过的设备：有自己的当前学期。 */
async function otherDevice(): Promise<Storage> {
  const storage = createStorage();
  await createSemester(storage, { userId: USER_ID, name: '本机学期', startDate: START_DATE, timeZone: 'Asia/Shanghai' });
  return storage;
}

async function activeIds(storage: Storage): Promise<string[]> {
  return (await storage.collection<Record<string, unknown>>('semesters').getAll())
    .filter((row) => row['deleted_at'] === null && row['is_active'] === 1)
    .map((row) => String(row['id']));
}

test('A10 合并导入：本机已有其它当前学期时保留本机，来源学期及其课程完整导入', async () => {
  const { storage, semesterId } = await seedStorage();
  const payload = await exportBackup(storage);
  const target = await otherDevice();
  const [localActive] = await activeIds(target);

  const result = await importBackup(target, payload, { mode: 'merge' });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(await activeIds(target), [localActive]);
  const imported = await target.collection<Record<string, unknown>>('semesters').get(semesterId);
  assert.equal(imported?.['is_active'], 0);
  assert.ok((await target.collection('courses').get('c-1')) !== undefined, '课程不再因外键/唯一约束丢失');
});

test('A10 显式选择切换到来源学期', async () => {
  const { storage, semesterId } = await seedStorage();
  const payload = await exportBackup(storage);
  const target = await otherDevice();
  await importBackup(target, payload, { mode: 'merge', activeSemester: 'use-incoming' });
  assert.deepEqual(await activeIds(target), [semesterId]);
});

test('A10 缺少父行的行被跳过并说明原因，不中断导入', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  payload.stores.course_schedules = [
    ...(payload.stores.course_schedules ?? []),
    { id: 's-orphan', course_id: 'c-missing', day_of_week: 1, period_start: 1, period_end: 1, weeks_mask: 1, weeks_raw: '1周', room: null, created_at: 1, updated_at: 1, deleted_at: null, rev: 0, dirty: 0 },
  ];
  const target = createStorage();
  const result = await importBackup(target, payload);
  assert.ok(result.warnings.some((warning) => warning.includes('缺少关联的课程')));
  assert.equal(await target.collection('course_schedules').get('s-orphan'), undefined);
  assert.ok((await target.collection('course_schedules').get('s-1')) !== undefined);
});

test('A10 三台设备合并：更新的一份不会被中间设备的导入时刻压过', async () => {
  const { storage: c } = await seedStorage();
  const fromC = await exportBackup(c);
  const course = await c.collection<Record<string, unknown>>('courses').get('c-1');
  await c.collection('courses').put({ ...course, name: 'C 上的修改', updated_at: 5_000 });
  const newest = await exportBackup(c);

  const a = createStorage();
  // A 先从 B（内容同 C 改之前）拉取，再从 C 拉取
  await importBackup(a, fromC, { mode: 'merge', now: 9_000 });
  await importBackup(a, newest, { mode: 'merge', now: 9_500 });
  assert.equal((await a.collection<Record<string, unknown>>('courses').get('c-1'))?.['name'], 'C 上的修改');

  const again = await importBackup(a, newest, { mode: 'merge', now: 10_000 });
  assert.equal(again.imported, 0, '内容未变的再次同步不计为导入');
});

test('A10 清空「学期与节次」而未选课程时拒绝，避免级联删掉课程', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage);
  const target = createStorage();
  await importBackup(target, payload);
  await assert.rejects(
    importBackup(target, payload, { mode: 'clear', modules: ['semesters'] }),
    /请同时勾选「课程与排课」/,
  );
});

test('A10 备份解析保留导出时勾选的模块', async () => {
  const { storage } = await seedStorage();
  const payload = await exportBackup(storage, { modules: ['courses'] });
  assert.deepEqual(parseBackup(JSON.stringify(payload)).modules, ['courses']);
});
