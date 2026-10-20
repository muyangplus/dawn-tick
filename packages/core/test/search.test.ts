import test from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, searchAll } from '../src/search.ts';
import { weeksToMask } from '../src/weeks.ts';
import { USER_ID, courseRow, createStorage, seedStorage, semesterRow, weekRange } from './helpers.ts';

test('匹配评分：前缀优先', () => {
  assert.equal(matchScore('高等数学', '高'), 3);
  assert.equal(matchScore('高等数学', '数学'), 2);
  assert.equal(matchScore('高等数学', '英语'), 0);
  assert.equal(matchScore(null, '高'), 0);
  assert.equal(matchScore('高等数学', '   '), 0);
  assert.equal(matchScore('Data Structure', 'data'), 3);
});

test('搜索命中课程、排课与日程', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put({
    id: 'e-exam',
    user_id: USER_ID,
    semester_id: 'sem-1',
    type: 'exam',
    title: '高等数学期末',
    subject: '高等数学',
    location: '教三-201',
    priority: 4,
    start_at: Date.UTC(2027, 0, 5, 1, 0, 0),
    on_date: '2027-01-05',
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    rev: 0,
    dirty: 0,
  });

  const byName = await searchAll(storage, 'sem-1', '高数');
  assert.ok(byName.some((hit) => hit.kind === 'course' && hit.title === '高等数学'));

  const byRoom = await searchAll(storage, 'sem-1', '教三');
  assert.ok(byRoom.some((hit) => hit.kind === 'schedule'));

  const byExam = await searchAll(storage, 'sem-1', '期末');
  assert.ok(byExam.some((hit) => hit.kind === 'event' && hit.title === '高等数学期末'));
  // 命中要能直接定位：日程带日期、排课带周次位图
  const examHit = byExam.find((hit) => hit.kind === 'event' && hit.title === '高等数学期末');
  assert.equal(examHit?.date, '2027-01-05');
  const scheduleHit = byRoom.find((hit) => hit.kind === 'schedule');
  assert.equal(scheduleHit?.weeksMask, weeksToMask(weekRange(1, 16)));

  assert.deepEqual(await searchAll(storage, 'sem-1', ''), []);
  assert.deepEqual(await searchAll(storage, 'sem-1', '不存在的关键词'), []);
});

test('搜索结果按分数排序并受限', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const hits = await searchAll(storage, 'sem-1', '高', 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.title, '高等数学');

  const all = await searchAll(storage, 'sem-1', '高');
  for (let index = 1; index < all.length; index += 1) {
    assert.ok((all[index - 1]?.score ?? 0) >= (all[index]?.score ?? 0));
  }
});

test('不返回其他学期的课程', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('semesters').put(semesterRow({ id: 'sem-2', is_active: 0 }));
  await storage.collection('courses').put(courseRow('c-9', '另一门课', { semester_id: 'sem-2' }));
  const hits = await searchAll(storage, 'sem-1', '另一门课');
  assert.deepEqual(hits, []);
});
