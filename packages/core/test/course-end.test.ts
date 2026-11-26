import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_END_CONVERT_KEY, convertCourseEnds, truncateScheduleWeeks } from '../src/course-end.ts';
import { addDays, weekStart } from '../src/time.ts';
import { describeWeeks, maskToWeeks, weeksToMask } from '../src/weeks.ts';
import type { Storage } from '../src/storage.ts';
import type { CourseScheduleRow, EventRow } from '../src/types.ts';
import {
  NOW,
  START_DATE,
  createStorage,
  eventRow,
  scheduleRow,
  seedStorage,
  semesterRow,
  weekRange,
} from './kit/index.ts';

// 样例数据：学期 2026-09-07 起 20 周；s-1 周一 1–16 周，s-2 周三 2–16 双周，s-3 周五 1,3,5,7 周

/** 第 week 周星期 dow 的日期。 */
function dateOf(week: number, dayOfWeek: number, start = START_DATE): string {
  return addDays(weekStart(start), (week - 1) * 7 + (dayOfWeek - 1));
}

function cancelRow(id: string, scheduleId: string, onDate: string, createdAt = NOW, overrides: Partial<EventRow> = {}): EventRow {
  return eventRow(id, 'reschedule', {
    title: '停课',
    ref_schedule_id: scheduleId,
    on_date: onDate,
    action: 'cancel',
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  });
}

async function putCancels(storage: Storage, rows: EventRow[]): Promise<void> {
  for (const row of rows) await storage.collection<EventRow>('events').put(row);
}

async function schedule(storage: Storage, id: string): Promise<CourseScheduleRow> {
  const row = await storage.collection<CourseScheduleRow>('course_schedules').get(id);
  assert.ok(row !== undefined, `排课 ${id} 应存在`);
  return row;
}

async function weeksOf(storage: Storage, id: string): Promise<number[]> {
  return maskToWeeks(Number((await schedule(storage, id)).weeks_mask), 30);
}

/** 未删除的停课记录 id，排序后返回。 */
async function liveCancelIds(storage: Storage): Promise<string[]> {
  return (await storage.collection<EventRow>('events').getAll())
    .filter((row) => row.deleted_at === null && row.action === 'cancel')
    .map((row) => row.id)
    .sort();
}

async function seeded(): Promise<Storage> {
  const storage = createStorage();
  await seedStorage(storage);
  return storage;
}

/** s-1 周一从第 from 周到第 16 周每周一条停课，created_at 依次加 step 毫秒。 */
function mondayTail(from: number, step = 100): EventRow[] {
  return weekRange(from, 16).map((week, index) => cancelRow(`mon-${week}`, 's-1', dateOf(week, 1), NOW + index * step));
}

// ---- truncateScheduleWeeks ----

test('truncateScheduleWeeks：截短位图并重写周次文本，删掉给出的停课记录', async () => {
  const storage = await seeded();
  await putCancels(storage, [cancelRow('keep-3', 's-1', dateOf(3, 1)), cancelRow('drop-10', 's-1', dateOf(10, 1))]);
  const outcome = await truncateScheduleWeeks(storage, {
    scheduleId: 's-1',
    keepWeeks: weekRange(1, 8),
    totalWeeks: 20,
    dropEventIds: ['drop-10'],
  });
  assert.equal(outcome, 'updated');
  const row = await schedule(storage, 's-1');
  assert.equal(row.weeks_mask, weeksToMask(weekRange(1, 8)));
  assert.equal(row.weeks_raw, describeWeeks(weeksToMask(weekRange(1, 8)), 20));
  assert.equal(row.weeks_raw, '1-8周');
  assert.equal(row.deleted_at, null);
  assert.deepEqual(await liveCancelIds(storage), ['keep-3']);
  const dropped = await storage.collection<EventRow>('events').get('drop-10');
  assert.notEqual(dropped?.deleted_at ?? null, null, '停课记录软删除');
});

test('truncateScheduleWeeks：保留周次为空时整条排课删除', async () => {
  const storage = await seeded();
  await putCancels(storage, [cancelRow('fri-5', 's-3', dateOf(5, 5))]);
  const outcome = await truncateScheduleWeeks(storage, {
    scheduleId: 's-3',
    keepWeeks: [],
    totalWeeks: 20,
    dropEventIds: ['fri-5'],
  });
  assert.equal(outcome, 'deleted');
  assert.notEqual((await schedule(storage, 's-3')).deleted_at, null);
  assert.deepEqual(await liveCancelIds(storage), []);
  // 别的排课不动
  assert.deepEqual(await weeksOf(storage, 's-1'), weekRange(1, 16));
});

// ---- convertCourseEnds ----

test('convertCourseEnds：同一批写入、直到最后一周的连续停课转成截短周次', async () => {
  const storage = await seeded();
  // 结课前单独停过的一次：不属于结课，保留
  await putCancels(storage, [cancelRow('mon-3', 's-1', dateOf(3, 1), NOW - 86_400_000), ...mondayTail(12)]);
  assert.equal(await convertCourseEnds(storage), 1);
  assert.deepEqual(await weeksOf(storage, 's-1'), weekRange(1, 12));
  assert.equal((await schedule(storage, 's-1')).weeks_raw, '1-12周');
  // 结课那一周的停课保留，之后的删掉
  assert.deepEqual(await liveCancelIds(storage), ['mon-12', 'mon-3']);
  // 其他排课不动
  assert.deepEqual(await weeksOf(storage, 's-2'), weekRange(2, 16, 2));
  assert.deepEqual(await weeksOf(storage, 's-3'), [1, 3, 5, 7]);
  assert.equal(await storage.readMeta(COURSE_END_CONVERT_KEY), '1');
});

test('convertCourseEnds：按排课周次找连续段，单双周不算断开', async () => {
  const storage = await seeded();
  // s-2 只上双周：第 12、14、16 周全停即是连续到最后一周
  await putCancels(
    storage,
    [12, 14, 16].map((week, index) => cancelRow(`wed-${week}`, 's-2', dateOf(week, 3), NOW + index)),
  );
  assert.equal(await convertCourseEnds(storage), 1);
  assert.deepEqual(await weeksOf(storage, 's-2'), weekRange(2, 12, 2));
  assert.deepEqual(await liveCancelIds(storage), ['wed-12']);
});

test('convertCourseEnds：只停了最后一次课不转换', async () => {
  const storage = await seeded();
  await putCancels(storage, mondayTail(16));
  assert.equal(await convertCourseEnds(storage), 0);
  assert.deepEqual(await weeksOf(storage, 's-1'), weekRange(1, 16));
  assert.deepEqual(await liveCancelIds(storage), ['mon-16']);
  // 没有可转换的也记下标记
  assert.equal(await storage.readMeta(COURSE_END_CONVERT_KEY), '1');
});

test('convertCourseEnds：停课记录写入时间相差超过 60 秒不转换，恰好 60 秒仍算同一批', async () => {
  const spread = await seeded();
  await putCancels(spread, [
    cancelRow('mon-14', 's-1', dateOf(14, 1), NOW),
    cancelRow('mon-15', 's-1', dateOf(15, 1), NOW + 30_000),
    cancelRow('mon-16', 's-1', dateOf(16, 1), NOW + 60_001),
  ]);
  assert.equal(await convertCourseEnds(spread), 0);
  assert.deepEqual(await weeksOf(spread, 's-1'), weekRange(1, 16));
  assert.deepEqual(await liveCancelIds(spread), ['mon-14', 'mon-15', 'mon-16']);

  const edge = await seeded();
  await putCancels(edge, [
    cancelRow('mon-15', 's-1', dateOf(15, 1), NOW),
    cancelRow('mon-16', 's-1', dateOf(16, 1), NOW + 60_000),
  ]);
  assert.equal(await convertCourseEnds(edge), 1);
  assert.deepEqual(await weeksOf(edge, 's-1'), weekRange(1, 15));
  assert.deepEqual(await liveCancelIds(edge), ['mon-15']);
});

test('convertCourseEnds：连续段中间缺一周、没停到最后一周或记录不是有效停课时不转换', async () => {
  // 第 15 周照常上：最后一段只有第 16 周
  const gap = await seeded();
  await putCancels(gap, [13, 14, 16].map((week) => cancelRow(`mon-${week}`, 's-1', dateOf(week, 1))));
  assert.equal(await convertCourseEnds(gap), 0);
  assert.deepEqual(await weeksOf(gap, 's-1'), weekRange(1, 16));
  assert.deepEqual(await liveCancelIds(gap), ['mon-13', 'mon-14', 'mon-16']);

  // 停到第 15 周，最后一周照常上
  const open = await seeded();
  await putCancels(open, [12, 13, 14, 15].map((week) => cancelRow(`mon-${week}`, 's-1', dateOf(week, 1))));
  assert.equal(await convertCourseEnds(open), 0);
  assert.deepEqual(await weeksOf(open, 's-1'), weekRange(1, 16));

  // 已删除的停课与改期记录都不算停课
  const other = await seeded();
  await putCancels(other, [
    cancelRow('mon-14', 's-1', dateOf(14, 1)),
    cancelRow('mon-15', 's-1', dateOf(15, 1), NOW, { deleted_at: NOW + 1 }),
    cancelRow('mon-16', 's-1', dateOf(16, 1), NOW, { action: 'move', new_date: dateOf(16, 2) }),
  ]);
  assert.equal(await convertCourseEnds(other), 0);
  assert.deepEqual(await weeksOf(other, 's-1'), weekRange(1, 16));
});

test('convertCourseEnds：只看学期总周数以内的周次', async () => {
  const storage = await seeded();
  // 位图里有第 21、22 周，学期只有 20 周
  await storage
    .collection<CourseScheduleRow>('course_schedules')
    .put(scheduleRow('s-4', 'c-3', weekRange(1, 22), { day_of_week: 2, period_start: 3, period_end: 4 }));
  await putCancels(storage, [18, 19, 20].map((week) => cancelRow(`tue-${week}`, 's-4', dateOf(week, 2))));
  assert.equal(await convertCourseEnds(storage), 1);
  assert.deepEqual(await weeksOf(storage, 's-4'), weekRange(1, 18));
  assert.deepEqual(await liveCancelIds(storage), ['tue-18']);
});

test('convertCourseEnds：只执行一次，第二次调用不再改动', async () => {
  const storage = await seeded();
  await putCancels(storage, mondayTail(10));
  assert.equal(await convertCourseEnds(storage), 1);
  assert.deepEqual(await weeksOf(storage, 's-1'), weekRange(1, 10));
  // 标记已写：之后新出现的同类停课也不再转换
  await putCancels(
    storage,
    [14, 16].map((week) => cancelRow(`wed-${week}`, 's-2', dateOf(week, 3))),
  );
  assert.equal(await convertCourseEnds(storage), 0);
  assert.deepEqual(await weeksOf(storage, 's-2'), weekRange(2, 16, 2));
  assert.deepEqual(await liveCancelIds(storage), ['mon-10', 'wed-14', 'wed-16']);
});

test('convertCourseEnds：日期推算与本机时区无关（跨夏令时切换）', async () => {
  // 学期 2026-03-02 起；美国 2026-03-08（第 1 周周日）进入夏令时
  const start = '2026-03-02';
  const original = process.env['TZ'];
  try {
    for (const zone of ['Asia/Shanghai', 'Asia/Kolkata', 'America/New_York', 'Pacific/Kiritimati', 'Etc/GMT+12']) {
      process.env['TZ'] = zone;
      const storage = await seeded();
      await storage.collection('semesters').put(semesterRow({ start_date: start }));
      await storage
        .collection<CourseScheduleRow>('course_schedules')
        .put(scheduleRow('s-sun', 'c-3', weekRange(1, 4), { day_of_week: 7, period_start: 1, period_end: 2 }));
      const dates = weekRange(1, 4).map((week) => dateOf(week, 7, start));
      assert.deepEqual(dates, ['2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29'], zone);
      await putCancels(
        storage,
        dates.map((date, index) => cancelRow(`sun-${index + 1}`, 's-sun', date)),
      );
      assert.equal(await convertCourseEnds(storage), 1, zone);
      assert.deepEqual(await weeksOf(storage, 's-sun'), [1], zone);
      assert.deepEqual(await liveCancelIds(storage), ['sun-1'], zone);
    }
  } finally {
    if (original === undefined) delete process.env['TZ'];
    else process.env['TZ'] = original;
  }
});
