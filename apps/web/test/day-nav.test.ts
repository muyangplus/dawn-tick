import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDayDate, dayRangeOf, defaultDayDate, stepDay } from '../src/lib/day-nav.ts';

const semester = { start_date: '2026-09-07', total_weeks: 20 };
const range = dayRangeOf(semester);

test('学期范围按第一周周一与最后一周周日算', () => {
  assert.equal(range.first, '2026-09-07');
  assert.equal(range.last, '2027-01-24');
});

test('默认日期：不显示周末时顺延到工作日', () => {
  assert.equal(defaultDayDate('2026-10-17', true), '2026-10-19');
  assert.equal(defaultDayDate('2026-10-17', false), '2026-10-17');
  assert.equal(defaultDayDate('2026-10-19', true), '2026-10-19');
});

test('翻一天：按自然日或跳过周末', () => {
  assert.equal(stepDay('2026-10-16', 1, { hideWeekends: false, range }), '2026-10-17');
  assert.equal(stepDay('2026-10-16', 1, { hideWeekends: true, range }), '2026-10-19');
  assert.equal(stepDay('2026-10-19', -1, { hideWeekends: true, range }), '2026-10-16');
  assert.equal(stepDay('2026-10-20', -1, { hideWeekends: false, range }), '2026-10-19');
});

test('翻到学期边界就停', () => {
  assert.equal(stepDay(range.first, -1, { hideWeekends: false, range }), null);
  assert.equal(stepDay(range.last, 1, { hideWeekends: false, range }), null);
  // 最后一天是周日：跳到周一就出了学期
  assert.equal(stepDay(range.last, 1, { hideWeekends: true, range }), null);
});

test('日期夹到学期范围内', () => {
  assert.equal(clampDayDate('2026-08-01', range), range.first);
  assert.equal(clampDayDate('2027-03-01', range), range.last);
  assert.equal(clampDayDate('2026-10-19', range), '2026-10-19');
});
