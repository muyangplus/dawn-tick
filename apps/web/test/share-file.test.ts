import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemester, MemoryStorage, type SemesterRow } from '@dawn-tick/core';
import { courseRow } from '@dawn-tick/core/testing';
import { exportActiveShare, importShareText, looksLikeShare, shareFileName } from '../src/lib/share-file.ts';

const NOW = Date.parse('2026-11-18T12:00:00+08:00');

async function seeded(name: string): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  const semester = await createSemester(storage, { userId: 'u1', name, startDate: '2026-09-07', timeZone: 'Asia/Shanghai' });
  await storage.collection('courses').put(courseRow('c-1', '高等数学', { semester_id: String(semester['id']) }));
  return storage;
}

test('分享文件：导出当前学期，另一台设备导入为非当前的新学期', async () => {
  const source = await seeded('2026 秋');
  const exported = await exportActiveShare(source, NOW);
  assert.ok(exported !== null);
  assert.equal(exported.semesterName, '2026 秋');
  assert.ok(looksLikeShare(exported.text));

  const target = await seeded('本机学期');
  const outcome = await importShareText(target, exported.text, NOW);
  assert.equal(outcome.semesterName, '2026 秋');
  assert.deepEqual(outcome.warnings, []);
  const semesters = await target.collection<SemesterRow>('semesters').getAll();
  assert.equal(semesters.length, 2);
  assert.equal(semesters.find((row) => row.name === '本机学期')?.is_active, 1);
  assert.equal(semesters.find((row) => row.name === '2026 秋')?.is_active, 0);
});

test('分享文件：没有学期时不导出，空库导入给可读错误', async () => {
  const empty = new MemoryStorage();
  assert.equal(await exportActiveShare(empty, NOW), null);
  const exported = await exportActiveShare(await seeded('A'), NOW);
  await assert.rejects(importShareText(empty, exported!.text, NOW), /先创建一个学期/);
});

test('分享文件识别与文件名', () => {
  assert.equal(looksLikeShare('{"format":"dawn-tick-backup"}'), false);
  assert.equal(looksLikeShare('not json'), false);
  assert.equal(looksLikeShare(' {"format":"dawn-tick-share","version":1} '), true);
  assert.match(shareFileName(NOW), /^DawnTick-timetable-share-\d{4}-\d{2}-\d{2}\.json$/);
});
