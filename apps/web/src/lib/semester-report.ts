import { exportReportCopy } from '../copy/export-report.ts';
import type { SemesterStats } from './semester-stats.ts';

/**
 * 学期报表（CSV）：由学期统计生成，只有课时与考试，不含任何出勤信息。
 * 分段写在同一张表里，段与段之间空一行；开头带 BOM，Excel 直接打开不乱码。
 */
export function semesterReportCsv(stats: SemesterStats, semesterName: string): string {
  const rows: string[][] = [];
  rows.push([exportReportCopy.semester, semesterName]);
  if (stats.semester !== null) {
    rows.push([exportReportCopy.range, exportReportCopy.rangeValue(stats.semester.startDate, stats.semester.endDate)]);
    rows.push([exportReportCopy.totalWeeks, String(stats.semester.totalWeeks)]);
  }
  rows.push([exportReportCopy.pastLessons, String(stats.lessons.past)]);
  rows.push([exportReportCopy.upcomingLessons, String(stats.lessons.upcoming)]);
  rows.push([exportReportCopy.note, exportReportCopy.noteValue]);

  rows.push([]);
  rows.push([exportReportCopy.course, exportReportCopy.pastLessons, exportReportCopy.totalLessons, exportReportCopy.remainingLessons]);
  for (const course of stats.courses) {
    rows.push([course.name, String(course.done), String(course.total), String(course.total - course.done)]);
  }

  rows.push([]);
  rows.push([exportReportCopy.week, exportReportCopy.pastLessons, exportReportCopy.upcomingLessons]);
  for (const week of stats.weeks) {
    rows.push([exportReportCopy.weekValue(week.week), String(week.past), String(week.upcoming)]);
  }

  rows.push([]);
  rows.push([exportReportCopy.exam, exportReportCopy.date, exportReportCopy.status]);
  for (const exam of stats.exams.timeline) {
    rows.push([exam.title, exam.date ?? exportReportCopy.dateUnknown, exam.taken ? exportReportCopy.examTaken : exportReportCopy.examPending]);
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
