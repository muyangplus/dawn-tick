import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateWallClockToEpoch,
  formatDate,
  formatTime,
  icsToSchedules,
  parseIcs,
  weeksToMask,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type SemesterRow,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { buildIcsExport, icsFileName, type IcsExportInput } from '../src/lib/ics-export.ts';

const TIME_ZONE = 'Asia/Shanghai';
/** 固定生成时间：文件名日期与 DTSTAMP 都可复现 */
const NOW = Date.parse('2026-10-21T12:00:00Z');
const SYNC = { created_at: 0, updated_at: 0, deleted_at: null, rev: 1, dirty: 0 };

function semester(overrides: Partial<SemesterRow> = {}): SemesterRow {
  return {
    ...SYNC,
    id: 'sem-1',
    user_id: 'u1',
    name: '2026-2027 第一学期',
    start_date: '2026-09-07',
    total_weeks: 20,
    time_zone: TIME_ZONE,
    is_active: 1,
    ...overrides,
  };
}

function course(overrides: Partial<CourseRow> = {}): CourseRow {
  return {
    ...SYNC,
    id: 'c-1',
    semester_id: 'sem-1',
    name: '高等数学',
    short_name: '高数',
    teacher: '张老师',
    location: '教三-201',
    color: '#3366ff',
    credits: null,
    note: null,
    ...overrides,
  };
}

function schedule(overrides: Partial<CourseScheduleRow> = {}): CourseScheduleRow {
  return {
    ...SYNC,
    id: 's-1',
    course_id: 'c-1',
    day_of_week: 1,
    period_start: 1,
    period_end: 2,
    weeks_mask: weeksToMask([1, 2, 3, 4]),
    weeks_raw: null,
    room: null,
    start_time: null,
    end_time: null,
    ...overrides,
  };
}

function slot(periodNo: number, start: string, end: string): TimeSlotRow {
  return {
    ...SYNC,
    id: `t-${periodNo}`,
    semester_id: 'sem-1',
    period_no: periodNo,
    start_time: start,
    end_time: end,
    label: null,
    section: null,
  };
}

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    ...SYNC,
    id: 'e-1',
    user_id: 'u1',
    semester_id: 'sem-1',
    parent_id: null,
    type: 'exam',
    title: '期中考试',
    on_date: '2026-09-16',
    start_at: null,
    end_at: null,
    all_day: 0,
    location: null,
    note: null,
    done: 0,
    countdown: 0,
    manual_done: 0,
    nature: null,
    priority: null,
    due_at: null,
    subject: null,
    seat_no: null,
    period_start: null,
    period_end: null,
    weeks_mask: null,
    start_time: null,
    end_time: null,
    show_in_timetable: 0,
    ref_schedule_id: null,
    action: null,
    new_date: null,
    new_period_start: null,
    new_period_end: null,
    new_room: null,
    as_day_of_week: null,
    source: null,
    ...overrides,
  };
}

const slots: TimeSlotRow[] = [
  slot(1, '08:00', '08:45'),
  slot(2, '08:55', '09:40'),
  slot(3, '10:00', '10:45'),
  slot(4, '10:55', '11:40'),
];

function input(overrides: Partial<IcsExportInput> = {}): IcsExportInput {
  return {
    semester: semester(),
    courses: [course()],
    schedules: [schedule()],
    events: [],
    slots,
    ...overrides,
  };
}

/** 把导出的 ICS 按学期时区展开成「日期列表 + 条目」，便于断言落点。 */
function eventsOf(text: string): ReturnType<typeof parseIcs>['events'] {
  return parseIcs(text).events;
}

function move(overrides: Partial<EventRow> = {}): EventRow {
  return event({
    id: 'r-1',
    type: 'reschedule',
    title: '调课：高等数学',
    on_date: '2026-09-14',
    action: 'move',
    ref_schedule_id: 's-1',
    new_date: '2026-09-16',
    new_period_start: 3,
    new_period_end: 4,
    new_room: '教三-305',
    as_day_of_week: 3,
    ...overrides,
  });
}

test('导出文本含 UID / DTSTART / SUMMARY，文件名带学期与日期', () => {
  const result = buildIcsExport(input(), { includeEvents: false, now: NOW });
  assert.ok(result.text.startsWith('BEGIN:VCALENDAR'));
  assert.ok(result.text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(result.text.includes('UID:s-1-0@dawn-tick'));
  assert.ok(result.text.includes('DTSTART:20260907T000000Z'));
  assert.ok(result.text.includes('SUMMARY:高等数学'));
  assert.equal(result.counts.courses, 1);
  assert.equal(result.counts.schedules, 1);
  assert.equal(result.counts.lessons, 4);
  assert.equal(result.fileName, 'DawnTick-2026-2027 第一学期-2026-10-21.ics');
  assert.equal(icsFileName('2026/2027 第一学期', NOW), 'DawnTick-20262027 第一学期-2026-10-21.ics');
});

test('调课按调整后的日期、节次与地点落事件，并移出原周次', () => {
  const result = buildIcsExport(input({ events: [move()] }), { includeEvents: false, now: NOW });
  assert.equal(result.counts.moved, 1);
  const events = eventsOf(result.text);
  const dates = events.map((item) => formatDate(item.start, TIME_ZONE));
  assert.ok(dates.includes('2026-09-16'), '调课落点应写入目标日期');
  const moved = events.find((item) => formatDate(item.start, TIME_ZONE) === '2026-09-16');
  assert.equal(formatTime(moved?.start ?? 0, TIME_ZONE), '10:00');
  assert.equal(formatTime(moved?.end ?? 0, TIME_ZONE), '11:40');
  assert.equal(moved?.summary, '高等数学');
  assert.equal(moved?.location, '教三-305');
  // 原周次从基础排课里剔除：再导入时只剩 1 / 3 / 4 周
  const parsed = icsToSchedules(parseIcs(result.text), semester(), slots);
  assert.deepEqual(parsed.schedules[0]?.weeks, [1, 3, 4]);
});

test('停课不导出，其余周次保留', () => {
  const cancel = event({
    id: 'r-2',
    type: 'reschedule',
    title: '停课：高等数学',
    on_date: '2026-09-21',
    action: 'cancel',
    ref_schedule_id: 's-1',
  });
  const result = buildIcsExport(input({ events: [cancel] }), { includeEvents: false, now: NOW });
  assert.equal(result.counts.cancelled, 1);
  const dates = eventsOf(result.text).map((item) => formatDate(item.start, TIME_ZONE));
  assert.ok(!dates.includes('2026-09-21'), '停课那一次不应写入');
  assert.ok(dates.includes('2026-09-07'));
  assert.ok(dates.includes('2026-09-28'));
  // 展开 RRULE 后再导入：停课那周被剔除，其余周次不变
  const parsed = icsToSchedules(parseIcs(result.text), semester(), slots);
  assert.deepEqual(parsed.schedules[0]?.weeks, [1, 2, 4]);;
});

test('勾选日程后考试条目进入 ICS，未勾选时不写入', () => {
  const exam = event({
    start_at: dateWallClockToEpoch('2026-09-16', '14:00', TIME_ZONE),
    end_at: dateWallClockToEpoch('2026-09-16', '15:40', TIME_ZONE),
    location: '教三-101',
    note: '闭卷',
  });
  const lessonOnly = buildIcsExport(input({ events: [exam] }), {
    includeEvents: false,
    now: NOW,
  });
  assert.ok(!lessonOnly.text.includes('SUMMARY:期中考试'));
  assert.equal(lessonOnly.counts.events, 1, '未勾选时也统计可写入的日程条数');

  const withEvents = buildIcsExport(input({ events: [exam] }), {
    includeEvents: true,
    now: NOW,
  });
  assert.equal(withEvents.counts.events, 1);
  const found = eventsOf(withEvents.text).find((item) => item.summary === '期中考试');
  assert.ok(found !== undefined);
  assert.equal(formatDate(found.start, TIME_ZONE), '2026-09-16');
  assert.equal(formatTime(found.start, TIME_ZONE), '14:00');
  assert.equal(formatTime(found.end, TIME_ZONE), '15:40');
  assert.equal(found.location, '教三-101');
  assert.ok((found.description ?? '').includes('考试'));
  assert.ok((found.description ?? '').includes('闭卷'));
});

test('自定义时间课次保留真实起止', () => {
  const custom = schedule({
    start_time: '19:00',
    end_time: '20:30',
    weeks_mask: weeksToMask([1]),
  });
  const result = buildIcsExport(input({ schedules: [custom] }), {
    includeEvents: false,
    now: NOW,
  });
  const found = eventsOf(result.text)[0];
  assert.ok(found !== undefined);
  assert.equal(found.start, dateWallClockToEpoch('2026-09-07', '19:00', TIME_ZONE));
  assert.equal(found.end, dateWallClockToEpoch('2026-09-07', '20:30', TIME_ZONE));
  assert.equal(result.counts.lessons, 1);
});

test('导出再导入：课程 / 排课 / 周次与导出前一致', () => {
  const result = buildIcsExport(input(), { includeEvents: false, now: NOW });
  const calendar = parseIcs(result.text);
  assert.deepEqual(calendar.warnings, []);

  const parsed = icsToSchedules(calendar, semester(), slots);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.schedules.length, 1);
  const first = parsed.schedules[0];
  assert.equal(first?.courseName, '高等数学');
  assert.equal(first?.dayOfWeek, 1);
  assert.equal(first?.periodStart, 1);
  assert.equal(first?.periodEnd, 2);
  assert.deepEqual(first?.weeks, [1, 2, 3, 4]);
  assert.equal(first?.room, '教三-201');
  assert.equal(first?.teacher, '张老师 高数');
});
