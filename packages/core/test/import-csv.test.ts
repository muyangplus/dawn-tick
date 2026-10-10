import test from 'node:test';
import assert from 'node:assert/strict';
import { matchWeekday, parseCsv, parsePeriodLabel, parseTimetableMatrix } from '../src/import/csv.ts';

test('CSV 引号与字段内换行', () => {
  const rows = parseCsv('a,b\n"x,1","y\n2"\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,1', 'y\n2'],
  ]);
  assert.deepEqual(parseCsv('a,"say ""hi"""'), [['a', 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b\r\nc,d'), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

test('星期表头识别', () => {
  assert.equal(matchWeekday('周一'), 1);
  assert.equal(matchWeekday('星期三'), 3);
  assert.equal(matchWeekday('Sunday'), 7);
  assert.equal(matchWeekday('节次'), null);
});

test('节次标签识别', () => {
  assert.deepEqual(parsePeriodLabel('第1-2节'), { periodStart: 1, periodEnd: 2, timeSlot: null });
  assert.deepEqual(parsePeriodLabel('3'), { periodStart: 3, periodEnd: 3, timeSlot: null });
  assert.deepEqual(parsePeriodLabel('1-2节(08:00-09:40)'), {
    periodStart: 1,
    periodEnd: 2,
    timeSlot: { periodNo: 1, startTime: '08:00', endTime: '09:40' },
  });
  assert.equal(parsePeriodLabel('合计'), null);
  assert.equal(parsePeriodLabel('99-100'), null);
});

test('二维矩阵解析出课程、教师、地点与周次', () => {
  const matrix = [
    ['节次', '周一', '周二', '周三'],
    ['1-2节', '高等数学\n张老师\n教三-201\n1-16周', '', '大学物理@李老师@理科楼-105\n2-16周(双)'],
    ['3-4节', '', '大学英语\n王老师\n外语楼-302', ''],
  ];
  const parsed = parseTimetableMatrix(matrix, 20);

  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.slots.length, 3);

  const math = parsed.slots.find((slot) => slot.name === '高等数学');
  assert.equal(math?.dayOfWeek, 1);
  assert.equal(math?.periodStart, 1);
  assert.equal(math?.periodEnd, 2);
  assert.equal(math?.teacher, '张老师');
  assert.equal(math?.room, '教三-201');
  assert.equal(math?.weeks?.length, 16);

  const physics = parsed.slots.find((slot) => slot.name === '大学物理');
  assert.equal(physics?.dayOfWeek, 3);
  assert.equal(physics?.teacher, '李老师');
  assert.equal(physics?.room, '理科楼-105');
  assert.deepEqual(physics?.weeks, [2, 4, 6, 8, 10, 12, 14, 16]);

  const english = parsed.slots.find((slot) => slot.name === '大学英语');
  assert.equal(english?.dayOfWeek, 2);
  assert.equal(english?.periodStart, 3);
  assert.equal(english?.weeks, null);
});

test('矩阵带时间标签时产出节次时间', () => {
  const matrix = [
    ['', '周一', '周二', '周三'],
    ['1-2节(08:00-09:40)', '高数', '', ''],
    ['3-4节(10:00-11:40)', '', '大物', ''],
  ];
  const parsed = parseTimetableMatrix(matrix, 20);
  assert.deepEqual(parsed.timeSlots, [
    { periodNo: 1, startTime: '08:00', endTime: '09:40' },
    { periodNo: 3, startTime: '10:00', endTime: '11:40' },
  ]);
});

test('缺少星期表头时给出警告', () => {
  const parsed = parseTimetableMatrix([['节次', '一', '二'], ['1-2节', 'x', 'y']], 20);
  assert.deepEqual(parsed.slots, []);
  assert.ok(parsed.warnings.some((warning) => warning.includes('星期表头')));
});
