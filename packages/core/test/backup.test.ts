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
import { writeSettings } from '../src/settings.ts';
import { activeSemester, weekView } from '../src/repository.ts';
import { START_DATE, USER_ID, createStorage, weekRange } from './helpers.ts';

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
  const onlySettings = await importBackup(target, payload, { modules: ['settings'], mode: 'overwrite', now: 4 });
  assert.equal(onlySettings.imported, Object.keys(payload.meta).length);
  assert.equal((await activeSemester(target, USER_ID))?.id, semesterId);
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
