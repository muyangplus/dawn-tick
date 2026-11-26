import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCourse,
  createSchedule,
  createSemester,
  dateWallClockToEpoch,
  dayOfWeek,
  listManagedCourses,
  listTimeSlots,
  weekOfDate,
  weekStart,
  createReschedule,
  describeWeeks,
  validatedStorage,
  weeksToMask,
  type ManagedCourse,
  type SemesterRow,
  type Storage,
} from '@dawn-tick/core';
import { createStorage } from '@dawn-tick/core/testing';
import { weekDateOf } from '../src/data.ts';
import { adjustCopy } from '../src/copy/timetable-adjust.ts';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import {
  applyCancel,
  applyCancelBatch,
  applyExam,
  applyExtra,
  applyMove,
  applySwap,
  examClockOf,
  overlapAt,
  periodsValid,
  planCancel,
  planCancelBatch,
  planExam,
  planExtra,
  planMove,
  planSwap,
  semesterDateError,
} from '../src/screens/timetable/move-controller.ts';

const USER_ID = 'u1';
const TIME_ZONE = 'Asia/Shanghai';
/** 学期起点固定为 2026-03-02（周一），用例不依赖「今天」 */
const START = '2026-03-02';
const TOTAL_WEEKS = 20;

async function open(name: string): Promise<Storage> {
  return validatedStorage(await openIndexedDbStorage(name));
}

interface Seeded {
  semester: SemesterRow;
  /** 周一 1–2 节的课程 */
  math: ManagedCourse;
  /** 周一 2–3 节，用来验证时间冲突判定 */
  english: ManagedCourse;
}

async function seed(storage: Storage): Promise<Seeded> {
  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '测试学期',
    startDate: START,
    totalWeeks: TOTAL_WEEKS,
    timeZone: TIME_ZONE,
  });
  const semesterId = String(semester['id']);
  const math = await createCourse(storage, {
    semesterId,
    name: '高等数学',
    shortName: '高数',
    location: '教三-201',
  });
  const english = await createCourse(storage, { semesterId, name: '大学英语', shortName: '英语' });
  await createSchedule(storage, {
    courseId: String(math['id']),
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: Array.from({ length: TOTAL_WEEKS }, (_, index) => index + 1),
  });
  await createSchedule(storage, {
    courseId: String(english['id']),
    dayOfWeek: 1,
    periodStart: 2,
    periodEnd: 3,
    weeks: Array.from({ length: TOTAL_WEEKS }, (_, index) => index + 1),
  });
  const courses = await listManagedCourses(storage, semesterId);
  const mathCourse = courses.find((course) => course.name === '高等数学');
  const englishCourse = courses.find((course) => course.name === '大学英语');
  assert.ok(mathCourse !== undefined && englishCourse !== undefined);
  assert.ok(mathCourse.schedules[0] !== undefined);
  return {
    semester: semester as unknown as SemesterRow,
    math: mathCourse,
    english: englishCourse,
  };
}

test('periodsValid：1 起、整数、结束不小于开始', () => {
  assert.equal(periodsValid(1, 2), true);
  assert.equal(periodsValid(3, 3), true);
  assert.equal(periodsValid(0, 2), false);
  assert.equal(periodsValid(2, 1), false);
  assert.equal(periodsValid(1.5, 3), false);
});

test('semesterDateError：学期外与格式不全都给出可读说明', async () => {
  const storage = await open('move-date-error');
  const { semester } = await seed(storage);
  assert.equal(semesterDateError(null, START, '原日期'), adjustCopy.noSemester);
  assert.equal(semesterDateError(semester, '2026-3-2', '原日期'), adjustCopy.pickDate('原日期'));
  const before = weekDateOf(semester, 1, 1);
  const after = weekDateOf(semester, TOTAL_WEEKS, 7);
  assert.equal(
    semesterDateError(semester, '2026-02-01', '原日期'),
    adjustCopy.dateOutOfSemester('原日期', before, after),
  );
  assert.equal(semesterDateError(semester, '2027-01-01', '调整后日期'), adjustCopy.dateOutOfSemester('调整后日期', before, after));
  assert.equal(semesterDateError(semester, before, '原日期'), null);
  assert.equal(semesterDateError(semester, after, '原日期'), null);
});

test('overlapAt：按星期 / 节次 / 周次判定冲突，并排除自己', async () => {
  const storage = await open('move-overlap');
  const { math, english, semester } = await seed(storage);
  const courses = [math, english];
  const mathId = math.id;
  // 周一 1–2 节与英语 2–3 节重叠：排除其中一门后只剩另一门
  assert.deepEqual(
    overlapAt(courses, { dayOfWeek: 1, periodStart: 1, periodEnd: 2, week: 1, excludeCourseId: english.id }),
    { name: '高等数学', start: 1, end: 2 },
  );
  assert.deepEqual(
    overlapAt(courses, { dayOfWeek: 1, periodStart: 1, periodEnd: 2, week: 1, excludeCourseId: mathId }),
    { name: '大学英语', start: 2, end: 3 },
  );
  // 不同星期、不重叠节次、学期外的周次都不算冲突
  assert.equal(overlapAt(courses, { dayOfWeek: 2, periodStart: 1, periodEnd: 2, week: 1, excludeCourseId: '' }), null);
  assert.equal(overlapAt(courses, { dayOfWeek: 1, periodStart: 5, periodEnd: 6, week: 1, excludeCourseId: '' }), null);
  assert.equal(
    overlapAt(courses, { dayOfWeek: 1, periodStart: 1, periodEnd: 2, week: TOTAL_WEEKS + 1, excludeCourseId: '' }),
    null,
  );
  // 不限周次（每周生效）时按星期与节次判
  assert.notEqual(overlapAt(courses, { dayOfWeek: 1, periodStart: 1, periodEnd: 2, week: null, excludeCourseId: mathId }), null);
  assert.equal(weekOfDate(weekDateOf(semester, 3, 1), semester.start_date), 3);
});

test('planMove：每周改课时表本身，不记调课', async () => {
  const storage = await open('move-plan-weekly');
  const { semester, math } = await seed(storage);
  const schedule = math.schedules[0];
  assert.ok(schedule !== undefined);
  const same = planMove({
    semester,
    schedule,
    scope: 'weekly',
    sourceDate: weekDateOf(semester, 1, 1),
    newDate: weekDateOf(semester, 1, 1),
    targetWeek: '1',
    periodStart: 1,
    periodEnd: 2,
  });
  assert.deepEqual(same, { ok: false, message: adjustCopy.sameAsBefore });

  const planned = planMove({
    semester,
    schedule,
    scope: 'weekly',
    sourceDate: weekDateOf(semester, 1, 1),
    newDate: weekDateOf(semester, 1, 3),
    targetWeek: '1',
    periodStart: 1,
    periodEnd: 2,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.plan.scope, 'weekly');
  assert.equal(planned.plan.dayOfWeek, 3);
  assert.equal(planned.plan.week, null);
  assert.equal(planned.plan.scheduleId, schedule.id);
});

test('planMove：这一次 / 指定周 / 指定日期 的溢出与跨周校验', async () => {
  const storage = await open('move-plan-dated');
  const { semester, math } = await seed(storage);
  const schedule = math.schedules[0];
  assert.ok(schedule !== undefined);
  const base = {
    semester,
    schedule,
    sourceDate: weekDateOf(semester, 2, 1),
    periodStart: 1,
    periodEnd: 2,
  };

  // 这一次：跨周被拒
  assert.deepEqual(planMove({ ...base, scope: 'this', newDate: weekDateOf(semester, 3, 1), targetWeek: '3' }), {
    ok: false,
    message: adjustCopy.thisScopeCrossWeek,
  });
  // 这一次：同周换节次通过
  const thisWeek = planMove({ ...base, scope: 'this', newDate: weekDateOf(semester, 2, 1), targetWeek: '2', periodEnd: 4 });
  assert.equal(thisWeek.ok, true);
  if (thisWeek.ok) {
    assert.equal(thisWeek.plan.scope, 'this');
    assert.equal(thisWeek.plan.finalDate, weekDateOf(semester, 2, 1));
    assert.equal(thisWeek.plan.periodEnd, 4);
    assert.equal(thisWeek.plan.week, 2);
  }

  // 指定周：周次越界
  assert.deepEqual(planMove({ ...base, scope: 'week', newDate: weekDateOf(semester, 2, 1), targetWeek: '21' }), {
    ok: false,
    message: adjustCopy.targetWeekRange(TOTAL_WEEKS),
  });
  // 指定周：按目标日期的星期几落在目标周
  const byWeek = planMove({ ...base, scope: 'week', newDate: weekDateOf(semester, 2, 5), targetWeek: '6' });
  assert.equal(byWeek.ok, true);
  if (byWeek.ok) {
    assert.equal(byWeek.plan.finalDate, weekDateOf(semester, 6, 5));
    assert.equal(byWeek.plan.dayOfWeek, 5);
    assert.equal(byWeek.plan.week, 6);
  }

  // 指定日期：可跨周、可换星期
  const byDate = planMove({ ...base, scope: 'date', newDate: weekDateOf(semester, 8, 4), targetWeek: '2' });
  assert.equal(byDate.ok, true);
  if (byDate.ok) assert.equal(byDate.plan.finalDate, weekDateOf(semester, 8, 4));

  // 学期外与非法节次
  assert.deepEqual(planMove({ ...base, scope: 'date', newDate: '2027-01-06', targetWeek: '2' }), {
    ok: false,
    message: adjustCopy.dateOutOfSemester('调整后日期', weekDateOf(semester, 1, 1), weekDateOf(semester, TOTAL_WEEKS, 7)),
  });
  assert.deepEqual(planMove({ ...base, scope: 'date', newDate: weekDateOf(semester, 2, 1), targetWeek: '2', periodEnd: 0 }), {
    ok: false,
    message: adjustCopy.invalidPeriods,
  });
  // 没选课次
  assert.deepEqual(planMove({ ...base, schedule: undefined, scope: 'this', newDate: base.sourceDate, targetWeek: '2' }), {
    ok: false,
    message: adjustCopy.pickMoveSource,
  });
});

test('applyMove：每周改排课本身，其余记一条调课', async () => {
  const storage = await open('move-apply');
  const { semester, math } = await seed(storage);
  const schedule = math.schedules[0];
  assert.ok(schedule !== undefined);
  const planned = planMove({
    semester,
    schedule,
    scope: 'weekly',
    sourceDate: weekDateOf(semester, 1, 1),
    newDate: weekDateOf(semester, 1, 3),
    targetWeek: '1',
    periodStart: 5,
    periodEnd: 6,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  await applyMove(storage, planned.plan, {
    userId: USER_ID,
    semesterId: semester.id,
    courseName: math.name,
    sourceDate: weekDateOf(semester, 1, 1),
  });
  const schedules = (await storage.collection<Record<string, unknown>>('course_schedules').getAll()).filter(
    (row) => String(row['course_id']) === math.id && row['day_of_week'] === 3,
  );
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0]?.['period_start'], 5);
  assert.equal(schedules[0]?.['period_end'], 6);

  const sourceDate = weekDateOf(semester, 2, 1);
  const dated = planMove({
    semester,
    schedule: { ...schedule, dayOfWeek: 3, periodStart: 5, periodEnd: 6 },
    scope: 'date',
    sourceDate,
    newDate: weekDateOf(semester, 3, 2),
    targetWeek: '3',
    periodStart: 1,
    periodEnd: 2,
  });
  assert.equal(dated.ok, true);
  if (!dated.ok) return;
  await applyMove(storage, dated.plan, {
    userId: USER_ID,
    semesterId: semester.id,
    courseName: math.name,
    sourceDate,
    room: '教一-101',
  });
  const events = (await storage.collection<Record<string, unknown>>('events').getAll()).filter(
    (row) => row['type'] === 'reschedule',
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.['ref_schedule_id'], schedule.id);
  assert.equal(events[0]?.['on_date'], sourceDate);
  assert.equal(events[0]?.['action'], 'move');
  assert.equal(events[0]?.['new_date'], weekDateOf(semester, 3, 2));
  assert.equal(events[0]?.['new_period_start'], 1);
  assert.equal(events[0]?.['new_period_end'], 2);
  assert.equal(events[0]?.['new_room'], '教一-101');
  assert.equal(events[0]?.['as_day_of_week'], 2);
});

test('planCancel / applyCancel：只停原日期那一次', async () => {
  const storage = await open('move-cancel');
  const { semester, math } = await seed(storage);
  const schedule = math.schedules[0];
  assert.ok(schedule !== undefined);
  const sourceDate = weekDateOf(semester, 4, 1);
  assert.deepEqual(planCancel({ semester: null, schedule, sourceDate }), {
    ok: false,
    message: adjustCopy.pickCancelSource,
  });
  const planned = planCancel({ semester, schedule, sourceDate });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  await applyCancel(storage, planned.plan, {
    userId: USER_ID,
    semesterId: semester.id,
    courseName: math.name,
    sourceDate,
  });
  const events = (await storage.collection<Record<string, unknown>>('events').getAll()).filter(
    (row) => row['action'] === 'cancel',
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.['on_date'], sourceDate);
  assert.equal(events[0]?.['title'], '停课：高等数学');
});

test('examClockOf / planExam：节次换钟点并校验日期、节次与作息', async () => {
  const storage = await open('move-exam-plan');
  const { semester, math } = await seed(storage);
  const schedule = math.schedules[0];
  assert.ok(schedule !== undefined);
  const slots = await listTimeSlots(storage, semester.id);
  const sourceDate = weekDateOf(semester, 5, 1);
  const examDate = weekDateOf(semester, 6, 3);
  const base = {
    semester,
    schedule,
    courseId: math.id,
    courseName: math.name,
    sourceDate,
    date: examDate,
    periodStart: 3,
    periodEnd: 4,
    note: '',
    slots,
    timeZone: TIME_ZONE,
  };

  // 节次 → 起止钟点：第 3 节开始、第 4 节结束
  assert.deepEqual(examClockOf(slots, 3, 4), {
    startTime: slots.find((slot) => slot.period_no === 3)?.start_time,
    endTime: slots.find((slot) => slot.period_no === 4)?.end_time,
  });
  assert.equal(examClockOf(slots, 39, 40), null);

  const planned = planExam({ ...base, note: ' 开卷 ' });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.plan.scheduleId, schedule.id);
  assert.equal(planned.plan.courseId, math.id);
  assert.equal(planned.plan.title, '高等数学');
  assert.equal(planned.plan.date, examDate);
  assert.equal(planned.plan.dayOfWeek, 3);
  assert.equal(planned.plan.periodStart, 3);
  assert.equal(planned.plan.periodEnd, 4);
  // 考试时间取节次对应的起止钟点，并换算成同一时区的时间戳
  assert.equal(planned.plan.startAt, dateWallClockToEpoch(examDate, planned.plan.startTime, TIME_ZONE));
  assert.equal(planned.plan.endAt, dateWallClockToEpoch(examDate, planned.plan.endTime, TIME_ZONE));
  assert.equal(planned.plan.note, '开卷');

  // 校验口径与改期一致：缺课次 / 节次非法 / 学期外 / 没有这节作息
  assert.deepEqual(planExam({ ...base, schedule: undefined }), {
    ok: false,
    message: adjustCopy.pickExamSource,
  });
  assert.deepEqual(planExam({ ...base, periodEnd: 0 }), {
    ok: false,
    message: adjustCopy.invalidPeriods,
  });
  assert.deepEqual(planExam({ ...base, date: '2027-01-01' }), {
    ok: false,
    message: adjustCopy.dateOutOfSemester('考试日期', weekDateOf(semester, 1, 1), weekDateOf(semester, TOTAL_WEEKS, 7)),
  });
  assert.deepEqual(planExam({ ...base, periodStart: 39, periodEnd: 40 }), {
    ok: false,
    message: adjustCopy.noSlotForPeriods(39, 40),
  });
});

test('applyExam：写一条考试并停掉原课次', async () => {
  const storage = await open('move-exam-apply');
  const { semester, math } = await seed(storage);
  const schedule = math.schedules[0];
  assert.ok(schedule !== undefined);
  const slots = await listTimeSlots(storage, semester.id);
  const sourceDate = weekDateOf(semester, 5, 1);
  const examDate = weekDateOf(semester, 6, 3);
  const planned = planExam({
    semester,
    schedule,
    courseId: math.id,
    courseName: math.name,
    sourceDate,
    date: examDate,
    periodStart: 3,
    periodEnd: 4,
    note: '开卷',
    slots,
    timeZone: TIME_ZONE,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  await applyExam(storage, planned.plan, { userId: USER_ID, semesterId: semester.id });

  const events = await storage.collection<Record<string, unknown>>('events').getAll();
  const exam = events.find((row) => row['type'] === 'exam');
  assert.ok(exam !== undefined);
  assert.equal(exam['title'], '高等数学');
  assert.equal(exam['on_date'], examDate);
  assert.equal(exam['start_at'], planned.plan.startAt);
  assert.equal(exam['end_at'], planned.plan.endAt);
  assert.equal(exam['subject'], math.id);
  assert.equal(exam['note'], '开卷');
  assert.equal(exam['countdown'], 1);
  assert.equal(exam['start_time'], planned.plan.startTime);
  assert.equal(exam['end_time'], planned.plan.endTime);
  assert.equal(exam['as_day_of_week'], 3);
  assert.equal(exam['show_in_timetable'], 1);
  // 节次列只留给实验：考试按起止钟点进课表
  assert.equal(exam['period_start'], null);
  assert.equal(exam['period_end'], null);
  // 原课次按停课移除：调课记录指向原排课与原日期
  const cancelled = events.filter((row) => row['type'] === 'reschedule' && row['action'] === 'cancel');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0]?.['ref_schedule_id'], schedule.id);
  assert.equal(cancelled[0]?.['on_date'], sourceDate);
  assert.equal(cancelled[0]?.['title'], '改为考试：高等数学');
  assert.ok(events.length >= 2);
});

test('planSwap / applySwap：记一条调休', async () => {
  const storage = await open('move-swap');
  const { semester } = await seed(storage);
  assert.deepEqual(planSwap({ semester, restFrom: '2026-02-01', restTo: weekDateOf(semester, 1, 2) }), {
    ok: false,
    message: adjustCopy.dateOutOfSemester('原日期课表', weekDateOf(semester, 1, 1), weekDateOf(semester, TOTAL_WEEKS, 7)),
  });
  const planned = planSwap({ semester, restFrom: weekDateOf(semester, 1, 2), restTo: weekDateOf(semester, 1, 4) });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  await applySwap(storage, planned.plan, { userId: USER_ID, semesterId: semester.id });
  const events = (await storage.collection<Record<string, unknown>>('events').getAll()).filter(
    (row) => row['type'] === 'makeup',
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.['on_date'], weekDateOf(semester, 1, 4));
  assert.equal(events[0]?.['as_day_of_week'], dayOfWeek(weekDateOf(semester, 1, 2)));
});

test('planExtra / applyExtra：用已有课程或新建课程只加这一次', async () => {
  const storage = await open('move-extra');
  const { semester, math } = await seed(storage);
  const date = weekDateOf(semester, 5, 6);
  assert.deepEqual(
    planExtra({ semester, courseId: '', courseName: '   ', date, periodStart: 1, periodEnd: 2 }),
    { ok: false, message: adjustCopy.pickExtraCourse },
  );
  assert.deepEqual(
    planExtra({ semester, courseId: math.id, courseName: '', date, periodStart: 0, periodEnd: 2 }),
    { ok: false, message: adjustCopy.invalidPeriods },
  );

  const existing = planExtra({ semester, courseId: math.id, courseName: '', date, periodStart: 7, periodEnd: 8 });
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.plan.week, 5);
  assert.equal(existing.plan.dayOfWeek, 6);
  await applyExtra(storage, existing.plan, { semesterId: semester.id });

  const fresh = planExtra({ semester, courseId: '', courseName: ' 形势与政策 ', date, periodStart: 9, periodEnd: 10 });
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;
  assert.equal(fresh.plan.newCourseName, '形势与政策');
  await applyExtra(storage, fresh.plan, { semesterId: semester.id });

  const courses = await listManagedCourses(storage, semester.id);
  const created = courses.find((course) => course.name === '形势与政策');
  assert.ok(created !== undefined);
  assert.equal(created.shortName, '形势与政');
  const added = created.schedules.map((schedule) => [schedule.dayOfWeek, schedule.periodStart, schedule.periodEnd]);
  assert.deepEqual(added, [[6, 9, 10]]);
  const mathSchedules = courses.find((course) => course.id === math.id);
  assert.ok(mathSchedules !== undefined);
  assert.ok(mathSchedules.schedules.some((schedule) => schedule.dayOfWeek === 6 && schedule.periodStart === 7));
});

/** 给高数再加一个周三 3–4 节、只上单周的时段，用来测「整门课」与周次过滤 */
async function seedTwoSchedules(
  name: string,
  given?: Storage,
): Promise<{ storage: Storage; semester: SemesterRow; math: ManagedCourse }> {
  const storage = given ?? (await open(name));
  const { semester, math } = await seed(storage);
  await createSchedule(storage, {
    courseId: math.id,
    dayOfWeek: 3,
    periodStart: 3,
    periodEnd: 4,
    weeks: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19],
  });
  const courses = await listManagedCourses(storage, semester.id);
  const refreshed = courses.find((course) => course.id === math.id);
  assert.ok(refreshed !== undefined && refreshed.schedules.length === 2);
  // 存储读出的排课顺序不固定（同一毫秒内的 id 随机），按星期排好让结果顺序可断言
  const schedules = [...refreshed.schedules].sort((left, right) => left.dayOfWeek - right.dayOfWeek);
  return { storage, semester, math: { ...refreshed, schedules } };
}

/** 第 1 周到第 `last` 周。 */
function weeksUpTo(last: number): number[] {
  return Array.from({ length: last }, (_, index) => index + 1);
}

function scheduleOn(course: ManagedCourse, dayOfWeek: number): ManagedCourse['schedules'][number] {
  const schedule = course.schedules.find((row) => row.dayOfWeek === dayOfWeek);
  assert.ok(schedule !== undefined);
  return schedule;
}

test('planCancelBatch：缺学期 / 课程 / 时段时要求先选课', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-missing');
  const base = { range: 'this', target: 'schedule', from: START, to: START, cancelledKeys: new Map<string, string>() } as const;
  const expected = { ok: false, message: adjustCopy.pickCancelSource };
  assert.deepEqual(planCancelBatch({ ...base, semester: null, course: math, schedule: scheduleOn(math, 1) }), expected);
  assert.deepEqual(planCancelBatch({ ...base, semester, course: undefined, schedule: scheduleOn(math, 1) }), expected);
  assert.deepEqual(planCancelBatch({ ...base, semester, course: math, schedule: undefined }), expected);
  // 整门课不需要选具体时段
  assert.equal(planCancelBatch({ ...base, semester, course: math, schedule: undefined, target: 'course' }).ok, true);
});

test('planCancelBatch：只这一次 + 这个时段，只停原日期', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-this');
  const monday = scheduleOn(math, 1);
  const date = weekDateOf(semester, 4, 1);
  const planned = planCancelBatch({
    semester,
    course: math,
    schedule: monday,
    range: 'this',
    target: 'schedule',
    from: date,
    to: '2026-07-01',
    cancelledKeys: new Map(),
  });
  assert.deepEqual(planned, { ok: true, entries: [{ scheduleId: monday.id, date }], truncations: [], endWeek: null });
});

test('planCancelBatch：只这一次 + 整门课，只停这一天里这门课的全部时段', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-this-course');
  const date = weekDateOf(semester, 3, 3);
  const planned = planCancelBatch({
    semester,
    course: math,
    schedule: scheduleOn(math, 1),
    range: 'this',
    target: 'course',
    from: date,
    to: date,
    cancelledKeys: new Map(),
  });
  // 周一的时段在这天不上，只有周三那个时段
  assert.deepEqual(planned, {
    ok: true,
    entries: [{ scheduleId: scheduleOn(math, 3).id, date }],
    truncations: [],
    endWeek: null,
  });
});

test('planCancelBatch：一段日期两端都算，按日期排序并遵守周次', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-range');
  const monday = scheduleOn(math, 1);
  const wednesday = scheduleOn(math, 3);
  const from = weekDateOf(semester, 2, 1);
  const to = weekDateOf(semester, 4, 1);
  const planned = planCancelBatch({
    semester,
    course: math,
    schedule: monday,
    range: 'range',
    target: 'course',
    from,
    to,
    cancelledKeys: new Map(),
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  // 周三只上单周：第 2 周没有，第 3 周有；第 4 周周三在结束日之后
  assert.deepEqual(planned.entries, [
    { scheduleId: monday.id, date: weekDateOf(semester, 2, 1) },
    { scheduleId: monday.id, date: weekDateOf(semester, 3, 1) },
    { scheduleId: wednesday.id, date: weekDateOf(semester, 3, 3) },
    { scheduleId: monday.id, date: weekDateOf(semester, 4, 1) },
  ]);

  const onlySchedule = planCancelBatch({
    semester,
    course: math,
    schedule: wednesday,
    range: 'range',
    target: 'schedule',
    from: weekDateOf(semester, 1, 1),
    to: weekDateOf(semester, 6, 7),
    cancelledKeys: new Map(),
  });
  assert.deepEqual(
    onlySchedule.ok ? onlySchedule.entries.map((entry) => entry.date) : [],
    [1, 3, 5].map((week) => weekDateOf(semester, week, 3)),
  );
});

test('planCancelBatch：结束日早于开始日或在学期外时报错', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-range-error');
  const base = {
    semester,
    course: math,
    schedule: scheduleOn(math, 1),
    range: 'range',
    target: 'schedule',
    cancelledKeys: new Map<string, string>(),
  } as const;
  assert.deepEqual(planCancelBatch({ ...base, from: weekDateOf(semester, 4, 1), to: weekDateOf(semester, 3, 1) }), {
    ok: false,
    message: adjustCopy.cancelToBeforeFrom,
  });
  const first = weekDateOf(semester, 1, 1);
  const last = weekDateOf(semester, TOTAL_WEEKS, 7);
  assert.deepEqual(planCancelBatch({ ...base, from: first, to: '2027-01-01' }), {
    ok: false,
    message: adjustCopy.dateOutOfSemester(adjustCopy.cancelToLabel, first, last),
  });
  assert.deepEqual(planCancelBatch({ ...base, from: '2026-02-01', to: first }), {
    ok: false,
    message: adjustCopy.dateOutOfSemester(adjustCopy.sourceDateLabel, first, last),
  });
});

test('planCancelBatch：从这天起结课，只停开始日所在周，之后的周次截掉', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-from');
  const monday = scheduleOn(math, 1);
  const wednesday = scheduleOn(math, 3);
  const from = weekDateOf(semester, 18, 1);
  const planned = planCancelBatch({
    semester,
    course: math,
    schedule: monday,
    range: 'from',
    target: 'schedule',
    from,
    // 「从这天起」不看结束日
    to: from,
    cancelledKeys: new Map(),
  });
  assert.deepEqual(planned, {
    ok: true,
    entries: [{ scheduleId: monday.id, date: from }],
    truncations: [{ scheduleId: monday.id, keepWeeks: weeksUpTo(18), dropEventIds: [] }],
    endWeek: 18,
  });
  // 整门课：周三只上单周，第 18 周没有课，截到第 17 周
  const course = planCancelBatch({
    semester,
    course: math,
    schedule: monday,
    range: 'from',
    target: 'course',
    from,
    to: from,
    cancelledKeys: new Map(),
  });
  assert.deepEqual(course, {
    ok: true,
    entries: [{ scheduleId: monday.id, date: from }],
    truncations: [
      { scheduleId: monday.id, keepWeeks: weeksUpTo(18), dropEventIds: [] },
      { scheduleId: wednesday.id, keepWeeks: [1, 3, 5, 7, 9, 11, 13, 15, 17], dropEventIds: [] },
    ],
    endWeek: 18,
  });
});

test('planCancelBatch：结课开始日在周中，本周开始日之前的课不停', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-from-midweek');
  const monday = scheduleOn(math, 1);
  const wednesday = scheduleOn(math, 3);
  const base = { semester, course: math, schedule: undefined, range: 'from', target: 'course' } as const;
  const onWednesday = weekDateOf(semester, 5, 3);
  const planned = planCancelBatch({ ...base, from: onWednesday, to: onWednesday, cancelledKeys: new Map() });
  assert.deepEqual(planned, {
    ok: true,
    // 第 5 周周一在开始日之前，照常上
    entries: [{ scheduleId: wednesday.id, date: onWednesday }],
    truncations: [
      { scheduleId: monday.id, keepWeeks: weeksUpTo(5), dropEventIds: [] },
      { scheduleId: wednesday.id, keepWeeks: [1, 3, 5], dropEventIds: [] },
    ],
    endWeek: 5,
  });
  // 周四起结课：本周已没有课，只截短
  const onThursday = weekDateOf(semester, 5, 4);
  const late = planCancelBatch({ ...base, from: onThursday, to: onThursday, cancelledKeys: new Map() });
  assert.equal(late.ok, true);
  if (!late.ok) return;
  assert.deepEqual(late.entries, []);
  assert.equal(late.endWeek, 5);
  assert.deepEqual(
    late.truncations.map((item) => [item.scheduleId, item.keepWeeks]),
    [
      [monday.id, weeksUpTo(5)],
      [wednesday.id, [1, 3, 5]],
    ],
  );
});

test('planCancelBatch：结课后才开始上的排课，保留周次为空', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-from-empty');
  const monday = scheduleOn(math, 1);
  const later = { ...scheduleOn(math, 3), id: 'later', dayOfWeek: 5, weeks: [10, 12, 14] };
  const course = { ...math, schedules: [monday, later] };
  const from = weekDateOf(semester, 8, 2);
  const planned = planCancelBatch({
    semester,
    course,
    schedule: undefined,
    range: 'from',
    target: 'course',
    from,
    to: from,
    cancelledKeys: new Map(),
  });
  assert.deepEqual(planned, {
    ok: true,
    entries: [],
    truncations: [
      { scheduleId: monday.id, keepWeeks: weeksUpTo(8), dropEventIds: [] },
      { scheduleId: 'later', keepWeeks: [], dropEventIds: [] },
    ],
    endWeek: 8,
  });
});

test('planCancelBatch：结课时本周已停的不重记，截掉周次上的停课记录列入删除', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-from-drop');
  const monday = scheduleOn(math, 1);
  const wednesday = scheduleOn(math, 3);
  const from = weekDateOf(semester, 5, 1);
  const cancelledKeys = new Map([
    // 结课之前的停课：保留
    [`${monday.id}|${weekDateOf(semester, 3, 1)}`, 'mon-3'],
    // 结课这周已停：不重记，也不删
    [`${monday.id}|${from}`, 'mon-5'],
    // 结课之后的停课：随周次一起清掉
    [`${monday.id}|${weekDateOf(semester, 7, 1)}`, 'mon-7'],
    [`${monday.id}|${weekDateOf(semester, 12, 1)}`, 'mon-12'],
    [`${wednesday.id}|${weekDateOf(semester, 9, 3)}`, 'wed-9'],
    // 别的排课的停课：不归这门课管
    [`other|${weekDateOf(semester, 9, 3)}`, 'other-9'],
  ]);
  const planned = planCancelBatch({
    semester,
    course: math,
    schedule: undefined,
    range: 'from',
    target: 'course',
    from,
    to: from,
    cancelledKeys,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(planned.entries, [{ scheduleId: wednesday.id, date: weekDateOf(semester, 5, 3) }]);
  assert.deepEqual(
    planned.truncations.map((item) => [item.scheduleId, item.keepWeeks, [...item.dropEventIds].sort()]),
    [
      [monday.id, weeksUpTo(5), ['mon-12', 'mon-7']],
      [wednesday.id, [1, 3, 5], ['wed-9']],
    ],
  );
  // 只结一个时段时不动另一个时段的停课记录
  const single = planCancelBatch({
    semester,
    course: math,
    schedule: wednesday,
    range: 'from',
    target: 'schedule',
    from,
    to: from,
    cancelledKeys,
  });
  assert.equal(single.ok, true);
  if (!single.ok) return;
  assert.deepEqual(single.truncations, [{ scheduleId: wednesday.id, keepWeeks: [1, 3, 5], dropEventIds: ['wed-9'] }]);
});

test('planCancelBatch：结课时本周没有课可停、之后也没有周次可截时报错', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-from-nothing');
  const monday = scheduleOn(math, 1);
  const wednesday = scheduleOn(math, 3);
  // 周一时段最后一周的周二起：本周周一已过，之后没有周次
  const lastTuesday = weekDateOf(semester, TOTAL_WEEKS, 2);
  assert.deepEqual(
    planCancelBatch({
      semester,
      course: math,
      schedule: monday,
      range: 'from',
      target: 'schedule',
      from: lastTuesday,
      to: lastTuesday,
      cancelledKeys: new Map(),
    }),
    { ok: false, message: adjustCopy.cancelNothing },
  );
  // 周三时段只到第 19 周：第 19 周周四起结课同样无事可做
  const thursday19 = weekDateOf(semester, 19, 4);
  assert.deepEqual(
    planCancelBatch({
      semester,
      course: math,
      schedule: wednesday,
      range: 'from',
      target: 'schedule',
      from: thursday19,
      to: thursday19,
      cancelledKeys: new Map(),
    }),
    { ok: false, message: adjustCopy.cancelNothing },
  );
  // 本周的课已停过且之后没有周次
  const lastMonday = weekDateOf(semester, TOTAL_WEEKS, 1);
  assert.deepEqual(
    planCancelBatch({
      semester,
      course: math,
      schedule: monday,
      range: 'from',
      target: 'schedule',
      from: lastMonday,
      to: lastMonday,
      cancelledKeys: new Map([[`${monday.id}|${lastMonday}`, 'done']]),
    }),
    { ok: false, message: adjustCopy.cancelNothing },
  );
});

test('planCancelBatch：学期起点不是周一时按那周周一推算学期范围', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-midweek');
  const midweek = { ...semester, start_date: '2026-03-04' };
  const planned = planCancelBatch({
    semester: midweek,
    course: math,
    schedule: scheduleOn(math, 1),
    range: 'from',
    target: 'schedule',
    from: '2026-07-13',
    to: '2026-07-13',
    cancelledKeys: new Map(),
  });
  // 07-13 落在最后一周（第 20 周），之后没有周次可截
  assert.deepEqual(planned, {
    ok: true,
    entries: [{ scheduleId: scheduleOn(math, 1).id, date: '2026-07-13' }],
    truncations: [],
    endWeek: 20,
  });
  assert.equal(
    planCancelBatch({
      semester: midweek,
      course: math,
      schedule: scheduleOn(math, 1),
      range: 'this',
      target: 'schedule',
      from: '2026-07-20',
      to: '2026-07-20',
      cancelledKeys: new Map(),
    }).ok,
    false,
  );
});

test('planCancelBatch：已停课的跳过，全都停过或没有课时报错', async () => {
  const { semester, math } = await seedTwoSchedules('cancel-batch-skip');
  const monday = scheduleOn(math, 1);
  const from = weekDateOf(semester, 2, 1);
  const to = weekDateOf(semester, 3, 1);
  const base = {
    semester,
    course: math,
    schedule: monday,
    range: 'range',
    target: 'schedule',
    from,
    to,
  } as const;
  const partial = planCancelBatch({ ...base, cancelledKeys: new Map([[`${monday.id}|${from}`, 'e1']]) });
  assert.deepEqual(partial, { ok: true, entries: [{ scheduleId: monday.id, date: to }], truncations: [], endWeek: null });
  const all = planCancelBatch({
    ...base,
    cancelledKeys: new Map([
      [`${monday.id}|${from}`, 'e1'],
      [`${monday.id}|${to}`, 'e2'],
    ]),
  });
  assert.deepEqual(all, { ok: false, message: adjustCopy.cancelNothing });
  // 周二没有高数
  const tuesday = weekDateOf(semester, 2, 2);
  assert.deepEqual(planCancelBatch({ ...base, range: 'this', from: tuesday, to: tuesday, cancelledKeys: new Map() }), {
    ok: false,
    message: adjustCopy.cancelNothing,
  });
});

test('applyCancelBatch：每个课次写一条停课记录', async () => {
  const { storage, semester, math } = await seedTwoSchedules('cancel-batch-apply');
  const planned = planCancelBatch({
    semester,
    course: math,
    schedule: undefined,
    range: 'range',
    target: 'course',
    from: weekDateOf(semester, 1, 1),
    to: weekDateOf(semester, 2, 7),
    cancelledKeys: new Map(),
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.entries.length, 3);
  assert.deepEqual(planned.truncations, []);
  const count = await applyCancelBatch(storage, planned, {
    userId: USER_ID,
    semesterId: semester.id,
    courseName: math.name,
    totalWeeks: TOTAL_WEEKS,
  });
  assert.equal(count, 3);
  const events = (await storage.collection<Record<string, unknown>>('events').getAll()).filter(
    (row) => row['type'] === 'reschedule',
  );
  assert.equal(events.length, 3);
  const written = events
    .map((row) => ({
      scheduleId: row['ref_schedule_id'],
      date: row['on_date'],
      action: row['action'],
      title: row['title'],
      semesterId: row['semester_id'],
    }))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  assert.deepEqual(
    written,
    planned.entries.map((entry) => ({
      ...entry,
      action: 'cancel',
      title: '停课：高等数学',
      semesterId: semester.id,
    })),
  );
  assert.equal(
    await applyCancelBatch(
      storage,
      { entries: [] },
      { userId: USER_ID, semesterId: semester.id, courseName: math.name, totalWeeks: TOTAL_WEEKS },
    ),
    0,
  );
});

test('applyCancelBatch：结课写本周停课，截短排课、删掉截掉周次上的停课，整段在后的排课删除', async () => {
  const { storage, semester, math } = await seedTwoSchedules('', validatedStorage(createStorage()));
  const monday = scheduleOn(math, 1);
  const wednesday = scheduleOn(math, 3);
  // 第 10 周起才上的周五时段：结课后整条删除
  await createSchedule(storage, { courseId: math.id, dayOfWeek: 5, periodStart: 5, periodEnd: 6, weeks: [10, 11, 12] });
  const course = (await listManagedCourses(storage, semester.id)).find((item) => item.id === math.id);
  assert.ok(course !== undefined && course.schedules.length === 3);
  const friday = scheduleOn(course, 5);

  const cancel = (scheduleId: string, week: number, dow: number) =>
    createReschedule(storage, {
      userId: USER_ID,
      semesterId: semester.id,
      refScheduleId: scheduleId,
      onDate: weekDateOf(semester, week, dow),
      action: 'cancel',
    });
  const kept = await cancel(monday.id, 3, 1);
  const dropMonday = await cancel(monday.id, 8, 1);
  const dropWednesday = await cancel(wednesday.id, 9, 3);
  const events = storage.collection<Record<string, unknown>>('events');
  const cancelledKeys = new Map(
    (await events.getAll()).map((row) => [`${String(row['ref_schedule_id'])}|${String(row['on_date'])}`, String(row['id'])]),
  );

  const from = weekDateOf(semester, 5, 3);
  const planned = planCancelBatch({
    semester,
    course,
    schedule: undefined,
    range: 'from',
    target: 'course',
    from,
    to: from,
    cancelledKeys,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.endWeek, 5);
  const count = await applyCancelBatch(storage, planned, {
    userId: USER_ID,
    semesterId: semester.id,
    courseName: math.name,
    totalWeeks: TOTAL_WEEKS,
  });
  assert.equal(count, 1);

  const after = (await listManagedCourses(storage, semester.id)).find((item) => item.id === math.id);
  assert.ok(after !== undefined);
  assert.deepEqual(
    after.schedules.map((row) => [row.dayOfWeek, row.weeks]).sort((left, right) => Number(left[0]) - Number(right[0])),
    [
      [1, weeksUpTo(5)],
      [3, [1, 3, 5]],
    ],
  );
  const scheduleRows = await storage.collection<Record<string, unknown>>('course_schedules').getAll();
  const rowOf = (id: string) => scheduleRows.find((row) => row['id'] === id);
  assert.equal(rowOf(monday.id)?.['weeks_raw'], describeWeeks(weeksToMask(weeksUpTo(5)), TOTAL_WEEKS));
  assert.equal(rowOf(wednesday.id)?.['weeks_raw'], describeWeeks(weeksToMask([1, 3, 5]), TOTAL_WEEKS));
  assert.notEqual(rowOf(friday.id)?.['deleted_at'] ?? null, null, '周五时段整条删除');

  const live = (await events.getAll())
    .filter((row) => row['deleted_at'] === null && row['action'] === 'cancel')
    .map((row) => [row['ref_schedule_id'], row['on_date']])
    .sort((left, right) => String(left[1]).localeCompare(String(right[1])));
  assert.deepEqual(live, [
    [monday.id, weekDateOf(semester, 3, 1)],
    [wednesday.id, from],
  ]);
  assert.equal((await events.get(String(kept['id'])))?.['deleted_at'], null);
  for (const dropped of [dropMonday, dropWednesday]) {
    assert.notEqual((await events.get(String(dropped['id'])))?.['deleted_at'] ?? null, null);
  }
});
