import test from 'node:test';
import assert from 'node:assert/strict';
import { ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, nextRowHeight, rowHeightFor } from '../src/lib/row-height.ts';

test('没有可量内容时不动行高', () => {
  assert.equal(rowHeightFor([]), null);
  assert.equal(rowHeightFor([{ span: 0, contentHeight: 100 }]), null);
  assert.equal(rowHeightFor([{ span: 2, contentHeight: 0 }]), null);
  assert.equal(nextRowHeight(72, []), 72);
});

test('按卡片内容与节次数折算行高', () => {
  // 两节连堂、内容 120px：(120+4)/2 = 62 → 按 4px 取整 64
  assert.equal(rowHeightFor([{ span: 2, contentHeight: 120 }]), 64);
  // 单节内容 51px：55 → 夹到下限
  assert.equal(rowHeightFor([{ span: 1, contentHeight: 51 }]), ROW_HEIGHT_MIN);
  // 单节内容远超上限：夹到上限
  assert.equal(rowHeightFor([{ span: 1, contentHeight: 500 }]), ROW_HEIGHT_MAX);
  // 取所有卡片里要求最高的那一条
  assert.equal(
    rowHeightFor([
      { span: 1, contentHeight: 60 },
      { span: 2, contentHeight: 200 },
    ]),
    ROW_HEIGHT_MAX,
  );
});

test('挤不下立即加高，收回要留余量', () => {
  const tight = [{ span: 1, contentHeight: 120 }];
  const loose = [{ span: 1, contentHeight: 40 }];
  // 内容需要 96（上限），比当前高就立刻加
  assert.equal(nextRowHeight(56, tight), ROW_HEIGHT_MAX);
  assert.equal(nextRowHeight(72, tight), ROW_HEIGHT_MAX);
  // 内容只要 56，当前 60：差 4 不够收回余量，保持
  assert.equal(nextRowHeight(60, loose), 60);
  // 当前 72，目标 56：差 16 超过余量，收回
  assert.equal(nextRowHeight(72, loose), ROW_HEIGHT_MIN);
  // 当前已是下限，目标也是下限：不动
  assert.equal(nextRowHeight(ROW_HEIGHT_MIN, loose), ROW_HEIGHT_MIN);
});
