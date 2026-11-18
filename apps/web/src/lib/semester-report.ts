import type { SemesterStats } from './semester-stats.ts';

/**
 * 学期报表（CSV）：由学期统计生成，只有课时与考试，不含任何出勤信息。
 * 分段写在同一张表里，段与段之间空一行；开头带 BOM，Excel 直接打开不乱码。
 */
export function semesterReportCsv(stats: SemesterStats, semesterName: string): string {
  const rows: string[][] = [];
  rows.push(['学期', semesterName]);
  if (stats.semester !== null) {
    rows.push(['起止', `${stats.semester.startDate} 至 ${stats.semester.endDate}`]);
    rows.push(['总周数', String(stats.semester.totalWeeks)]);
  }
  rows.push(['已上课时', String(stats.lessons.past)]);
  rows.push(['待上课时', String(stats.lessons.upcoming)]);
  rows.push(['说明', '停课的课次计入已上课时']);

  rows.push([]);
  rows.push(['课程', '已上课时', '总课时', '剩余课时']);
  for (const course of stats.courses) {
    rows.push([course.name, String(course.done), String(course.total), String(course.total - course.done)]);
  }

  rows.push([]);
  rows.push(['周次', '已上课时', '待上课时']);
  for (const week of stats.weeks) {
    rows.push([`第 ${week.week} 周`, String(week.past), String(week.upcoming)]);
  }

  rows.push([]);
  rows.push(['考试', '日期', '状态']);
  for (const exam of stats.exams.timeline) {
    rows.push([exam.title, exam.date ?? '日期待定', exam.taken ? '已考' : '待考']);
  }

  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** 报表文件名：与其他导出一致，默认全英文，只带日期。 */
export function semesterReportFileName(today: string): string {
  return `DawnTick-semester-report-${today}.csv`;
}

/** 含逗号、引号、换行或首尾空白的单元格加引号；以 = + - @ 开头的前置单引号，防表格公式注入。 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
