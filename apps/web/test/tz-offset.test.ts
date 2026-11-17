import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimeZoneLabel, formatUtcOffset, utcOffsetLabel } from '../src/lib/tz-offset.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test('偏移格式化：整小时、半小时与 45 分钟都保留', () => {
  assert.equal(formatUtcOffset(8 * HOUR), 'UTC+8');
  assert.equal(formatUtcOffset(-5 * HOUR), 'UTC-5');
  assert.equal(formatUtcOffset(5.5 * HOUR), 'UTC+5:30');
  assert.equal(formatUtcOffset(5.75 * HOUR), 'UTC+5:45');
  assert.equal(formatUtcOffset(-3.5 * HOUR), 'UTC-3:30');
  assert.equal(formatUtcOffset(0), 'UTC+0');
  // 秒级余量按分钟四舍五入：历史上个别时区带过秒，展示仍按分钟口径
  assert.equal(formatUtcOffset(5 * HOUR + 30 * MINUTE + 20_000), 'UTC+5:30');
});

test('偏移按当前时刻算：夏令时区冬夏不同', () => {
  const summer = Date.UTC(2026, 6, 1, 12);
  const winter = Date.UTC(2026, 0, 15, 12);
  assert.equal(utcOffsetLabel('America/New_York', summer), 'UTC-4');
  assert.equal(utcOffsetLabel('America/New_York', winter), 'UTC-5');
  assert.equal(utcOffsetLabel('Europe/London', summer), 'UTC+1');
  assert.equal(utcOffsetLabel('Europe/London', winter), 'UTC+0');
});

test('半小时 / 45 分钟时区与自动标签', () => {
  const at = Date.UTC(2026, 6, 1);
  assert.equal(utcOffsetLabel('Asia/Kolkata', at), 'UTC+5:30');
  assert.equal(utcOffsetLabel('Asia/Kathmandu', at), 'UTC+5:45');
  assert.equal(utcOffsetLabel('Australia/Eucla', at), 'UTC+8:45');
  assert.equal(utcOffsetLabel('Pacific/Chatham', at), 'UTC+12:45');
  assert.equal(formatTimeZoneLabel('Asia/Shanghai', at), 'Asia/Shanghai (UTC+8)');
  assert.equal(formatTimeZoneLabel('Asia/Kolkata', at), 'Asia/Kolkata (UTC+5:30)');
});

test('无效时区不抛错：偏移返回 null，标签回原名', () => {
  const at = Date.UTC(2026, 6, 1);
  assert.equal(utcOffsetLabel('Mars/Base', at), null);
  assert.equal(utcOffsetLabel('', at), null);
  assert.equal(formatTimeZoneLabel('Mars/Base', at), 'Mars/Base');
});
