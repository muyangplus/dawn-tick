import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentPeriod,
  minutesOfDay,
  nowRatio,
  slotRangeRatio,
  timelineBounds,
} from '../src/lib/timeline.ts';
import { formatCountdown, formatDayCountdown, formatShortCountdown } from '../src/lib/format.ts';

const SLOTS = [
  { periodNo: 1, startTime: '08:00', endTime: '08:45' },
  { periodNo: 2, startTime: '08:55', endTime: '09:40' },
  { periodNo: 3, startTime: '10:00', endTime: '10:45' },
];

test('时间解析与范围', () => {
  assert.equal(minutesOfDay('08:00'), 480);
  assert.equal(minutesOfDay('8:05'), 485);
  assert.throws(() => minutesOfDay('八点'), /非法时间/);
  assert.deepEqual(timelineBounds(SLOTS), { start: 480, end: 645 });
  assert.equal(timelineBounds([]), null);
});

test('当前时间比例', () => {
  assert.equal(nowRatio([], 500), null);
  assert.equal(nowRatio(SLOTS, 400), null);
  assert.equal(nowRatio(SLOTS, 700), null);
  assert.equal(nowRatio(SLOTS, 480), 0);
  assert.equal(nowRatio(SLOTS, 645), 1);
  const mid = nowRatio(SLOTS, 562.5);
  assert.ok(mid !== null && Math.abs(mid - 0.5) < 1e-9);
});

test('节次区间比例', () => {
  const first = slotRangeRatio(SLOTS, '08:00', '08:45');
  assert.ok(first !== null);
  assert.equal(first.top, 0);
  assert.ok(Math.abs(first.height - 45 / 165) < 1e-9);
  const last = slotRangeRatio(SLOTS, '10:00', '10:45');
  assert.ok(last !== null && Math.abs(last.top + last.height - 1) < 1e-9);
  assert.equal(slotRangeRatio([], '08:00', '08:45'), null);
});

test('当前节次', () => {
  assert.equal(currentPeriod(SLOTS, 480), 1);
  assert.equal(currentPeriod(SLOTS, 500), 1);
  assert.equal(currentPeriod(SLOTS, 530), null);
  assert.equal(currentPeriod(SLOTS, 470), null);
  assert.equal(currentPeriod(SLOTS, 600), 3);
});

test('倒计时格式', () => {
  assert.equal(formatCountdown(-1), '即将开始');
  assert.equal(formatCountdown(65_000), '01:05');
  assert.equal(formatCountdown(3_665_000), '1:01:05');
  assert.equal(formatShortCountdown(90_000), '1 分钟');
  assert.equal(formatShortCountdown(3_600_000), '1 小时');
  assert.equal(formatShortCountdown(5_400_000), '1 小时 30 分');
  assert.equal(formatDayCountdown(1_000_000 + 86_400_000 * 2, 1_000_000), '2 天');
  assert.equal(formatDayCountdown(500, 1_000_000), '今天');
});
