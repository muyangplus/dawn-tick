// 周视图网格：把排课、调课、假期与日程落到「日期:节次」格子里。
import {
  DEFAULT_COURSE_COLOR,
  dayOfWeek,
  EXAM_COLOR,
  formatTime,
  hasWeek,
  LAB_COLOR,
  periodAtClock,
  plusMinutesText,
  weekOfDate,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type SemesterRow,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { type HolidayContext, weeksOf } from './context.ts';
import { type LessonCell } from './types.ts';
import { formatCopy } from '../copy/format.ts';

/** 课表里条目的角标文案。 */
const EVENT_LABEL: Record<string, string> = formatCopy.eventBadge;

/** 一条调课的落点 */
interface MoveIn {
  scheduleId: string;
  newDate: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  room: string | null;
}

/** 网格输入：都是已读出的行，函数本身不读 storage。 */
export interface GridInput {
  semester: SemesterRow;
  slots: readonly TimeSlotRow[];
  courses: readonly CourseRow[];
  schedules: readonly CourseScheduleRow[];
  events: readonly EventRow[];
  windowDates: readonly string[];
  weekOfDay: readonly number[];
  holidays: HolidayContext;
  timeZone: string;
}

export interface GridResult {
  /** 按「日期:节次」建键的课表格 */
  grid: Map<string, LessonCell[]>;
  /** 实验条目（type = 'lab'）：进课表网格与时间线 */
  labs: EventRow[];
}

/**
 * 铺课表网格：主课次按列日期所属周次判定，调课落点画到目标格，
 * 实验按周次位图铺，窗口外的周次按设置虚线显示。
 */
export function buildGrid(input: GridInput): GridResult {
  const { semester, slots, schedules, events, windowDates, weekOfDay, holidays } = input;
  const slotByPeriod = new Map(slots.map((slot) => [slot.period_no, slot]));
  const activeCourses = input.courses.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const courseById = new Map(activeCourses.map((row) => [row.id, row]));
  const semesterEvents = events.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const holidayDates = holidays.holidayDates;
  // 停课与调课都按「排课 + 那天」记录：停课的格子灰显，调课的格子标出原位置与落点
  const cancelledKeys = new Set<string>();
  const movedOutKeys = new Set<string>();
  const movedIn: MoveIn[] = [];
  for (const row of semesterEvents) {
    if (row.type !== 'reschedule' || row.ref_schedule_id === null) continue;
    const date = row.on_date;
    if (typeof date !== 'string') continue;
    if (row.action === 'cancel') {
      cancelledKeys.add(`${row.ref_schedule_id}|${date}`);
      continue;
    }
    if (row.action !== 'move' || row.new_date === null) continue;
    movedOutKeys.add(`${row.ref_schedule_id}|${date}`);
    movedIn.push({
      scheduleId: row.ref_schedule_id,
      newDate: row.new_date,
      dayOfWeek: row.as_day_of_week ?? dayOfWeek(row.new_date),
      periodStart: row.new_period_start ?? 1,
      periodEnd: row.new_period_end ?? row.new_period_start ?? 1,
      room: row.new_room,
    });
  }
  const grid = new Map<string, LessonCell[]>();
  const cellOf = (cell: {
    scheduleId: string;
    courseId: string;
    fallbackName: string;
    color: string;
    room: string | null;
    periodStart: number;
    periodEnd: number;
    day: number;
    date: string;
    inWeek: boolean;
    movedIn?: boolean;
    customStart?: string | null;
    customEnd?: string | null;
  }): LessonCell => {
    const course = courseById.get(cell.courseId);
    const date = cell.date;
    return {
      scheduleId: cell.scheduleId,
      courseId: cell.courseId,
      name: course?.short_name ?? cell.fallbackName,
      teacher: course?.teacher ?? null,
      room: cell.room ?? course?.location ?? null,
      color: cell.color,
      dayOfWeek: cell.day,
      date,
      periodStart: cell.periodStart,
      periodEnd: cell.periodEnd,
      startTime: slotByPeriod.get(cell.periodStart)?.start_time ?? '',
      endTime: slotByPeriod.get(cell.periodEnd)?.end_time ?? '',
      inWeek: cell.inWeek,
      holiday: holidayDates.has(date),
      cancelled: cell.inWeek && cancelledKeys.has(`${cell.scheduleId}|${date}`),
      movedOut: cell.inWeek && movedOutKeys.has(`${cell.scheduleId}|${date}`),
      movedIn: cell.movedIn === true,
      lab: false,
      customStart: cell.customStart ?? null,
      customEnd: cell.customEnd ?? null,
    };
  };

  /** 各排课的自定义时间：按 schedule_id 查，用于按真实时间定位 */
  const scheduleCustomById = new Map(
    schedules
      .filter((row) => row.start_time !== null && row.end_time !== null)
      .map((row) => [row.id, { start: row.start_time as string, end: row.end_time as string }]),
  );
  const customOf = (scheduleId: string): { start: string | null; end: string | null } => {
    const custom = scheduleCustomById.get(scheduleId);
    return { start: custom?.start ?? null, end: custom?.end ?? null };
  };

  // 主课次：逐列按该列日期所属的周次判定，窗口跨两周时两周的课都进网格
  const activeIds = new Set(activeCourses.map((row) => row.id));
  const scheduleById = new Map(schedules.map((row) => [row.id, row]));
  for (let index = 0; index < windowDates.length; index += 1) {
    const date = windowDates[index] as string;
    const week = weekOfDay[index] as number;
    const day = dayOfWeek(date);
    for (const schedule of schedules) {
      if (schedule.deleted_at !== null || !activeIds.has(schedule.course_id)) continue;
      if (schedule.day_of_week !== day || !hasWeek(schedule.weeks_mask, week)) continue;
      const course = courseById.get(schedule.course_id);
      if (course === undefined) continue;
      const custom = customOf(schedule.id);
      const key = `${date}:${schedule.period_start}`;
      const list = grid.get(key) ?? [];
      list.push(
        cellOf({
          scheduleId: schedule.id,
          courseId: schedule.course_id,
          fallbackName: course.name,
          color: course.color,
          room: schedule.room,
          periodStart: schedule.period_start,
          periodEnd: schedule.period_end,
          day,
          date,
          inWeek: true,
          customStart: custom.start,
          customEnd: custom.end,
        }),
      );
      grid.set(key, list);
    }
  }

  // 调课的落点：目标日期落在窗口里时，把课次画到落点格上并标「调课」
  for (const move of movedIn) {
    if (!windowDates.includes(move.newDate)) continue;
    const schedule = scheduleById.get(move.scheduleId);
    if (schedule === undefined || schedule.deleted_at !== null || !activeIds.has(schedule.course_id)) continue;
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    const key = `${move.newDate}:${move.periodStart}`;
    const list = grid.get(key) ?? [];
    if (list.some((cell) => cell.scheduleId === move.scheduleId && cell.movedIn)) continue;
    list.push(
      cellOf({
        scheduleId: move.scheduleId,
        courseId: schedule.course_id,
        fallbackName: course.name,
        color: course.color,
        room: move.room ?? schedule.room,
        periodStart: move.periodStart,
        periodEnd: move.periodEnd,
        day: move.dayOfWeek,
        date: move.newDate,
        inWeek: true,
        movedIn: true,
      }),
    );
    grid.set(key, list);
  }

  // 实验按周次位图铺网格，无位图只落 on_date 那周。
  // 实验默认显示，日程/作业/考试看「显示在课表上」开关。
  const labs = semesterEvents
    .filter((row) => row.show_in_timetable === 1 && row.on_date !== null)
    .sort((left, right) => (left.on_date ?? '').localeCompare(right.on_date ?? ''));
  for (const entry of labs) {
    const entryDate = entry.on_date;
    if (entryDate === null) continue;
    // 节次：实验直接存了节次；日程/作业/考试按开始时间落到重叠的节次上
    const clockStart =
      entry.start_time ?? (entry.start_at === null ? null : formatTime(entry.start_at, input.timeZone));
    const clockEnd =
      entry.end_time ??
      (entry.end_at !== null && entry.end_at !== undefined
        ? formatTime(entry.end_at, input.timeZone)
        : clockStart === null
          ? null
          : plusMinutesText(clockStart, 45));
    const periodStart = entry.period_start ?? periodAtClock(slots, clockStart);
    if (periodStart === null) continue;
    const periodEnd = Math.max(periodStart, entry.period_end ?? periodAtClock(slots, clockEnd) ?? periodStart);
    const weekday = entry.as_day_of_week ?? dayOfWeek(entryDate);
    // 条目所在周次；有位图时按位图在各周的同一天再铺一次
    const entryWeeks = weeksOf(entry.weeks_mask, semester.total_weeks, weekOfDate(entryDate, semester.start_date));
    for (let index = 0; index < windowDates.length; index += 1) {
      const date = windowDates[index] as string;
      if (dayOfWeek(date) !== weekday) continue;
      if (!entryWeeks.includes(weekOfDay[index] as number)) continue;
      const key = `${date}:${periodStart}`;
      const list = grid.get(key) ?? [];
      if (list.some((cell) => cell.eventId === entry.id)) continue;
      list.push({
        scheduleId: entry.id,
        courseId: entry.subject ?? '',
        name: entry.title,
        teacher: null,
        room: entry.location,
        color: entry.type === 'lab' ? (entry.nature === 'course' ? DEFAULT_COURSE_COLOR : LAB_COLOR) : EXAM_COLOR,
        dayOfWeek: weekday,
        date,
        periodStart,
        periodEnd,
        startTime: slotByPeriod.get(periodStart)?.start_time ?? '',
        endTime: slotByPeriod.get(periodEnd)?.end_time ?? '',
        inWeek: true,
        holiday: holidayDates.has(date),
        cancelled: false,
        movedOut: false,
        movedIn: false,
        lab: true,
        eventLabel: EVENT_LABEL[entry.type] ?? formatCopy.eventBadgeFallback,
        courseLabel: entry.subject === null ? null : courseById.get(entry.subject)?.name ?? null,
        eventId: entry.id,
        customStart: clockStart,
        customEnd: clockEnd,
      });
      grid.set(key, list);
    }
  }

  // 窗口外的周次：课程仍在课表里，但那一周不上，按设置虚线显示
  for (const schedule of schedules) {
    if (schedule.deleted_at !== null || !activeIds.has(schedule.course_id)) continue;
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    for (let index = 0; index < windowDates.length; index += 1) {
      const date = windowDates[index] as string;
      if (dayOfWeek(date) !== schedule.day_of_week) continue;
      if (hasWeek(schedule.weeks_mask, weekOfDay[index] as number)) continue;
      const key = `${date}:${schedule.period_start}`;
      const list = grid.get(key) ?? [];
      if (list.some((cell) => cell.scheduleId === schedule.id)) continue;
      list.push(
        cellOf({
          scheduleId: schedule.id,
          courseId: schedule.course_id,
          fallbackName: course.name,
          color: course.color,
          room: schedule.room,
          periodStart: schedule.period_start,
          periodEnd: schedule.period_end,
          day: schedule.day_of_week,
          date,
          inWeek: false,
        }),
      );
      grid.set(key, list);
    }
  }

  return { grid, labs };
}
