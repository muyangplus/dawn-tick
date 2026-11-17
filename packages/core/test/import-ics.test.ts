import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consecutiveRuns,
  escapeIcsText,
  expandWeeklyRrule,
  exportIcs,
  icsToSchedules,
  parseIcs,
  unescapeIcsText,
  type IcsCourse,
  type IcsExtraEvent,
  type IcsSchedule,
  type IcsSemester,
  type IcsTimeSlot,
} from '../src/import/ics.ts';
import { dateWallClockToEpoch, formatDate } from '../src/time.ts';
import { weeksToMask } from '../src/weeks.ts';
import { weekRange } from './kit/index.ts';

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
  const { dates, warnings } = expandWeeklyRrule(start, 'FREQ=WEEKLY;COUNT=4;BYDAY=MO;WKST=MO', {
    exdates: excluded,
    timeZone: 'Asia/Shanghai',
  });
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
  // DATE 值不带时区：按默认时区（Asia/Shanghai）读成当天零点
  assert.equal(calendar.events[1]?.allDay, true);
  assert.equal(formatDate(calendar.events[1]?.start ?? 0, 'Asia/Shanghai'), '2026-10-01');
  assert.equal(calendar.events[1]?.summary, '国庆节');
});

test('不支持的频度给出警告', () => {
  const start = dateWallClockToEpoch('2026-09-07', '08:00', 'Asia/Shanghai');
  const { dates, warnings } = expandWeeklyRrule(start, 'FREQ=MONTHLY;COUNT=3');
  assert.ok(warnings.some((warning) => warning.includes('MONTHLY')));
  assert.deepEqual(dates, [start], '只保留首次');
});

function calendarOf(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

const at = (date: string, time: string, zone = 'Asia/Shanghai'): number => dateWallClockToEpoch(date, time, zone);

test('浮动时间按导入时给的学期时区读', () => {
  const text = calendarOf(
    'BEGIN:VEVENT',
    'UID:f1',
    'SUMMARY:线性代数',
    'DTSTART:20260907T080000',
    'DTEND:20260907T084500',
    'END:VEVENT',
  );
  assert.equal(parseIcs(text).events[0]?.start, at('2026-09-07', '08:00'), '默认 Asia/Shanghai');
  const newYork = parseIcs(text, { defaultTimeZone: 'America/New_York' }).events[0];
  assert.equal(newYork?.start, at('2026-09-07', '08:00', 'America/New_York'));
  assert.equal(newYork?.timeZone, 'America/New_York');
});

test('Windows 时区名映射，无法识别的时区告警并按默认时区读，不整文件失败', () => {
  const text = calendarOf(
    'BEGIN:VEVENT',
    'UID:w1',
    'SUMMARY:高等数学',
    'DTSTART;TZID="China Standard Time":20260907T080000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:w2',
    'SUMMARY:大学物理',
    'DTSTART;TZID=Mars/Olympus:20260907T100000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:w3',
    'SUMMARY:体育',
    'DTSTART;TZID=/mozilla.org/20050126_1/Asia/Tokyo:20260907T090000',
    'END:VEVENT',
  );
  const calendar = parseIcs(text);
  assert.equal(calendar.events.length, 3);
  assert.equal(calendar.events[0]?.start, at('2026-09-07', '08:00'));
  assert.equal(calendar.events[1]?.start, at('2026-09-07', '10:00'));
  assert.equal(calendar.events[2]?.start, at('2026-09-07', '09:00', 'Asia/Tokyo'));
  assert.equal(calendar.warnings.length, 1);
  assert.match(calendar.warnings[0] ?? '', /Mars\/Olympus/);
});

test('多行 EXDATE / RDATE 累积，DATE 值的 EXDATE 按日期排除', () => {
  const text = calendarOf(
    'BEGIN:VEVENT',
    'UID:x1',
    'SUMMARY:高等数学',
    'DTSTART;TZID=Asia/Shanghai:20260907T080000',
    'DTEND;TZID=Asia/Shanghai:20260907T094000',
    'RRULE:FREQ=WEEKLY;COUNT=6;BYDAY=MO',
    'EXDATE;TZID=Asia/Shanghai:20260914T080000',
    'EXDATE;VALUE=DATE:20260928',
    'RDATE;TZID=Asia/Shanghai:20261019T080000',
    'RDATE;TZID=Asia/Shanghai:20261026T080000',
    'END:VEVENT',
  );
  const { schedules: imported, warnings } = icsToSchedules(parseIcs(text), semester, timeSlots);
  assert.deepEqual(warnings, []);
  assert.deepEqual(imported[0]?.weeks, [1, 3, 5, 6, 7, 8]);
});

test('多值 BYDAY 拆成每个星期一条排课', () => {
  const text = calendarOf(
    'BEGIN:VEVENT',
    'UID:b1',
    'SUMMARY:英语',
    'DTSTART;TZID=Asia/Shanghai:20260907T100000',
    'DTEND;TZID=Asia/Shanghai:20260907T114000',
    'RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,TH',
    'END:VEVENT',
  );
  const { schedules: imported } = icsToSchedules(parseIcs(text), semester, timeSlots);
  const byDay = new Map(imported.map((item) => [item.dayOfWeek, item.weeks]));
  assert.deepEqual(byDay.get(1), [1, 2]);
  assert.deepEqual(byDay.get(4), [1, 2]);
  assert.equal(imported[0]?.periodStart, 3);
  assert.equal(imported[0]?.periodEnd, 4);
});

test('仅日期的 UNTIL 含当天', () => {
  const start = at('2026-09-07', '08:00');
  const { dates } = expandWeeklyRrule(start, 'FREQ=WEEKLY;UNTIL=20260921;BYDAY=MO', { timeZone: 'Asia/Shanghai' });
  assert.deepEqual(
    dates.map((item) => formatDate(item, 'Asia/Shanghai')),
    ['2026-09-07', '2026-09-14', '2026-09-21'],
  );
});

test('跨夏令时逐周保持同一墙钟时刻', () => {
  const zone = 'America/New_York';
  const start = at('2026-10-26', '09:00', zone);
  const { dates } = expandWeeklyRrule(start, 'FREQ=WEEKLY;COUNT=3', { timeZone: zone });
  assert.deepEqual(
    dates.map((item) => dateWallClockToEpoch(formatDate(item, zone), '09:00', zone)),
    dates,
  );
});

test('VALARM 里的 DESCRIPTION 不覆盖事件的', () => {
  const text = calendarOf(
    'BEGIN:VEVENT',
    'UID:a1',
    'SUMMARY:高等数学',
    'DESCRIPTION:张老师',
    'DTSTART;TZID=Asia/Shanghai:20260907T080000',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
  );
  assert.equal(parseIcs(text).events[0]?.description, '张老师');
});

test('反转义单遍处理：转义的反斜杠后跟 n 不变成换行', () => {
  assert.equal(unescapeIcsText('a\\\\nb'), 'a\\nb');
  assert.equal(unescapeIcsText('a\\nb\\,c\;d'), 'a\nb,c;d');
  assert.equal(unescapeIcsText(escapeIcsText('C:\\new\nline')), 'C:\\new\nline');
});

test('全天事件不当成课程', () => {
  const text = calendarOf('BEGIN:VEVENT', 'UID:d1', 'SUMMARY:国庆节', 'DTSTART;VALUE=DATE:20261001', 'END:VEVENT');
  const { schedules: imported, warnings } = icsToSchedules(parseIcs(text), semester, timeSlots);
  assert.equal(imported.length, 0);
  assert.ok(warnings.some((warning) => warning.includes('全天')));
});
