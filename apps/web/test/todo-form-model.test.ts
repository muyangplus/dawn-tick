import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, createEvent, createSemester, ensureUser } from '@dawn-tick/core';
import {
  advanceIdFor,
  blankTodoForm,
  eventTypeFor,
  kindDefaults,
  todoFormForCreate,
  todoFormFromEvent,
  loadEventAdvance,
  syncEventReminder,
} from '../src/screens/todo-form-model.ts';

test('A12 表单类型与关联课程决定条目类型，新建与编辑同一口径', () => {
  assert.equal(eventTypeFor('exam', true), 'exam');
  assert.equal(eventTypeFor('lab', false), 'lab');
  assert.equal(eventTypeFor('homework', false), 'homework');
  assert.equal(eventTypeFor('todo', true), 'todo');
  assert.equal(eventTypeFor('todo', false), 'temp');
});

test('A12 已有提醒回填为最接近的选项，没有提醒回填「不提醒」', () => {
  assert.equal(advanceIdFor(null), 'none');
  assert.equal(advanceIdFor(0), 'same');
  assert.equal(advanceIdFor(30), 'half');
  assert.equal(advanceIdFor(24 * 60), 'day');
  assert.equal(advanceIdFor(45), 'half');
});

test('A12 编辑时改提前量写回提醒，改为不提醒则删除', async () => {
  const storage = new MemoryStorage();
  await ensureUser(storage, 'u1');
  const semester = await createSemester(storage, { userId: 'u1', name: '学期', startDate: '2026-09-07', timeZone: 'Asia/Shanghai' });
  const event = await createEvent(storage, {
    userId: 'u1',
    semesterId: String(semester['id']),
    type: 'exam',
    title: '期末',
    onDate: '2026-12-30',
    startAt: Date.UTC(2026, 11, 30, 6, 30),
  });
  const id = String(event['id']);
  assert.equal(await loadEventAdvance(storage, id), null);
  await syncEventReminder(storage, 'u1', id, 30);
  assert.equal(await loadEventAdvance(storage, id), 30);
  await syncEventReminder(storage, 'u1', id, 24 * 60);
  assert.equal(await loadEventAdvance(storage, id), 24 * 60);
  await syncEventReminder(storage, 'u1', id, -1);
  assert.equal(await loadEventAdvance(storage, id), null);
});

test('类型默认开关：作业与考试开倒计时，只有作业要手动完成；实验新建默认上课表', () => {
  assert.deepEqual(kindDefaults('homework'), { kind: 'homework', countdown: true, manualDone: true });
  assert.deepEqual(kindDefaults('exam'), { kind: 'exam', countdown: true, manualDone: false });
  assert.deepEqual(kindDefaults('todo'), { kind: 'todo', countdown: false, manualDone: false });
  assert.equal(blankTodoForm('lab', '2026-09-21').showInTimetable, true);
  assert.equal(todoFormForCreate('todo').showInTimetable, false);
  assert.equal('title' in todoFormForCreate('todo'), false, '新建重开不清已填标题');
});

test('编辑回填：时刻按学期时区取原值，周次按掩码展开，节次缺结束时取开始', async () => {
  const storage = new MemoryStorage();
  await ensureUser(storage, 'u1');
  const semester = await createSemester(storage, { userId: 'u1', name: '学期', startDate: '2026-09-07' });
  const row = await createEvent(storage, {
    userId: 'u1',
    type: 'lab',
    title: '物理实验',
    semesterId: String(semester['id']),
    onDate: '2026-09-22',
    startAt: Date.UTC(2026, 8, 22, 6, 30),
    nature: 'lab',
    periodStart: 5,
    weeksMask: 0b101,
    asDayOfWeek: 2,
    showInTimetable: true,
    countdown: true,
  });
  const form = todoFormFromEvent(row as never, { timeZone: 'Asia/Shanghai', totalWeeks: 16, now: 0 });
  assert.equal(form.kind, 'lab');
  assert.equal(form.dueDate, '2026-09-22');
  assert.equal(form.dueTime, '14:30');
  assert.equal(form.advance, 'none');
  assert.deepEqual(form.labWeeks, [1, 3]);
  assert.equal(form.labRepeat, true);
  assert.equal(form.labWeekday, 2);
  assert.deepEqual([form.labPeriodStart, form.labPeriodEnd], ['5', '5']);
  assert.equal(form.showInTimetable, true);
  assert.equal(form.countdown, true);
  assert.equal(form.customTime, false);
});
