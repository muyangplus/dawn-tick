import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRefreshAt, shouldRefreshOnResume } from '../src/lib/clock-boundary.ts';
import { occurrenceOf } from './kit/app-data.ts';

const at = (hh: number, mm: number): number => Date.UTC(2026, 9, 13, hh - 8, mm);

test('B3 下一次刷新取今天剩余课次的起止或午夜中最早的', () => {
  const lessons = [
    occurrenceOf({ startAt: at(8, 0), endAt: at(9, 40) }),
    occurrenceOf({ startAt: at(10, 0), endAt: at(11, 40) }),
  ];
  const data = { today: '2026-10-13', timeZone: 'Asia/Shanghai', todayLessons: lessons };
  assert.equal(nextRefreshAt(data, at(7, 0)), at(8, 0) + 1000);
  assert.equal(nextRefreshAt(data, at(8, 30)), at(9, 40) + 1000);
  assert.equal(nextRefreshAt(data, at(12, 0)), Date.UTC(2026, 9, 13, 16, 0) + 1000, '没课了就等到当地午夜');
});

test('B3 回到前台：跨日或离上次载入超过一分钟才重载', () => {
  assert.equal(shouldRefreshOnResume(0, '2026-10-13', 30_000, '2026-10-13'), false);
  assert.equal(shouldRefreshOnResume(0, '2026-10-13', 61_000, '2026-10-13'), true);
  assert.equal(shouldRefreshOnResume(0, '2026-10-13', 1_000, '2026-10-14'), true);
});
