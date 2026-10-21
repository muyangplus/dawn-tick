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
  validatedStorage,
  type ManagedCourse,
  type SemesterRow,
  type Storage,
} from '@dawn-tick/core';
import { weekDateOf } from '../src/data.ts';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import {
  applyCancel,
  applyExam,
  applyExtra,
  applyMove,
  applySwap,
  examClockOf,
  overlapAt,
  periodsValid,
  planCancel,
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
  assert.equal(semesterDateError(null, START, '原日期'), '还没有学期');
  assert.equal(semesterDateError(semester, '2026-3-2', '原日期'), '请先选择原日期');
  const before = weekDateOf(semester, 1, 1);
  const after = weekDateOf(semester, TOTAL_WEEKS, 7);
  assert.equal(
    semesterDateError(semester, '2026-02-01', '原日期'),
    `原日期要在学期内（${before} 至 ${after}）`,
  );
  assert.equal(semesterDateError(semester, '2027-01-01', '调整后日期'), `调整后日期要在学期内（${before} 至 ${after}）`);
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
  assert.deepEqual(same, { ok: false, message: '目标位置和现在一样，没有需要调整的' });

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
    message: '「这一次」只改本周；跨周改用「指定日期」',
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
    message: `目标周要在 1–${TOTAL_WEEKS} 周之间`,
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
    message: `调整后日期要在学期内（${weekDateOf(semester, 1, 1)} 至 ${weekDateOf(semester, TOTAL_WEEKS, 7)}）`,
  });
  assert.deepEqual(planMove({ ...base, scope: 'date', newDate: weekDateOf(semester, 2, 1), targetWeek: '2', periodEnd: 0 }), {
    ok: false,
    message: '节次需要是 1 起、且结束不小于开始',
  });
  // 没选课次
  assert.deepEqual(planMove({ ...base, schedule: undefined, scope: 'this', newDate: base.sourceDate, targetWeek: '2' }), {
    ok: false,
    message: '请先选课程与要调整的课次',
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
    message: '请先选课程与要停的课次',
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
    message: '请先选课程与要改成考试的课次',
  });
  assert.deepEqual(planExam({ ...base, periodEnd: 0 }), {
    ok: false,
    message: '节次需要是 1 起、且结束不小于开始',
  });
  assert.deepEqual(planExam({ ...base, date: '2027-01-01' }), {
    ok: false,
    message: `考试日期要在学期内（${weekDateOf(semester, 1, 1)} 至 ${weekDateOf(semester, TOTAL_WEEKS, 7)}）`,
  });
  assert.deepEqual(planExam({ ...base, periodStart: 39, periodEnd: 40 }), {
    ok: false,
    message: '第 39–40 节没有对应的作息时间',
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
    message: `原日期课表要在学期内（${weekDateOf(semester, 1, 1)} 至 ${weekDateOf(semester, TOTAL_WEEKS, 7)}）`,
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
    { ok: false, message: '请选择课程或填写课程名称' },
  );
  assert.deepEqual(
    planExtra({ semester, courseId: math.id, courseName: '', date, periodStart: 0, periodEnd: 2 }),
    { ok: false, message: '节次需要是 1 起、且结束不小于开始' },
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
