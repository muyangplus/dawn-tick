import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consecutiveRuns,
  escapeIcsText,
  expandWeeklyRrule,
  exportIcs,
  icsToSchedules,
  parseIcs,
  type IcsCourse,
  type IcsExtraEvent,
  type IcsSchedule,
  type IcsSemester,
  type IcsTimeSlot,
} from '../src/import/ics.ts';
import { dateWallClockToEpoch, formatDate } from '../src/time.ts';
import { weeksToMask } from '../src/weeks.ts';
import { weekRange } from './helpers.ts';

const semester: IcsSemester = {
  id: 'sem-1',
  start_date: '2026-09-07',
  total_weeks: 20,
  time_zone: 'Asia/Shanghai',
};

const timeSlots: IcsTimeSlot[] = [
  { period_no: 1, start_time: '08:00', end_time: '08:45' },
  { period_no: 2, start_time: '08:55', end_time: '09:40' },
  { period_no: 3, start_time: '10:00', end_time: '10:45' },
  { period_no: 4, start_time: '10:55', end_time: '11:40' },
];

const courses: IcsCourse[] = [
  { id: 'c-1', name: '高等数学', short_name: '高数', teacher: '张老师', location: '教三-201' },
  { id: 'c-2', name: '大学物理', short_name: '大物', teacher: '李老师', location: '理科楼-105' },
];

const schedules: IcsSchedule[] = [
  {
    id: 's-1',
    course_id: 'c-1',
    day_of_week: 1,
    period_start: 1,
    period_end: 2,
    weeks_mask: weeksToMask(weekRange(1, 16)),
    room: null,
  },
  {
    id: 's-2',
    course_id: 'c-2',
    day_of_week: 3,
    period_start: 3,
    period_end: 4,
    weeks_mask: weeksToMask(weekRange(2, 16, 2)),
    room: '理科楼-105',
  },
];

test('连续周次分段', () => {
  assert.deepEqual(consecutiveRuns([1, 2, 3, 4]), [{ from: 1, to: 4, step: 1 }]);
  assert.deepEqual(consecutiveRuns([1, 3, 5, 7]), [{ from: 1, to: 7, step: 2 }]);
  assert.deepEqual(consecutiveRuns([1, 2, 3, 5, 6]), [
    { from: 1, to: 3, step: 1 },
    { from: 5, to: 6, step: 1 },
  ]);
});

test('转义与折行', () => {
  assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('导出的 ICS 结构正确', () => {
  const text = exportIcs({ semester, courses, schedules, timeSlots, calendarName: '晓刻', stamp: 1759900000000 });
  assert.ok(text.startsWith('BEGIN:VCALENDAR'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(text.includes('SUMMARY:高等数学'));
  assert.ok(text.includes('LOCATION:教三-201'));
  assert.ok(text.includes('LOCATION:理科楼-105'));

  const lines = text.split('\r\n');
  const continuous = lines.find((line) => line.includes('COUNT=16'));
  assert.ok(continuous?.includes('BYDAY=MO'), '连续周次应带 BYDAY');
  assert.ok(continuous?.includes('WKST=MO'), '必须显式设置 WKST，否则单双周会错位');

  const biweekly = lines.find((line) => line.includes('INTERVAL=2'));
  assert.ok(biweekly?.includes('WKST=MO'));
  assert.ok(biweekly?.includes('BYDAY=WE'));
});

test('导出再导入周次与节次不变', () => {
  const text = exportIcs({ semester, courses, schedules, timeSlots, stamp: 1759900000000 });
  const calendar = parseIcs(text);
  assert.equal(calendar.events.length, 2);
  assert.deepEqual(calendar.warnings, []);

  const { schedules: imported, warnings } = icsToSchedules(calendar, semester, timeSlots);
  assert.deepEqual(warnings, []);
  assert.equal(imported.length, 2);

  const math = imported.find((item) => item.courseName === '高等数学');
  assert.equal(math?.dayOfWeek, 1);
  assert.equal(math?.periodStart, 1);
  assert.equal(math?.periodEnd, 2);
  assert.deepEqual(math?.weeks, weekRange(1, 16));
  assert.equal(math?.room, '教三-201');

  const physics = imported.find((item) => item.courseName === '大学物理');
  assert.equal(physics?.dayOfWeek, 3);
  assert.deepEqual(physics?.weeks, weekRange(2, 16, 2));
  assert.equal(physics?.room, '理科楼-105');
});

test('不规则周次用 RDATE 表达并可还原', () => {
  const oddWeeks = weeksToMask([1, 2, 3, 5, 6]);
  const text = exportIcs({
    semester,
    courses,
    timeSlots,
    stamp: 1759900000000,
    schedules: [{ id: 's-9', course_id: 'c-1', day_of_week: 5, period_start: 1, period_end: 2, weeks_mask: oddWeeks, room: null }],
  });
  assert.ok(text.includes('RDATE:'), '不连续周次需要 RDATE');

  const calendar = parseIcs(text);
  const { schedules: imported } = icsToSchedules(calendar, semester, timeSlots);
  assert.deepEqual(imported[0]?.weeks, [1, 2, 3, 5, 6]);
  assert.equal(imported[0]?.dayOfWeek, 5);
});

test('RRULE 展开支持 COUNT 与 EXDATE', () => {
  const start = dateWallClockToEpoch('2026-09-07', '08:00', 'Asia/Shanghai');
  const excluded = [dateWallClockToEpoch('2026-09-14', '08:00', 'Asia/Shanghai')];
  const { dates, warnings } = expandWeeklyRrule(
    start,
    'FREQ=WEEKLY;COUNT=4;BYDAY=MO;WKST=MO',
    [],
    excluded,
  );
  assert.deepEqual(warnings, []);
  assert.equal(dates.length, 3);
  assert.equal(formatDate(dates[0] as number, 'Asia/Shanghai'), '2026-09-07');
  assert.equal(formatDate(dates[1] as number, 'Asia/Shanghai'), '2026-09-21');
});

test('额外单次事件按时刻与全天写入', () => {
  const start = dateWallClockToEpoch('2026-09-16', '10:00', 'Asia/Shanghai');
  const end = dateWallClockToEpoch('2026-09-16', '11:40', 'Asia/Shanghai');
  const dayStart = dateWallClockToEpoch('2026-10-01', '00:00', 'Asia/Shanghai');
  const extraEvents: IcsExtraEvent[] = [
    {
      uid: 's-1-2026-09-14-move@dawn-tick',
      summary: '高等数学',
      start,
      end,
      location: '教三-305',
      description: '张老师 高数',
    },
    { uid: 'holiday-1@dawn-tick', summary: '国庆节', start: dayStart, end: dayStart, allDay: true },
  ];
  const text = exportIcs({
    semester,
    courses,
    schedules: [],
    timeSlots,
    extraEvents,
    stamp: 1759900000000,
  });

  assert.ok(text.includes('UID:s-1-2026-09-14-move@dawn-tick'));
  assert.ok(text.includes('DTSTART:20260916T020000Z'));
  assert.ok(text.includes('DTEND:20260916T034000Z'));
  assert.ok(text.includes('SUMMARY:高等数学'));
  assert.ok(text.includes('LOCATION:教三-305'));
  assert.ok(text.includes('DTSTART;VALUE=DATE:20261001'));
  assert.ok(text.includes('DTEND;VALUE=DATE:20261002'));

  const calendar = parseIcs(text);
  assert.equal(calendar.events.length, 2);
  assert.equal(calendar.events[0]?.start, start);
  assert.equal(calendar.events[0]?.location, '教三-305');
  // DATE 值不带时区：按浮动日期读成当天零点的 UTC 时刻
  assert.equal(formatDate(calendar.events[1]?.start ?? 0, 'UTC'), '2026-10-01');
  assert.equal(calendar.events[1]?.summary, '国庆节');
});

test('不支持的频度给出警告', () => {
  const start = dateWallClockToEpoch('2026-09-07', '08:00', 'Asia/Shanghai');
  const { warnings } = expandWeeklyRrule(start, 'FREQ=MONTHLY;COUNT=3', [], []);
  assert.ok(warnings.some((warning) => warning.includes('MONTHLY')));
});
