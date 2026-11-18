import test from 'node:test';
import assert from 'node:assert/strict';
import type { SemesterStats } from '../src/lib/semester-stats.ts';
import { semesterReportCsv, semesterReportFileName } from '../src/lib/semester-report.ts';

function stats(overrides: Partial<SemesterStats> = {}): SemesterStats {
  return {
    semester: { currentWeek: 3, totalWeeks: 2, startDate: '2026-09-07', endDate: '2026-09-20', phase: 'during' },
    lessons: { past: 3, upcoming: 2, total: 5 },
    courses: [
      { courseId: 'c1', name: '高等数学', color: '#4F8DFD', done: 2, total: 3 },
      { courseId: 'c2', name: '=SUM(A1), "英语"', color: '#F59E0B', done: 1, total: 2 },
    ],
    weeks: [
      { week: 1, past: 3, upcoming: 0 },
      { week: 2, past: 0, upcoming: 2 },
    ],
    exams: {
      total: 2, taken: 1, upcoming: 1, next: null,
      timeline: [
        { id: 'e1', title: '期中', date: '2026-09-10', taken: true },
        { id: 'e2', title: '期末', date: null, taken: false },
      ],
    },
    empty: false,
    ...overrides,
  } as SemesterStats;
}

function lines(csv: string): string[] {
  return csv.replace(/^﻿/, '').split('\r\n');
}

test('学期报表：BOM、CRLF 与各分段', () => {
  const csv = semesterReportCsv(stats(), '2026 秋');
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.endsWith('\r\n'));
  const rows = lines(csv);
  assert.equal(rows[0], '学期,2026 秋');
  assert.ok(rows.includes('起止,2026-09-07 至 2026-09-20'));
  assert.ok(rows.includes('已上课时,3'));
  assert.ok(rows.includes('待上课时,2'));
  assert.ok(rows.includes('说明,停课的课次计入已上课时'));
  assert.ok(rows.includes('课程,已上课时,总课时,剩余课时'));
  assert.ok(rows.includes('高等数学,2,3,1'));
  assert.ok(rows.includes('第 1 周,3,0'));
  assert.ok(rows.includes('第 2 周,0,2'));
  assert.ok(rows.includes('期中,2026-09-10,已考'));
  assert.ok(rows.includes('期末,日期待定,待考'));
});

test('学期报表：引号转义并防公式注入', () => {
  const rows = lines(semesterReportCsv(stats(), '学期'));
  assert.ok(rows.includes(`"'=SUM(A1), ""英语""",1,2,1`));
});

test('学期报表：不含任何出勤信息', () => {
  const csv = semesterReportCsv(stats(), '学期');
  assert.ok(!/attend|出勤|缺勤|签到/i.test(csv));
});

test('学期报表：无学期时只给课时与空分段', () => {
  const rows = lines(semesterReportCsv(stats({ semester: null, courses: [], weeks: [] }), '学期'));
  assert.ok(!rows.some((row) => row.startsWith('起止')));
  assert.ok(rows.includes('课程,已上课时,总课时,剩余课时'));
});

test('学期报表文件名：英文加日期', () => {
  assert.equal(semesterReportFileName('2026-11-18'), 'DawnTick-semester-report-2026-11-18.csv');
});
