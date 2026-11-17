import test from 'node:test';
import assert from 'node:assert/strict';
import { weekEmptyKind } from '../src/lib/week-empty.ts';

test('有可见课程时不出空态（含非本周虚线课）', () => {
  assert.equal(
    weekEmptyKind({ visibleLessons: 2, outsideSemester: false, hasOtherWeekLessons: true }),
    'none',
  );
});

test('学期外优先：窗口完全不在学期内时给学期外空态', () => {
  assert.equal(
    weekEmptyKind({ visibleLessons: 0, outsideSemester: true, hasOtherWeekLessons: true }),
    'outside-semester',
  );
});

test('只有非本周课程：显示开关关掉时仍能说清“有别的周课程”而不是“没有课程”', () => {
  assert.equal(
    weekEmptyKind({ visibleLessons: 0, outsideSemester: false, hasOtherWeekLessons: true }),
    'other-weeks',
  );
});

test('真空课表：窗口内没有任何课程时给导入主行动', () => {
  assert.equal(
    weekEmptyKind({ visibleLessons: 0, outsideSemester: false, hasOtherWeekLessons: false }),
    'vacuum',
  );
});
