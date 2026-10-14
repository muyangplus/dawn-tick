import test from 'node:test';
import assert from 'node:assert/strict';
import { PAD_MAX_ROWS, gridMetrics, minuteOf, minuteToY, padLabel } from '../src/lib/grid-metrics.ts';

/** 常用作息：8:00 开始，每节 45 分钟，课间 5 分钟，共 4 节。 */
const slots = [
  { periodNo: 1, startTime: '08:00', endTime: '08:45' },
  { periodNo: 2, startTime: '08:50', endTime: '09:35' },
  { periodNo: 3, startTime: '09:40', endTime: '10:25' },
  { periodNo: 4, startTime: '10:30', endTime: '11:15' },
];
const ROW = 56;

/** 浮点比较：像素换算会出现 1e-14 级误差。 */
function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
}

test('墙钟解析容忍空值与非法值', () => {
  assert.equal(minuteOf('08:00'), 480);
  assert.equal(minuteOf(' 9:05 '), 545);
  assert.equal(minuteOf(''), null);
  assert.equal(minuteOf(null), null);
  assert.equal(minuteOf(undefined), null);
  assert.equal(minuteOf('abc'), null);
});

test('没有自定义条目时不补白', () => {
  const metrics = gridMetrics(slots, [], ROW);
  assert.equal(metrics.padTop, 0);
  assert.equal(metrics.padBottom, 0);
  assert.equal(metrics.firstMinute, 480);
  assert.equal(metrics.lastMinute, 675);
  assert.equal(metrics.minutesPerRow, 45);
});

test('自定义条目早于第一节 / 晚于最后一节时按分钟补白', () => {
  const early = gridMetrics(slots, [{ customStart: '07:30', customEnd: '08:30' }], ROW);
  assert.equal(early.padTop, 37, '早 30 分钟 ≈ 0.67 行');
  assert.equal(early.padBottom, 0);

  const late = gridMetrics(slots, [{ customStart: '10:00', customEnd: '12:00' }], ROW);
  assert.equal(late.padTop, 0);
  assert.equal(late.padBottom, 56, '晚 45 分钟 = 1 行');
});

test('补白最多各三行，错误的作息撑不开网格', () => {
  const absurd = gridMetrics(slots, [{ customStart: '00:00', customEnd: '23:59' }], ROW);
  assert.equal(absurd.padTop, ROW * PAD_MAX_ROWS);
  assert.equal(absurd.padBottom, ROW * PAD_MAX_ROWS);
});

test('分钟映射：节内线性、课间过渡、补白外推', () => {
  const metrics = gridMetrics(slots, [{ customStart: '07:30', customEnd: '12:00' }], ROW);
  const y = (minute: number): number => minuteToY(minute, slots, ROW, metrics);
  const padTop = metrics.padTop;

  assert.equal(y(480), padTop, '第一节开始 = 补白底部');
  assert.equal(y(525), padTop + ROW, '第一节结束 = 第一行底部');
  close(y(485), padTop + (5 / 45) * ROW);
  close(y(527.5), padTop + 0.5 * ROW);
  assert.equal(y(675), padTop + 4 * ROW, '最后一节结束 = 网格节次区底部');
  assert.ok(y(720) > padTop + 4 * ROW, '晚于最后一节落在尾部补白内');
  assert.ok(y(465) < padTop, '早于第一节落在头部补白内');
  close(y(465), padTop - (15 / 45) * ROW);
});

test('整点时线随补白一起平移', () => {
  const none = gridMetrics(slots, [], ROW);
  const padded = gridMetrics(slots, [{ customStart: '07:00', customEnd: '12:00' }], ROW);
  close(
    minuteToY(540, slots, ROW, padded) - minuteToY(540, slots, ROW, none),
    padded.padTop,
  );
  assert.equal(minuteToY(480, slots, ROW, none), 0, '无补白时第一节顶部就是网格顶部');
});

test('补白文案是 HH:MM–HH:MM', () => {
  assert.equal(padLabel(450, 480), '07:30–08:00');
  assert.equal(padLabel(675, 735), '11:15–12:15');
});
