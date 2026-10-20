import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMinutes,
  formatClock,
  generatePeriods,
  nextPeriod,
  parseClock,
  periodAtClock,
  periodsForClockRange,
  rangesOverlap,
  reflowPeriods,
  regenerateSections,
  sectionOf,
  weeksIntersect,
} from '../src/timetable.ts';

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

const threeSections = generatePeriods({
  durationMinutes: 45,
  breakMinutes: 10,
  blocks: [
    { section: 'am', startTime: '08:00', count: 2 },
    { section: 'pm', startTime: '14:00', count: 2 },
    { section: 'night', startTime: '19:00', count: 2 },
  ],
});

const describePeriods = (periods: readonly { periodNo: number; startTime: string; endTime: string; section: string }[]) =>
  periods.map((period) => `${period.periodNo} ${period.startTime}-${period.endTime} ${period.section}`);

test('按范围重排：只重排指定时段，其余时段原样保留', () => {
  const next = regenerateSections(threeSections, ['pm'], { durationMinutes: 45, breakMinutes: 15 });

  assert.deepEqual(describePeriods(next), [
    '1 08:00-08:45 am',
    '2 08:55-09:40 am',
    '3 14:00-14:45 pm',
    '4 15:00-15:45 pm',
    '5 19:00-19:45 night',
    '6 19:55-20:40 night',
  ]);
  assert.equal(next.length, threeSections.length);
  // 范围外的课次连对象都不必重建
  assert.equal(next[0], threeSections[0]);
  assert.equal(next[4], threeSections[4]);
});

test('按范围重排：时段起点取该时段现有第一节的开始时间', () => {
  const moved = threeSections.map((period) =>
    period.section === 'pm' && period.periodNo === 3 ? { ...period, startTime: '14:30' } : period,
  );
  const next = regenerateSections(moved, ['pm'], { durationMinutes: 40, breakMinutes: 5 });

  assert.deepEqual(describePeriods(next.filter((period) => period.section === 'pm')), [
    '3 14:30-15:10 pm',
    '4 15:15-15:55 pm',
  ]);
});

test('按范围重排：全部时段各自按起点与节数重算，节数不变', () => {
  const next = regenerateSections(threeSections, ['am', 'pm', 'night'], {
    durationMinutes: 50,
    breakMinutes: 0,
  });

  assert.deepEqual(describePeriods(next), [
    '1 08:00-08:50 am',
    '2 08:50-09:40 am',
    '3 14:00-14:50 pm',
    '4 14:50-15:40 pm',
    '5 19:00-19:50 night',
    '6 19:50-20:40 night',
  ]);
});

test('按范围重排：未指定的时段不受非法参数影响，参数越界时报错', () => {
  assert.throws(
    () => regenerateSections(threeSections, ['am'], { durationMinutes: 5, breakMinutes: 10 }),
    /上课时长/,
  );
  assert.throws(
    () => regenerateSections(threeSections, ['am'], { durationMinutes: 45, breakMinutes: 200 }),
    /课间间隔/,
  );
  assert.deepEqual(
    regenerateSections(threeSections, ['pm'], { durationMinutes: 45, breakMinutes: 10 }),
    threeSections,
  );
});

const describeReflow = (periods: readonly { periodNo: number; start: string; end: string }[]) =>
  periods.map((period) => `${period.periodNo} ${period.start}-${period.end}`);

test('锚点顺延重排：锚点前不动、锚点保持 start、后续按 duration+break 顺延', () => {
  const periods = [
    { periodNo: 1, start: '08:00', end: '08:45' },
    // 锚点之前的两节故意留成不对的数据：它们必须原样保留，不被回填
    { periodNo: 2, start: '08:55', end: '09:40' },
    { periodNo: 3, start: '09:55', end: '10:40' },
    { periodNo: 4, start: '13:00', end: '13:45' },
    { periodNo: 5, start: '20:00', end: '20:45' },
  ];
  const reflowed = reflowPeriods(periods, { anchorPeriodNo: 1, durationMinutes: 45, breakMinutes: 10 });

  assert.deepEqual(describeReflow(reflowed), [
    '1 08:00-08:45',
    '2 08:55-09:40',
    '3 09:50-10:35',
    '4 10:45-11:30',
    '5 11:40-12:25',
  ]);
  assert.notEqual(reflowed, periods, '返回新数组');
  assert.notEqual(reflowed[2], periods[2], '锚点之后的课次都是新建对象');
});

test('锚点顺延重排：锚点第 3 节 09:55 时第 4 节为 10:50', () => {
  const periods = [
    { periodNo: 1, start: '08:00', end: '08:45' },
    { periodNo: 2, start: '08:55', end: '09:40' },
    { periodNo: 3, start: '09:55', end: '10:40' },
    { periodNo: 4, start: '14:00', end: '14:45' },
  ];
  const reflowed = reflowPeriods(periods, { anchorPeriodNo: 3, durationMinutes: 45, breakMinutes: 10 });

  assert.deepEqual(reflowed, [
    { periodNo: 1, start: '08:00', end: '08:45' },
    { periodNo: 2, start: '08:55', end: '09:40' },
    { periodNo: 3, start: '09:55', end: '10:40' },
    { periodNo: 4, start: '10:50', end: '11:35' },
  ]);
  assert.equal(reflowed[3]?.start, '10:50', '第 4 节 = 第 3 节 end 10:40 + 课间 10');
});

test('锚点顺延重排：一路顺延，不因跨中午/跨傍晚而重置', () => {
  const periods = [
    { periodNo: 1, start: '11:40', end: '12:25' },
    { periodNo: 2, start: '19:00', end: '19:45' },
    { periodNo: 3, start: '19:55', end: '20:40' },
  ];
  const reflowed = reflowPeriods(periods, { anchorPeriodNo: 1, durationMinutes: 45, breakMinutes: 10 });

  assert.deepEqual(describeReflow(reflowed), ['1 11:40-12:25', '2 12:35-13:20', '3 13:30-14:15']);
});

test('锚点顺延重排：乱序输入按 periodNo 递增重排', () => {
  const periods = [
    { periodNo: 3, start: '10:00', end: '10:45' },
    { periodNo: 1, start: '08:00', end: '08:45' },
    { periodNo: 2, start: '08:55', end: '09:40' },
  ];
  const reflowed = reflowPeriods(periods, { anchorPeriodNo: 2, durationMinutes: 45, breakMinutes: 10 });

  assert.deepEqual(describeReflow(reflowed), ['1 08:00-08:45', '2 08:55-09:40', '3 09:50-10:35']);
});

test('锚点顺延重排：锚点缺失或参数越界时报错', () => {
  const periods = [
    { periodNo: 1, start: '08:00', end: '08:45' },
    { periodNo: 2, start: '08:55', end: '09:40' },
  ];
  assert.throws(() => reflowPeriods(periods, { anchorPeriodNo: 9, durationMinutes: 45, breakMinutes: 10 }), /锚点节次不在列表中/);
  assert.throws(() => reflowPeriods(periods, { anchorPeriodNo: 1, durationMinutes: 5, breakMinutes: 10 }), /上课时长/);
  assert.throws(() => reflowPeriods(periods, { anchorPeriodNo: 1, durationMinutes: 300, breakMinutes: 10 }), /上课时长/);
  assert.throws(() => reflowPeriods(periods, { anchorPeriodNo: 1, durationMinutes: 45, breakMinutes: -1 }), /课间间隔/);
  assert.throws(() => reflowPeriods(periods, { anchorPeriodNo: 1, durationMinutes: 45, breakMinutes: 200 }), /课间间隔/);
  assert.throws(() => reflowPeriods([], { anchorPeriodNo: 1, durationMinutes: 45, breakMinutes: 10 }), /节次列表不能为空/);
  assert.throws(
    () =>
      reflowPeriods(
        [
          { periodNo: 2, start: '08:00', end: '08:45' },
          { periodNo: 2, start: '08:55', end: '09:40' },
        ],
        { anchorPeriodNo: 2, durationMinutes: 45, breakMinutes: 10 },
      ),
    /节次编号重复/,
  );
  assert.doesNotThrow(
    () => reflowPeriods(periods, { anchorPeriodNo: 1, durationMinutes: 45.2, breakMinutes: 10.4 }),
    '课时与课间取整后仍在范围内，不应抛错',
  );
});

test('锚点顺延重排：duration + break 的固定步长与 generatePeriods 口径一致', () => {
  const generated = generatePeriods({
    durationMinutes: 45,
    breakMinutes: 10,
    blocks: [{ section: 'am', startTime: '08:00', count: 6 }],
  });
  const reflowed = reflowPeriods(
    generated.map((period) => ({ periodNo: period.periodNo, start: period.startTime, end: period.endTime })),
    { anchorPeriodNo: 1, durationMinutes: 45, breakMinutes: 10 },
  );
  assert.deepEqual(
    reflowed,
    generated.map((period) => ({ periodNo: period.periodNo, start: period.startTime, end: period.endTime })),
  );
});

const slots = [
  { period_no: 1, start_time: '08:00', end_time: '08:45' },
  { period_no: 2, start_time: '08:55', end_time: '09:40' },
  { period_no: 3, start_time: '10:00', end_time: '10:45' },
  { period_no: 4, start_time: '10:55', end_time: '11:40' },
];

test('节次区间相交：含首含尾，相邻不算重叠', () => {
  assert.equal(rangesOverlap(1, 2, 3, 4), false, '相邻（1–2 与 3–4）不重叠');
  assert.equal(rangesOverlap(3, 4, 1, 2), false, '入参顺序无关');
  assert.equal(rangesOverlap(1, 2, 2, 4), true, '共用边界 2 算重叠');
  assert.equal(rangesOverlap(2, 2, 1, 4), true, '单节落在连堂里');
  assert.equal(rangesOverlap(2, 2, 2, 2), true, '同一单节');
  assert.equal(rangesOverlap(1, 3, 2, 4), true);
  assert.equal(rangesOverlap(4, 2, 1, 2), true, '倒序区间归一化后仍相交');
});

test('周次相交：跨周同一节次不算重叠', () => {
  assert.equal(rangesOverlap(3, 3, 3, 3), true, '节次本身重叠');
  assert.equal(weeksIntersect([1, 3, 5], [2, 4, 6]), false, '周次无交集 → 不冲突');
  assert.equal(weeksIntersect([1, 3, 5], [3, 7]), true);
  assert.equal(weeksIntersect([2], [1, 2, 3]), true);
  assert.equal(weeksIntersect([], [1]), false, '空周次集不与任何周次相交');
  assert.equal(weeksIntersect([1], []), false);
  assert.equal(weeksIntersect([], []), false);
});

test('钟点落到节次：重叠取该节，无重叠取最近的一节', () => {
  assert.equal(periodAtClock(slots, '08:10'), 1);
  assert.equal(periodAtClock(slots, '08:00'), 1, '含起点');
  assert.equal(periodAtClock(slots, '10:44'), 3);
  // 08:45–08:55 是课间：贴到更近的第 2 节（10 分钟）而不是第 1 节（45 分钟）
  assert.equal(periodAtClock(slots, '08:50'), 2);
  assert.equal(periodAtClock(slots, '12:30'), 4, '超出最后一节贴到最后一节');
  assert.equal(periodAtClock(slots, '07:00'), 1, '早于第一节贴到第一节');
  assert.equal(periodAtClock(slots, null), null);
  assert.equal(periodAtClock(slots, ''), null);
  assert.equal(periodAtClock([], '08:00'), null);
  assert.equal(periodAtClock(slots, '8点'), null, '解析不出的钟点返回 null');
  assert.equal(periodAtClock(slots, '8:05'), 1, '接受一位小时');
});

test('钟点范围换算节次范围：覆盖多节取最小到最大', () => {
  assert.deepEqual(periodsForClockRange(slots, '08:30', '10:10'), { periodStart: 1, periodEnd: 3 });
  assert.deepEqual(periodsForClockRange(slots, '08:00', '08:45'), { periodStart: 1, periodEnd: 1 });
  assert.deepEqual(
    periodsForClockRange(slots, '09:30', '10:00'),
    { periodStart: 2, periodEnd: 2 },
    '结束时刻正好等于下一节开始，不算覆盖下一节',
  );
  assert.deepEqual(
    periodsForClockRange(slots, '10:00', '10:10'),
    { periodStart: 3, periodEnd: 3 },
    '开始时刻正好等于本节开始',
  );
  assert.deepEqual(
    periodsForClockRange([...slots].reverse(), '08:30', '10:10'),
    { periodStart: 1, periodEnd: 3 },
    '与入参顺序无关',
  );
});

test('钟点范围换算节次范围：无重叠时贴到开始时间最近的一节', () => {
  assert.deepEqual(periodsForClockRange(slots, '12:00', '13:00'), { periodStart: 4, periodEnd: 4 });
  assert.deepEqual(periodsForClockRange(slots, '08:46', '08:54'), { periodStart: 2, periodEnd: 2 });
  assert.equal(periodsForClockRange([], '08:00', '09:00'), null);
  assert.equal(periodsForClockRange(slots, '', '09:00'), null);
});
