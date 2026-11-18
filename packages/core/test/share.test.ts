import test from 'node:test';
import assert from 'node:assert/strict';
import { importBackup } from '../src/backup.ts';
import { createSemester, uuidv7 } from '../src/mutations.ts';
import {
  exportSemesterShare,
  parseShare,
  SHARE_FORMAT,
  SHARE_MODULES,
  shareToBackup,
  uniqueShareName,
  type SharePayload,
} from '../src/share.ts';
import type { Storage } from '../src/storage.ts';
import { START_DATE, USER_ID, createStorage, eventRow, weekRange } from './kit/index.ts';

const NOW = Date.parse('2026-11-18T12:00:00+08:00');
const sync = { created_at: 1, updated_at: 1, deleted_at: null, rev: 0, dirty: 0 };

async function seed(): Promise<{ storage: Storage; semesterId: string }> {
  const storage = createStorage();
  const semester = await createSemester(storage, {
    userId: USER_ID, name: '2026 秋', startDate: START_DATE, timeZone: 'Asia/Shanghai',
  });
  const semesterId = String(semester['id']);
  const course = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, semester_id: semesterId, name, short_name: null, teacher: '张老师', location: '教三', color: '#4F8DFD',
    credits: 2, note: '私人备注', ...sync, ...extra,
  });
  await storage.collection('courses').putMany([course('c-1', '高等数学'), course('c-gone', '已删课', { deleted_at: 5 })]);
  const mask = weekRange(1, 16).reduce((acc, week) => acc | (1 << (week - 1)), 0);
  const schedule = (id: string, courseId: string, extra: Record<string, unknown> = {}) => ({
    id, course_id: courseId, day_of_week: 1, period_start: 1, period_end: 2, weeks_mask: mask, weeks_raw: '1-16周',
    room: null, start_time: null, end_time: null, ...sync, ...extra,
  });
  await storage.collection('course_schedules').putMany([
    schedule('s-1', 'c-1'),
    schedule('s-2', 'c-1', { day_of_week: 3, deleted_at: 5 }),
  ]);
  await storage.collection('events').put(eventRow('e-1', 'exam', { semester_id: semesterId, title: '期末' }));
  return { storage, semesterId };
}

async function importShare(storage: Storage, share: SharePayload) {
  const semesters = await storage.collection<Record<string, unknown>>('semesters').getAll();
  const payload = shareToBackup(share, {
    userId: USER_ID,
    existingNames: semesters.map((row) => String(row['name'])),
    newId: uuidv7,
    now: NOW,
  });
  return importBackup(storage, payload, { mode: 'skip', modules: SHARE_MODULES, activeSemester: 'keep-local', now: NOW });
}

test('分享文件只含学期、节次、课程与排课，不带备注、软删行与同步列', async () => {
  const { storage, semesterId } = await seed();
  const share = await exportSemesterShare(storage, semesterId, NOW);
  assert.equal(share.format, SHARE_FORMAT);
  assert.equal(share.semester.name, '2026 秋');
  assert.deepEqual(share.courses.map((row) => row.id), ['c-1']);
  assert.equal(share.courses[0]?.note, null);
  assert.deepEqual(share.schedules.map((row) => row.id), ['s-1']);
  const text = JSON.stringify(share);
  for (const key of ['user_id', 'is_active', 'updated_at', 'dirty', 'rev', '私人备注', '期末']) {
    assert.ok(!text.includes(key), `分享文件不该含 ${key}`);
  }
  assert.deepEqual(Object.keys(share).sort(), ['courses', 'exportedAt', 'format', 'schedules', 'semester', 'timeSlots', 'version']);
});

test('分享文件导入本机：新 id、非当前、重名加后缀，原学期不受影响', async () => {
  const { storage, semesterId } = await seed();
  const share = parseShare(JSON.stringify(await exportSemesterShare(storage, semesterId, NOW)));
  const first = await importShare(storage, share);
  assert.deepEqual(first.warnings, []);
  const second = await importShare(storage, share);
  assert.equal(second.imported, first.imported);
  const semesters = (await storage.collection<Record<string, unknown>>('semesters').getAll()).filter((row) => row['deleted_at'] === null);
  assert.deepEqual(semesters.map((row) => row['name']).sort(), ['2026 秋', '2026 秋（分享 2）', '2026 秋（分享）']);
  assert.equal(semesters.filter((row) => row['is_active'] === 1).length, 1);
  assert.equal(semesters.find((row) => row['id'] === semesterId)?.['is_active'], 1);
  const courses = await storage.collection<Record<string, unknown>>('courses').getAll();
  assert.equal(courses.filter((row) => row['name'] === '高等数学').length, 3);
  assert.equal(courses.find((row) => row['id'] === 'c-1')?.['note'], '私人备注');
  const events = await storage.collection('events').getAll();
  assert.equal(events.length, 1, '不导入日程');
});

test('分享文件导入另一台设备：节次随学期一起落库', async () => {
  const { storage, semesterId } = await seed();
  const share = await exportSemesterShare(storage, semesterId, NOW);
  const target = createStorage();
  await createSemester(target, { userId: USER_ID, name: '本机学期', startDate: START_DATE, timeZone: 'Asia/Shanghai' });
  const result = await importShare(target, share);
  assert.deepEqual(result.warnings, []);
  const imported = (await target.collection<Record<string, unknown>>('semesters').getAll()).find((row) => row['name'] === '2026 秋');
  assert.ok(imported !== undefined);
  assert.equal(imported['is_active'], 0);
  const slots = (await target.collection<Record<string, unknown>>('time_slots').getAll()).filter((row) => row['semester_id'] === imported['id']);
  assert.equal(slots.length, share.timeSlots.length);
  assert.equal((await target.collection('reminders').getAll()).length, 0);
});

test('分享文件里引用不到的排课被外键检查跳过，不会挂到本机同 id 课程上', async () => {
  const { storage, semesterId } = await seed();
  const share = await exportSemesterShare(storage, semesterId, NOW);
  // 指向本机已有课程 c-1、但文件里没有这门课
  const broken: SharePayload = { ...share, schedules: [...share.schedules, { ...share.schedules[0]!, id: 's-x', course_id: 'c-local' }] };
  const target = storage;
  await target.collection('courses').put({ ...(await target.collection<Record<string, unknown>>('courses').get('c-1'))!, id: 'c-local' });
  const before = (await target.collection<Record<string, unknown>>('course_schedules').getAll()).length;
  const result = await importShare(target, broken);
  const after = (await target.collection<Record<string, unknown>>('course_schedules').getAll()).length;
  assert.equal(after - before, 1);
  assert.equal(result.skipped, 1);
  assert.ok(result.warnings.some((item) => item.includes('缺少关联的课程')));
  assert.equal((await target.collection<Record<string, unknown>>('course_schedules').getAll()).filter((row) => row['course_id'] === 'c-local').length, 0);
});

test('分享文件解析：拒绝备份文件与更高版本', () => {
  assert.throws(() => parseShare('{'), /不是合法 JSON/);
  assert.throws(() => parseShare(JSON.stringify({ format: 'dawn-tick-backup', version: 1 })), /不是晓刻 DawnTick 课表分享文件/);
  assert.throws(() => parseShare(JSON.stringify({ format: SHARE_FORMAT, version: 99, semester: { id: 'x' } })), /高于/);
  assert.throws(() => parseShare(JSON.stringify({ format: SHARE_FORMAT, version: 1 })), /缺少学期/);
});

test('重名后缀', () => {
  assert.equal(uniqueShareName('A', []), 'A');
  assert.equal(uniqueShareName('A', ['A']), 'A（分享）');
  assert.equal(uniqueShareName('A', ['A', 'A（分享）']), 'A（分享 2）');
});
