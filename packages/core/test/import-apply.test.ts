import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImport, previewDuplicates } from '../src/import/apply.ts';
import { createSemester } from '../src/mutations.ts';
import { weekView } from '../src/repository.ts';
import type { ImportedSchedule } from '../src/import/apply.ts';
import { START_DATE, USER_ID, createStorage, weekRange } from './helpers.ts';

function sample(): ImportedSchedule[] {
  return [
    {
      courseName: '高等数学',
      dayOfWeek: 1,
      periodStart: 1,
      periodEnd: 2,
      weeks: weekRange(1, 16),
      room: '教三-201',
      teacher: '张老师',
    },
    {
      courseName: '大学物理',
      dayOfWeek: 3,
      periodStart: 3,
      periodEnd: 4,
      weeks: weekRange(2, 16, 2),
      room: '理科楼-105',
      teacher: '李老师',
    },
  ];
}

async function newSemester(): Promise<{ storage: ReturnType<typeof createStorage>; semesterId: string }> {
  const storage = createStorage();
  const semester = await createSemester(storage, { userId: USER_ID, name: '第一学期', startDate: START_DATE });
  return { storage, semesterId: String(semester['id']) };
}

test('导入创建课程与排课，并进入周视图', async () => {
  const { storage, semesterId } = await newSemester();
  const result = await applyImport(storage, semesterId, sample());

  assert.equal(result.createdCourses, 2);
  assert.equal(result.createdSchedules, 2);
  assert.equal(result.skippedSchedules, 0);
  assert.deepEqual(result.warnings, []);

  const monday = await weekView(storage, semesterId, 1, 3);
  assert.equal(monday.length, 1);
  assert.equal(monday[0]?.name, '高等数学');
  assert.equal(monday[0]?.room, '教三-201');

  const wednesday = await weekView(storage, semesterId, 3, 4);
  assert.equal(wednesday[0]?.name, '大学物理');
  assert.deepEqual(await weekView(storage, semesterId, 3, 3), []);
});

test('重复导入幂等', async () => {
  const { storage, semesterId } = await newSemester();
  await applyImport(storage, semesterId, sample());
  const second = await applyImport(storage, semesterId, sample());

  assert.equal(second.createdCourses, 0);
  assert.equal(second.createdSchedules, 0);
  assert.equal(second.skippedSchedules, 2);

  const courses = await storage.collection<Record<string, unknown>>('courses').getAll();
  assert.equal(courses.length, 2);
  const schedules = await storage.collection<Record<string, unknown>>('course_schedules').getAll();
  assert.equal(schedules.length, 2);
});

test('同名课程复用', async () => {
  const { storage, semesterId } = await newSemester();
  const result = await applyImport(storage, semesterId, [
    { courseName: '大学英语', dayOfWeek: 2, periodStart: 1, periodEnd: 2, weeks: weekRange(1, 8), room: null, teacher: '王老师' },
    { courseName: '大学英语', dayOfWeek: 4, periodStart: 3, periodEnd: 4, weeks: weekRange(1, 8), room: null, teacher: '王老师' },
  ]);
  assert.equal(result.createdCourses, 1);
  assert.equal(result.createdSchedules, 2);
});

test('无名称或无周次的条目被跳过并给出警告', async () => {
  const { storage, semesterId } = await newSemester();
  const result = await applyImport(storage, semesterId, [
    { courseName: '   ', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: [1], room: null, teacher: null },
    { courseName: '体育', dayOfWeek: 5, periodStart: 5, periodEnd: 6, weeks: [], room: null, teacher: null },
  ]);
  assert.equal(result.createdSchedules, 0);
  assert.equal(result.warnings.length, 2);
});

test('可指定取色板', async () => {
  const { storage, semesterId } = await newSemester();
  await applyImport(storage, semesterId, sample(), { colorPalette: ['#111111', '#222222'] });
  const courses = await storage.collection<Record<string, unknown>>('courses').getAll();
  const colors = courses.map((row) => row['color']).sort();
  assert.deepEqual(colors, ['#111111', '#222222']);
});

test('预检结果与写入跳过一致', async () => {
  const { storage, semesterId } = await newSemester();
  await applyImport(storage, semesterId, sample());

  const incoming: ImportedSchedule[] = [
    // 两条已存在：写入必跳过
    ...sample(),
    // 已存在课程的新排课：不跳过
    { courseName: '高等数学', dayOfWeek: 5, periodStart: 1, periodEnd: 2, weeks: weekRange(1, 16), room: null, teacher: null },
    // 新课程：第一次写入不跳过，同批第二次重复
    { courseName: '新课程', dayOfWeek: 2, periodStart: 5, periodEnd: 6, weeks: weekRange(1, 4), room: null, teacher: null },
    { courseName: '新课程', dayOfWeek: 2, periodStart: 5, periodEnd: 6, weeks: weekRange(1, 4), room: null, teacher: null },
    // 无名称：走警告跳过，不算重复
    { courseName: '   ', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: [1], room: null, teacher: null },
  ];

  const flags = await previewDuplicates(storage, semesterId, incoming);
  assert.deepEqual(flags, [true, true, false, false, true, false]);

  // 预检只读：不会替用户写库
  const before = await storage.collection('course_schedules').getAll();
  assert.equal(before.length, 2);

  const applied = await applyImport(storage, semesterId, incoming);
  assert.equal(applied.skippedSchedules, flags.filter((flag) => flag).length);
  // 非重复的 3 条里，无名称那条只产生警告、不写排课
  assert.equal(applied.createdSchedules, flags.filter((flag) => !flag).length - 1);
  assert.equal(applied.createdCourses, 1);
  assert.equal(applied.warnings.length, 1);
});

test('预检不把其他学期的同名课程当冲突', async () => {
  const { storage, semesterId } = await newSemester();
  await applyImport(storage, semesterId, sample());

  const other = await createSemester(storage, { userId: USER_ID, name: '第二学期', startDate: START_DATE });
  const otherId = String(other['id']);

  const flags = await previewDuplicates(storage, otherId, sample());
  assert.deepEqual(flags, [false, false]);

  const applied = await applyImport(storage, otherId, sample());
  assert.equal(applied.createdCourses, 2);
  assert.equal(applied.createdSchedules, 2);
  assert.equal(applied.skippedSchedules, 0);
});
