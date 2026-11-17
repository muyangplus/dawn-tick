import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '@dawn-tick/core';
import {
  canStep,
  clampDayDate,
  clampWindowStart,
  dayRangeOf,
  defaultDayDate,
  stepDay,
  stepWindow,
  weekOfWindow,
  weeksOf,
} from '../src/lib/day-nav.ts';

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

test('翻页边界判定：候选落在学期首末周内才算翻得动', () => {
  assert.equal(canStep(range.first, range), true);
  assert.equal(canStep(range.last, range), true);
  assert.equal(canStep('2026-09-06', range), false);
  assert.equal(canStep('2027-01-25', range), false);
  assert.equal(canStep(null, range), false);
});

test('窗口起点夹进学期：早于第 1 周落到第一周周一，晚于最后一周落到最后一周周一', () => {
  assert.equal(clampWindowStart('2026-08-01', range), range.first);
  assert.equal(clampWindowStart('2027-05-01', range), '2027-01-18');
  assert.equal(clampWindowStart('2026-10-19', range), '2026-10-19');
  assert.equal(weeksOf(range), 20);
  assert.equal(weekOfWindow('2026-10-19', range), 7);
  assert.equal(weekOfWindow('2026-09-01', range), 0);
});

test('周模式翻一屏：学期内按天数平移，越过周末按工作日顺延', () => {
  assert.equal(stepWindow('2026-10-19', 1, { days: 5, range, hideWeekends: false }), '2026-10-24');
  assert.equal(stepWindow('2026-10-19', -1, { days: 7, range, hideWeekends: false }), '2026-10-12');
  assert.equal(stepWindow('2026-10-16', 1, { days: 1, range, hideWeekends: true }), '2026-10-19');
});

test('周模式停在学期首末周：第 1 周不再往前、最后一周不再往后', () => {
  const options = { days: 5, range, hideWeekends: false };
  // 第 1 周的任意一天都翻不动
  assert.equal(stepWindow(range.first, -1, options), null);
  assert.equal(stepWindow(addDays(range.first, 4), -1, options), null);
  // 最后一周（含周中）都翻不动
  const lastMonday = addDays(range.last, -6);
  assert.equal(stepWindow(lastMonday, 1, options), null);
  assert.equal(stepWindow(addDays(lastMonday, 3), 1, options), null);
  // 第 19 周往后翻：落点被夹到最后一周周一，不会把窗口带出学期
  assert.equal(stepWindow('2027-01-13', 1, { days: 7, range, hideWeekends: false }), lastMonday);
  // 第 2 周往前翻：落到第 1 周内
  assert.equal(stepWindow('2026-09-16', -1, { days: 7, range, hideWeekends: false }), '2026-09-09');
});
