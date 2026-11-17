import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountdown,
  formatDayCountdown,
  formatPeriodRange,
  formatRemaining,
  formatShortCountdown,
} from '../src/lib/format.ts';
import { dayStampLocal, dayStampUtc, formatMonthDayRange } from '../src/lib/dates.ts';

test('节次范围：单节、连堂、倒序归一化', () => {
  assert.equal(formatPeriodRange(3, 3), '第 3 节');
  assert.equal(formatPeriodRange(3, 5), '第 3–5 节', '连堂用 en dash');
  assert.equal(formatPeriodRange(5, 3), '第 3–5 节', '倒序输入按小→大归一化');
});

test('倒计时：分钟补零、超一小时带小时位、到点文案各不相同', () => {
  assert.equal(formatCountdown(0), '即将开始');
  assert.equal(formatCountdown(-1), '即将开始');
  assert.equal(formatCountdown(65_000), '01:05');
  assert.equal(formatCountdown(3_665_000), '1:01:05');

  const now = Date.UTC(2026, 9, 14, 0, 0, 0);
  assert.equal(formatRemaining(now + 65_000, now), '01:05');
  assert.equal(formatRemaining(now, now), '00:00', '到点不是「即将开始」');
  assert.equal(formatRemaining(now - 5_000, now), '00:00');

  assert.equal(formatShortCountdown(30_000), '1 分钟');
  assert.equal(formatShortCountdown(90 * 60_000), '1 小时 30 分');
  assert.equal(formatDayCountdown(now + 2 * 86_400_000, now), '2 天');
});

test('日期戳：本地与 UTC 两种口径', () => {
  const local = new Date(2026, 9, 14, 23, 30, 0).getTime();
  assert.equal(dayStampLocal(local), '2026-10-14', '本地日期按本机时区取年月日');
  assert.equal(dayStampUtc(Date.UTC(2026, 9, 14, 23, 30, 0)), '2026-10-14', 'UTC 日期按 UTC 取年月日');
});

test('月日区间：同日、同月、跨月、跨年', () => {
  assert.equal(formatMonthDayRange('2026-08-19'), '8/19');
  assert.equal(formatMonthDayRange('2026-08-19', '2026-08-19'), '8/19');
  assert.equal(formatMonthDayRange('2026-08-19', '2026-08-23'), '8/19–23');
  assert.equal(formatMonthDayRange('2026-08-30', '2026-09-02'), '8/30–9/2');
  assert.equal(formatMonthDayRange('2026-12-30', '2027-01-02'), '12/30–1/2');
});
