import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  dateRange,
  dateWallClockToEpoch,
  dayOfWeek,
  diffDays,
  formatDate,
  formatDateTime,
  formatTime,
  isWeekend,
  nextWorkday,
  plusMinutesText,
  previousWorkday,
  resolveTimeZone,
  weekOfDate,
  weekStart,
} from '../src/time.ts';

test('上海时区墙钟转 UTC epoch 毫秒', () => {
  assert.equal(dateWallClockToEpoch('2026-09-21', '08:00', 'Asia/Shanghai'), Date.UTC(2026, 8, 21, 0, 0, 0));
  assert.equal(dateWallClockToEpoch('2026-09-21', '14:00', 'Asia/Shanghai'), Date.UTC(2026, 8, 21, 6, 0, 0));
});

test('其他时区含夏令时', () => {
  assert.equal(
    dateWallClockToEpoch('2026-09-21', '08:00', 'America/New_York'),
    Date.UTC(2026, 8, 21, 12, 0, 0),
  );
  assert.equal(
    dateWallClockToEpoch('2026-01-15', '08:00', 'America/New_York'),
    Date.UTC(2026, 0, 15, 13, 0, 0),
  );
});

test('UTC 与显示双向一致', () => {
  const epoch = dateWallClockToEpoch('2026-09-21', '08:00', 'Asia/Shanghai');
  assert.equal(formatDateTime(epoch, 'Asia/Shanghai'), '2026-09-21 08:00');
  assert.equal(formatDate(epoch, 'Asia/Shanghai'), '2026-09-21');
  assert.equal(formatTime(epoch, 'Asia/Shanghai'), '08:00');
});

test('开学日期所在周为第 1 周', () => {
  assert.equal(dayOfWeek('2026-09-07'), 1);
  assert.equal(weekOfDate('2026-09-07', '2026-09-07'), 1);
  assert.equal(weekOfDate('2026-09-21', '2026-09-07'), 3);
  assert.equal(weekOfDate('2026-10-09', '2026-09-07'), 5);
  assert.equal(weekOfDate('2026-09-06', '2026-09-07'), 0);
});

test('纯日期运算不受时区影响', () => {
  assert.equal(addDays('2026-09-07', 7), '2026-09-14');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-09-21', '2026-09-07'), 14);
  assert.equal(weekStart('2026-09-10'), '2026-09-07');
  assert.equal(weekStart('2026-09-13'), '2026-09-07');
  assert.deepEqual(dateRange('2026-09-07', '2026-09-09'), [
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
  ]);
});

test('周末与工作日翻页', () => {
  assert.equal(isWeekend('2026-10-17'), true);
  assert.equal(isWeekend('2026-10-19'), false);
  assert.equal(nextWorkday('2026-10-16'), '2026-10-16');
  assert.equal(nextWorkday('2026-10-17'), '2026-10-19');
  assert.equal(previousWorkday('2026-10-19'), '2026-10-19');
  assert.equal(previousWorkday('2026-10-18'), '2026-10-16');
});

test('非法输入被拒绝', () => {
  assert.throws(() => dateWallClockToEpoch('2026/09/21', '08:00', 'Asia/Shanghai'));
  assert.throws(() => dateWallClockToEpoch('2026-09-21', '8:00', 'Asia/Shanghai'));
});

test('显示时区解析', () => {
  assert.equal(resolveTimeZone('Asia/Shanghai', false), 'Asia/Shanghai');
  assert.equal(resolveTimeZone('Asia/Shanghai', true, 'America/New_York'), 'America/New_York');
  assert.equal(resolveTimeZone('Bad/Zone', false), DEFAULT_TIME_ZONE);
  assert.equal(resolveTimeZone(undefined, true, 'Bad/Zone'), DEFAULT_TIME_ZONE);
});

test('HH:MM 加分钟跨天回绕', () => {
  assert.equal(plusMinutesText('08:00', 45), '08:45');
  assert.equal(plusMinutesText('08:55', 10), '09:05');
  assert.equal(plusMinutesText('23:30', 45), '00:15');
  assert.equal(plusMinutesText('23:30', 60), '00:30');
  assert.equal(plusMinutesText('01:00', -90), '23:30', '负偏移不前移成非法时刻');
});
