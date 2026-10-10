import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWeek,
  describeWeeks,
  hasWeek,
  maskToWeeks,
  parityMask,
  setWeek,
  weeksToMask,
} from '../src/weeks.ts';

function weekRange(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let week = from; week <= to; week += step) out.push(week);
  return out;
}

test('位图编码与手算一致', () => {
  assert.equal(weeksToMask(weekRange(1, 16)), 65535);
  assert.equal(weeksToMask([1, 3, 5, 7]), 85);
  assert.equal(weeksToMask(weekRange(2, 16, 2)), 43690);
});

test('第 N 周对应第 (N-1) 位', () => {
  assert.equal(hasWeek(1, 1), true);
  assert.equal(hasWeek(1, 2), false);
  assert.equal(hasWeek(2, 2), true);
  assert.equal(hasWeek(0, 1), false);
});

test('上界 30 周可用，越界抛错', () => {
  const mask = setWeek(0, 30);
  assert.equal(mask, 536870912);
  assert.equal(hasWeek(mask, 30), true);
  assert.equal(hasWeek(mask, 31), false);
  assert.throws(() => setWeek(0, 31));
  assert.throws(() => setWeek(0, 0));
  assert.throws(() => setWeek(0, 1.5));
});

test('清除与反向转换', () => {
  assert.equal(clearWeek(85, 3), 81);
  assert.deepEqual(maskToWeeks(85, 20), [1, 3, 5, 7]);
  assert.deepEqual(maskToWeeks(85, 4), [1, 3]);
});

test('单双周掩码', () => {
  assert.equal(parityMask(16, 'even'), 43690);
  assert.equal(parityMask(16, 'odd'), 21845);
});

test('周次文本', () => {
  assert.equal(describeWeeks(65535, 20), '1-16周');
  assert.equal(describeWeeks(43690, 20), '2-16周(双)');
  assert.equal(describeWeeks(weeksToMask([1, 3, 5, 7]), 20), '1-7周(单)');
  assert.equal(describeWeeks(weeksToMask([1, 2, 3, 5, 7]), 20), '1-3,5,7周');
  assert.equal(describeWeeks(0, 20), '');
});
