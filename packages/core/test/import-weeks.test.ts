import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeWeeks, parseWeeksText } from '../src/import/weeks-text.ts';

test('连续周次', () => {
  assert.deepEqual(parseWeeksText('1-16周', 20), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(parseWeeksText('第1-4周', 20), [1, 2, 3, 4]);
  assert.deepEqual(parseWeeksText('1~4周', 20), [1, 2, 3, 4]);
});

test('单双周', () => {
  assert.deepEqual(parseWeeksText('1-16周(单)', 20), [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.deepEqual(parseWeeksText('2-16周(双)', 20), [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual(parseWeeksText('单周', 8), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeksText('双周', 8), [2, 4, 6, 8]);
  assert.deepEqual(parseWeeksText('1-8周单周', 20), [1, 3, 5, 7]);
});

test('离散与多段周次', () => {
  assert.deepEqual(parseWeeksText('1,3,5,7周', 20), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeksText('2-4,6-8周', 20), [2, 3, 4, 6, 7, 8]);
  assert.deepEqual(parseWeeksText('1-2周、5周', 20), [1, 2, 5]);
});

test('全角与空格', () => {
  assert.deepEqual(parseWeeksText('１－４周', 20), [1, 2, 3, 4]);
  assert.deepEqual(parseWeeksText(' 1 - 3 周 ', 20), [1, 2, 3]);
});

test('超出总周数被裁剪', () => {
  assert.deepEqual(parseWeeksText('18-22周', 20), [18, 19, 20]);
  assert.equal(parseWeeksText('30-40周', 20), null);
});

test('无法解析时返回 null', () => {
  assert.equal(parseWeeksText('', 20), null);
  assert.equal(parseWeeksText('阶梯教室', 20), null);
  assert.equal(parseWeeksText('A-201', 20), null);
});

test('looksLikeWeeks 识别周次文本', () => {
  assert.equal(looksLikeWeeks('1-16周'), true);
  assert.equal(looksLikeWeeks('单周'), true);
  assert.equal(looksLikeWeeks('张老师'), false);
});
