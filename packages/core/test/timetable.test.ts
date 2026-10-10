import test from 'node:test';
import assert from 'node:assert/strict';
import { addMinutes, formatClock, generatePeriods, nextPeriod, parseClock, sectionOf } from '../src/timetable.ts';

test('时刻解析与格式化', () => {
  assert.equal(parseClock('08:00'), 480);
  assert.equal(parseClock('8:05'), 485);
  assert.equal(parseClock('23:59'), 1439);
  assert.equal(formatClock(480), '08:00');
  assert.equal(formatClock(1445), '00:05');
  assert.equal(addMinutes('08:00', 45), '08:45');
  assert.equal(addMinutes('23:30', 45), '00:15');
  assert.throws(() => parseClock('8点'), /HH:MM/);
  assert.throws(() => parseClock('24:00'), /超出范围/);
  assert.throws(() => parseClock('08:70'), /超出范围/);
});

test('时段归属', () => {
  assert.equal(sectionOf('07:59'), 'am');
  assert.equal(sectionOf('12:00'), 'pm');
  assert.equal(sectionOf('17:59'), 'pm');
  assert.equal(sectionOf('18:00'), 'night');
});

test('固定时长自动生成课次', () => {
  const periods = generatePeriods({
    durationMinutes: 45,
    breakMinutes: 10,
    blocks: [
      { section: 'am', startTime: '08:00', count: 2 },
      { section: 'pm', startTime: '14:00', count: 2 },
      { section: 'night', startTime: '19:00', count: 1 },
    ],
  });

  assert.deepEqual(
    periods.map((period) => `${period.periodNo} ${period.startTime}-${period.endTime} ${period.section}`),
    ['1 08:00-08:45 am', '2 08:55-09:40 am', '3 14:00-14:45 pm', '4 14:55-15:40 pm', '5 19:00-19:45 night'],
  );
});

test('节数为零的时段被跳过，编号连续', () => {
  const periods = generatePeriods({
    durationMinutes: 40,
    breakMinutes: 5,
    blocks: [
      { section: 'am', startTime: '08:00', count: 1 },
      { section: 'pm', startTime: '14:00', count: 0 },
      { section: 'night', startTime: '19:00', count: 2 },
    ],
  });
  assert.deepEqual(
    periods.map((period) => period.periodNo),
    [1, 2, 3],
  );
  assert.equal(periods[2]?.startTime, '19:45');
});

test('非法参数被拒绝', () => {
  const block = [{ section: 'am' as const, startTime: '08:00', count: 2 }];
  assert.throws(() => generatePeriods({ durationMinutes: 5, breakMinutes: 10, blocks: block }), /上课时长/);
  assert.throws(() => generatePeriods({ durationMinutes: 45, breakMinutes: 200, blocks: block }), /课间间隔/);
  assert.throws(
    () => generatePeriods({ durationMinutes: 45, breakMinutes: 10, blocks: [] }),
    /至少需要一个时段/,
  );
  assert.throws(
    () =>
      generatePeriods({
        durationMinutes: 45,
        breakMinutes: 10,
        blocks: [
          { section: 'am', startTime: '08:00', count: 20 },
          { section: 'pm', startTime: '14:00', count: 20 },
        ],
      }),
    /不能超过 30 节/,
  );
});

test('为空时间表追加第一节', () => {
  const first = nextPeriod([], 45, 10);
  assert.deepEqual(first, { periodNo: 1, startTime: '08:00', endTime: '08:45', section: 'am' });
});

test('追加节次沿用固定时长与课间', () => {
  const periods = generatePeriods({
    durationMinutes: 45,
    breakMinutes: 10,
    blocks: [{ section: 'am', startTime: '08:00', count: 2 }],
  });
  const appended = nextPeriod(periods, 45, 10);
  assert.equal(appended.periodNo, 3);
  assert.equal(appended.startTime, '09:50');
  assert.equal(appended.endTime, '10:35');
});
