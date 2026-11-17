import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustFormOnOpen, blankAdjustForm, scheduleSelection } from '../src/screens/timetable/adjust-form.ts';

const context = { today: '2026-09-21', semesterStart: '2026-09-07', firstCourseId: 'c-1' };
const target = {
  scheduleId: 's-1',
  courseId: 'c-2',
  courseName: '高等数学',
  date: '2026-09-21',
  periodStart: 3,
  periodEnd: 4,
};

test('无目标打开：回到改期、这一次，日期取今天，周次按学期算', () => {
  const patch = adjustFormOnOpen(null, context);
  assert.equal(patch.mode, 'move');
  assert.equal(patch.scope, 'this');
  assert.equal(patch.newDate, '2026-09-21');
  assert.equal(patch.targetWeek, '3');
  assert.equal(patch.courseId, 'c-1');
  assert.equal('scheduleId' in patch, false, '课次交给课程联动去选');
});

test('无课程时不改课程选择', () => {
  assert.equal('courseId' in adjustFormOnOpen(null, { ...context, firstCourseId: undefined }), false);
});

test('带目标打开按目标预填，同周落点保持这一次并平移节次', () => {
  const patch = adjustFormOnOpen({ ...target, drop: { date: '2026-09-23', periodStart: 5 } }, context);
  assert.deepEqual(
    [patch.courseId, patch.scheduleId, patch.sourceDate, patch.newDate, patch.newStart, patch.newEnd, patch.scope],
    ['c-2', 's-1', '2026-09-21', '2026-09-23', '5', '6', 'this'],
  );
});

test('跨周落点默认指定日期，目标周取落点所在周', () => {
  const patch = adjustFormOnOpen({ ...target, drop: { date: '2026-10-01', periodStart: 1 } }, context);
  assert.equal(patch.scope, 'date');
  assert.equal(patch.targetWeek, '4');
});

test('入口预选模式', () => {
  assert.equal(adjustFormOnOpen({ ...target, mode: 'exam' }, context).mode, 'exam');
});

test('没有学期时周次按 1', () => {
  assert.equal(adjustFormOnOpen(null, { ...context, semesterStart: null }).targetWeek, '1');
});

test('课次联动：失效时选第一个并带节次，有效或已空时不动', () => {
  const schedules = [
    { id: 's-a', periodStart: 1, periodEnd: 2 },
    { id: 's-b', periodStart: 5, periodEnd: 6 },
  ];
  assert.deepEqual(scheduleSelection(schedules, 'gone'), { scheduleId: 's-a', newStart: '1', newEnd: '2' });
  assert.equal(scheduleSelection(schedules, 's-b'), null);
  assert.deepEqual(scheduleSelection([], 's-a'), { scheduleId: '' });
  assert.equal(scheduleSelection([], ''), null);
});

test('空白表单日期全取今天', () => {
  const form = blankAdjustForm('2026-09-21');
  assert.deepEqual([form.sourceDate, form.newDate, form.restFrom, form.restTo, form.extraDate], Array(5).fill('2026-09-21'));
});
