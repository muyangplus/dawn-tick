import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, createEvent, createSemester, ensureUser } from '@dawn-tick/core';
import {
  advanceIdFor,
  eventTypeFor,
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
