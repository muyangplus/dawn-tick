import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  dayOfWeek,
  type AppData,
  type EventRow,
  type ManagedCourse,
  type Occurrence,
  type SemesterRow,
} from '@dawn-tick/core';
import { buildSemesterStats, semesterWeekText } from '../src/lib/semester-stats.ts';

const TIME_ZONE = 'Asia/Shanghai';
const NOW = Date.parse('2026-09-21T12:00:00+08:00');

function sem(overrides: { start?: string; weeks?: number } = {}): SemesterRow {
  return {
    id: 'sem-1', user_id: 'u1', name: '测试学期',
    start_date: overrides.start ?? '2026-09-07', total_weeks: overrides.weeks ?? 20,
    time_zone: TIME_ZONE, is_active: 1,
  } as unknown as SemesterRow;
}

function lesson(input: { date: string; courseId: string; courseName: string; periodStart?: number }): Occurrence {
  return {
    date: input.date, semesterId: 'sem-1', scheduleId: `sch-${input.courseId}`,
    courseId: input.courseId, courseName: input.courseName, shortName: null, color: '#4F8DFD',
    periodStart: input.periodStart ?? 1, periodEnd: (input.periodStart ?? 1) + 1,
    startAt: Date.parse(`${input.date}T08:00:00+08:00`),
    endAt: Date.parse(`${input.date}T09:40:00+08:00`),
    room: null, cancelled: false,
  };
}

function event(input: Partial<EventRow> & { id: string; type: EventRow['type']; title: string }): EventRow {
  return {
    on_date: null, start_at: null, end_at: null, due_at: null, done: 0, countdown: 0,
    ref_schedule_id: null, action: null, new_date: null, ...input,
  } as unknown as EventRow;
}

function course(input: {
  id: string;
  name: string;
  dayOfWeek: number;
  weeks?: number[];
  scheduleId?: string;
}): ManagedCourse {
  return {
    id: input.id, name: input.name, shortName: null, teacher: null, location: null,
    color: '#4F8DFD', credits: null, note: null,
    schedules: [
      {
        id: input.scheduleId ?? `sch-${input.id}`, dayOfWeek: input.dayOfWeek, periodStart: 1, periodEnd: 2,
        weeks: input.weeks ?? Array.from({ length: 20 }, (_, index) => index + 1),
        room: null, startTime: null, endTime: null,
      },
    ],
  };
}

interface DataInput {
  semester?: SemesterRow | null;
  today?: string;
  lessons?: Occurrence[];
  exams?: EventRow[];
  todos?: EventRow[];
  reschedules?: EventRow[];
  courses?: ManagedCourse[];
  holidays?: Array<[string, string]>;
}

/** 只填统计要读的字段；其余按 AppData 的形状给空值。 */
function makeData(input: DataInput = {}): AppData {
  const lessonsByDate = new Map<string, Occurrence[]>();
  for (const item of input.lessons ?? []) {
    lessonsByDate.set(item.date, [...(lessonsByDate.get(item.date) ?? []), item]);
  }
  const today = input.today ?? '2026-09-21';
  return {
    timeZone: TIME_ZONE, today, todayOfWeek: dayOfWeek(today),
    week: 0, viewWeek: 0, weekStartDate: '', windowStart: '', windowDates: [], windowSpansWeeks: false,
    hasLessons: lessonsByDate.size > 0, courses: input.courses ?? [], lessonsByDate,
    holidayLabels: new Map(input.holidays ?? []), workdayDates: [],
    semester: input.semester === undefined ? sem() : input.semester, semesters: [], slots: [], grid: new Map(),
    todayLessons: [], todoSort: 'start', tomorrowLessons: [], currentLesson: undefined, nextLesson: undefined,
    exams: input.exams ?? [], todos: input.todos ?? [], labs: [], countdowns: [], reschedules: input.reschedules ?? [],
  };
}

test('空学期：无课时无考试，出勤无法估算', () => {
  const stats = buildSemesterStats(makeData(), NOW);
  assert.equal(stats.empty, true);
  assert.equal(stats.lessons.total, 0);
  assert.deepEqual(stats.ranking, []);
  assert.equal(stats.attendance.percent, null);
  assert.equal(stats.exams.total, 0);
  assert.equal(stats.semester?.currentWeek, 3);
  assert.equal(stats.semester?.totalWeeks, 20);
  // 学期起止与日模式同一口径：第一周周一 … 最后一周周日
  assert.equal(stats.semester?.startDate, '2026-09-07');
  assert.equal(stats.semester?.endDate, addDays('2026-09-07', 20 * 7 - 1));
  assert.equal(semesterWeekText(stats.semester), '第 3 周 / 共 20 周');

  // 完全没有学期时也给空态，不抛错
  const noSemester = buildSemesterStats(makeData({ semester: null }), NOW);
  assert.equal(noSemester.empty, true);
  assert.equal(noSemester.semester, null);
});

test('跨周：按今天切成已上过 / 待上，周次与阶段跟着走', () => {
  const data = makeData({
    lessons: [
      lesson({ date: '2026-09-07', courseId: 'math', courseName: '高等数学' }),
      lesson({ date: '2026-09-14', courseId: 'math', courseName: '高等数学' }),
      lesson({ date: '2026-09-21', courseId: 'math', courseName: '高等数学' }),
      lesson({ date: '2026-09-28', courseId: 'math', courseName: '高等数学' }),
    ],
  });
  const stats = buildSemesterStats(data, NOW);
  assert.equal(stats.lessons.past, 2);
  assert.equal(stats.lessons.upcoming, 2);
  assert.equal(stats.lessons.total, 4);
  assert.equal(stats.attendance.attended, 2);
  assert.equal(stats.attendance.percent, 100);
  assert.deepEqual(stats.ranking.map((row) => [row.courseId, row.count]), [['math', 4]]);

  // 开学前 / 学期后：阶段文案替代「第 N 周」
  const before = buildSemesterStats(makeData({ today: '2026-08-31' }), NOW);
  assert.equal(before.semester?.phase, 'before');
  assert.equal(semesterWeekText(before.semester), '未开学 · 共 20 周');
  const after = buildSemesterStats(makeData({ today: '2027-02-08' }), NOW);
  assert.equal(after.semester?.phase, 'after');
  assert.equal(semesterWeekText(after.semester), '学期已结束 · 共 20 周');
});

test('停课 / 调课：停课不进课时但进出勤分母，调课不重复计数', () => {
  const data = makeData({
    courses: [course({ id: 'math', name: '高等数学', dayOfWeek: 1, scheduleId: 'sch-math' })],
    // 9/14 那节停课（课次已被 expand 扣掉），9/22 是 9/28 调课后的落点
    lessons: [
      lesson({ date: '2026-09-07', courseId: 'math', courseName: '高等数学' }),
      lesson({ date: '2026-09-21', courseId: 'math', courseName: '高等数学' }),
      lesson({ date: '2026-09-22', courseId: 'math', courseName: '高等数学' }),
    ],
    reschedules: [
      event({
        id: 'res-1',
        type: 'reschedule',
        title: '停课',
        on_date: '2026-09-14',
        action: 'cancel',
        ref_schedule_id: 'sch-math',
      }),
      // 调课：只记录落点，不产生停课
      event({
        id: 'res-2',
        type: 'reschedule',
        title: '调课',
        on_date: '2026-09-28',
        action: 'move',
        ref_schedule_id: 'sch-math',
        new_date: '2026-09-22',
      }),
      // 星期对不上的取消记录：不是当天的课，忽略
      event({
        id: 'res-3',
        type: 'reschedule',
        title: '误录',
        on_date: '2026-09-16',
        action: 'cancel',
        ref_schedule_id: 'sch-math',
      }),
      // 假期当天的取消记录：当天本来就没课，忽略
      event({
        id: 'res-4',
        type: 'reschedule',
        title: '假期误录',
        on_date: '2026-09-20',
        action: 'cancel',
        ref_schedule_id: 'sch-math',
      }),
    ],
    holidays: [['2026-09-20', '校庆']],
  });
  const stats = buildSemesterStats(data, NOW);
  assert.equal(stats.lessons.past, 1);
  assert.equal(stats.lessons.upcoming, 2);
  assert.equal(stats.lessons.cancelled, 1);
  assert.equal(stats.lessons.total, 4);
  assert.equal(stats.attendance.total, 2);
  assert.equal(stats.attendance.percent, 50);
  // 调课只在落点计一次，不按原日期再计一遍
  assert.deepEqual(stats.ranking.map((row) => [row.name, row.count]), [['高等数学', 3]]);
});

test('课时排行：按节数降序取前 5', () => {
  const names = ['A 课', 'B 课', 'C 课', 'D 课', 'E 课', 'F 课'];
  const lessons: Occurrence[] = [];
  names.forEach((name, index) => {
    // 第一名 6 节、第二名 5 节 … 第六名 1 节
    for (let count = 0; count < 6 - index; count += 1) {
      lessons.push(lesson({ date: addDays('2026-09-07', count * 7), courseId: `c-${index}`, courseName: name }));
    }
  });
  const stats = buildSemesterStats(makeData({ lessons }), NOW);
  assert.equal(stats.ranking.length, 5);
  assert.deepEqual(
    stats.ranking.map((row) => [row.name, row.count]),
    [
      ['A 课', 6],
      ['B 课', 5],
      ['C 课', 4],
      ['D 课', 3],
      ['E 课', 2],
    ],
  );
  assert.equal(stats.ranking.some((row) => row.name === 'F 课'), false);
});

test('考试：已考 / 待考按日期与开考时间判定，最近一场给倒计时', () => {
  const data = makeData({
    today: '2026-09-21',
    exams: [
      event({ id: 'e1', type: 'exam', title: '上月月考', on_date: '2026-09-10' }),
      // 今天已开考：算已考
      event({
        id: 'e2',
        type: 'exam',
        title: '今天上午考',
        on_date: '2026-09-21',
        start_at: Date.parse('2026-09-21T09:00:00+08:00'),
      }),
      // 今天还没开考：算待考，并且是最近一场
      event({
        id: 'e3',
        type: 'exam',
        title: '今天下午考',
        on_date: '2026-09-21',
        start_at: Date.parse('2026-09-21T14:00:00+08:00'),
      }),
      event({ id: 'e4', type: 'exam', title: '下月月考', on_date: '2026-10-12' }),
    ],
    todos: [
      // 没有开考时间的考试也在 todos 里：同样计入
      event({ id: 'e5', type: 'exam', title: '期末考', on_date: '2026-11-02' }),
      // 同一条重复出现时按 id 去重
      event({ id: 'e4', type: 'exam', title: '下月月考', on_date: '2026-10-12' }),
      // 非考试条目不计入
      event({ id: 't1', type: 'todo', title: '交作业', on_date: '2026-09-22' }),
    ],
  });
  const stats = buildSemesterStats(data, NOW);
  assert.equal(stats.exams.total, 5);
  assert.equal(stats.exams.taken, 2);
  assert.equal(stats.exams.upcoming, 3);
  assert.deepEqual(stats.exams.next, { title: '今天下午考', date: '2026-09-21', daysUntil: 0 });
});

test('时区边界：无 on_date 的考试按显示时区取日期，不落回 UTC 前一天', () => {
  const startAt = Date.parse('2026-09-21T00:30:00+08:00');
  // 同一个时刻在 UTC 下是 9/20：统计必须按 Asia/Shanghai 记成 9/21
  assert.equal(new Date(startAt).toISOString().slice(0, 10), '2026-09-20');
  const data = makeData({
    today: '2026-09-20',
    exams: [
      event({ id: 'e1', type: 'exam', title: '零点半小时开考', start_at: startAt }),
      // 已经是今天凌晨的考试：按开考时间算已考
      event({
        id: 'e2',
        type: 'exam',
        title: '凌晨已考',
        start_at: Date.parse('2026-09-20T07:00:00+08:00'),
      }),
    ],
  });
  const stats = buildSemesterStats(data, Date.parse('2026-09-20T23:30:00+08:00'));
  assert.equal(stats.exams.taken, 1);
  assert.deepEqual(stats.exams.next, { title: '零点半小时开考', date: '2026-09-21', daysUntil: 1 });
});
