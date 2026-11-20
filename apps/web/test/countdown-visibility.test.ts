import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownHideAt, isCountdownVisible } from '../src/lib/countdown-visibility.ts';

// 所有时刻都带显式偏移，不依赖运行机器的本地时区（CI 另在 Asia/Kolkata、America/New_York 下跑）
const at = (text: string): number => Date.parse(text);
const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

test('结束时刻优先取 end_at', () => {
  const row = {
    start_at: at('2026-10-21T09:00:00+08:00'),
    end_at: at('2026-10-21T11:00:00+08:00'),
    due_at: at('2026-10-20T09:00:00+08:00'),
    on_date: '2026-10-21',
  };
  assert.equal(countdownHideAt(row, SH), row.end_at);
});

test('无 end_at 时取 start_at，再无取 due_at', () => {
  const start = at('2026-10-21T09:00:00+08:00');
  const due = at('2026-10-22T23:59:00+08:00');
  assert.equal(countdownHideAt({ start_at: start, due_at: due, on_date: '2026-10-21' }, SH), start);
  assert.equal(countdownHideAt({ due_at: due, on_date: '2026-10-21' }, SH), due);
});

test('非有限或非正的时间列视为缺失', () => {
  const due = at('2026-10-22T23:59:00+08:00');
  assert.equal(countdownHideAt({ end_at: 0, start_at: Number.NaN, due_at: due }, SH), due);
  assert.equal(countdownHideAt({ end_at: Number.POSITIVE_INFINITY, start_at: -5 }, SH), null);
});

test('只有日期：上海时区过完当天（次日 00:00 +08:00）', () => {
  assert.equal(countdownHideAt({ on_date: '2026-10-21' }, SH), at('2026-10-22T00:00:00+08:00'));
});

test('只有日期：纽约时区按当地日界（冬令时 -05:00，夏令时 -04:00）', () => {
  assert.equal(countdownHideAt({ on_date: '2026-12-01' }, NY), at('2026-12-02T00:00:00-05:00'));
  assert.equal(countdownHideAt({ on_date: '2026-07-01' }, NY), at('2026-07-02T00:00:00-04:00'));
  // 夏令时结束当天（11/01）：次日 00:00 已是 -05:00
  assert.equal(countdownHideAt({ on_date: '2026-10-31' }, NY), at('2026-11-01T00:00:00-04:00'));
  assert.equal(countdownHideAt({ on_date: '2026-11-01' }, NY), at('2026-11-02T00:00:00-05:00'));
});

test('只有日期：非法日期不参与判断', () => {
  assert.equal(countdownHideAt({ on_date: '2026/10/21' }, SH), null);
  assert.equal(countdownHideAt({ on_date: 'not-a-date' }, SH), null);
});

test('没有任何时间也未完成：一直显示', () => {
  assert.equal(countdownHideAt({}, SH), null);
  assert.equal(countdownHideAt({ on_date: null, start_at: null, done: 0, updated_at: 123 }, SH), null);
  assert.equal(isCountdownVisible({}, at('2099-01-01T00:00:00Z'), SH), true);
});

test('已完成：取 updated_at 所在日（按时区）的次日 00:00', () => {
  // 上海 10/20 23:30 勾完成 → 10/21 00:00 起消失
  const updated = at('2026-10-20T23:30:00+08:00');
  assert.equal(countdownHideAt({ done: 1, updated_at: updated }, SH), at('2026-10-21T00:00:00+08:00'));
});

test('已完成：同一时刻在上海与纽约落在不同日期', () => {
  // UTC 10/20 17:00 = 上海 10/21 01:00 = 纽约 10/20 13:00
  const updated = at('2026-10-20T17:00:00Z');
  assert.equal(countdownHideAt({ done: 1, updated_at: updated }, SH), at('2026-10-22T00:00:00+08:00'));
  assert.equal(countdownHideAt({ done: 1, updated_at: updated }, NY), at('2026-10-21T00:00:00-04:00'));
});

test('done 非 1 或缺 updated_at 时不按完成处理', () => {
  const updated = at('2026-10-20T10:00:00+08:00');
  assert.equal(countdownHideAt({ done: 0, updated_at: updated }, SH), null);
  assert.equal(countdownHideAt({ done: null, updated_at: updated }, SH), null);
  assert.equal(countdownHideAt({ done: 1, updated_at: null }, SH), null);
  assert.equal(countdownHideAt({ done: 1, updated_at: 0 }, SH), null);
  const start = at('2026-11-01T09:00:00+08:00');
  assert.equal(countdownHideAt({ done: 1, start_at: start }, SH), start);
});

test('结束与完成两者取先到的', () => {
  const updated = at('2026-10-20T10:00:00+08:00');
  const doneHide = at('2026-10-21T00:00:00+08:00');
  // 提前完成：远期考试在完成次日消失
  const future = at('2026-12-01T09:00:00+08:00');
  assert.equal(countdownHideAt({ start_at: future, done: 1, updated_at: updated }, SH), doneHide);
  // 结束早于完成次日：按结束
  const ended = at('2026-10-20T12:00:00+08:00');
  assert.equal(countdownHideAt({ end_at: ended, done: 1, updated_at: updated }, SH), ended);
  // 只有日期 + 完成
  assert.equal(countdownHideAt({ on_date: '2026-10-25', done: 1, updated_at: updated }, SH), doneHide);
});

test('isCountdownVisible：消失时刻之前可见，到点（含）起隐藏', () => {
  const end = at('2026-10-21T11:00:00+08:00');
  const row = { start_at: at('2026-10-21T09:00:00+08:00'), end_at: end };
  assert.equal(isCountdownVisible(row, end - 1, SH), true);
  assert.equal(isCountdownVisible(row, end, SH), false);
  assert.equal(isCountdownVisible(row, end + 1, SH), false);
});

test('isCountdownVisible：只有日期的条目当天全天可见、次日隐藏（按传入时区）', () => {
  const row = { on_date: '2026-10-21' };
  assert.equal(isCountdownVisible(row, at('2026-10-21T23:59:00+08:00'), SH), true);
  assert.equal(isCountdownVisible(row, at('2026-10-22T00:00:00+08:00'), SH), false);
  // 同一时刻（UTC 10/21 16:00）在纽约仍是 10/21 当天
  assert.equal(isCountdownVisible(row, at('2026-10-22T00:00:00+08:00'), NY), true);
  assert.equal(isCountdownVisible(row, at('2026-10-22T00:00:00-04:00'), NY), false);
});

test('isCountdownVisible：完成当天仍可见，次日 00:00 起隐藏', () => {
  const row = { start_at: at('2026-12-01T09:00:00+08:00'), done: 1, updated_at: at('2026-10-20T10:00:00+08:00') };
  assert.equal(isCountdownVisible(row, at('2026-10-20T23:59:59+08:00'), SH), true);
  assert.equal(isCountdownVisible(row, at('2026-10-21T00:00:00+08:00'), SH), false);
});
