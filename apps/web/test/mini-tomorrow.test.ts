import test from 'node:test';
import assert from 'node:assert/strict';
import { previewDateFor, shouldShowTomorrow, tomorrowPreviewLessons } from '../src/mini/tomorrow.ts';

test('预告日期：默认明天，不显示周末时顺延到下一个工作日', () => {
  // 2026-10-16 周五、10-17 周六、10-18 周日、10-19 周一
  assert.equal(previewDateFor('2026-10-15', false), '2026-10-16');
  assert.equal(previewDateFor('2026-10-15', true), '2026-10-16');
  assert.equal(previewDateFor('2026-10-16', true), '2026-10-19');
  assert.equal(previewDateFor('2026-10-17', true), '2026-10-19');
  assert.equal(previewDateFor('2026-10-16', false), '2026-10-17');
});

test('预告判定：开关、课数与今天的课都上完才显示', () => {
  const base = { enabled: true, todayEnds: [100, 200], tomorrowCount: 1, now: 300 };
  assert.equal(shouldShowTomorrow(base), true);
  assert.equal(shouldShowTomorrow({ ...base, enabled: false }), false);
  assert.equal(shouldShowTomorrow({ ...base, tomorrowCount: 0 }), false);
  assert.equal(shouldShowTomorrow({ ...base, now: 150 }), false);
  assert.equal(tomorrowPreviewLessons([1, 2, 3, 4, 5]).length, 4);
});
