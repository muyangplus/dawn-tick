import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  builtinHolidays,
  createCourse,
  createEvent,
  createReschedule,
  createSchedule,
  createSemester,
  dayOfWeek,
  formatDate,
  readSettings,
  validatedStorage,
  weekOfDate,
  weekStart,
  writeSettings,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type Occurrence,
  type SemesterRow,
  type Storage,
} from '@dawn-tick/core';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import {
  buildGrid,
  buildTimelineData,
  loadAppData,
  loadHolidays,
  loadSemesterContext,
  weekDateOf,
} from '../src/data.ts';

const USER_ID = 'u1';
const TIME_ZONE = 'Asia/Shanghai';

async function open(name: string): Promise<Storage> {
  return validatedStorage(await openIndexedDbStorage(name));
}

test('首次启动：没有学期时返回空数据', async () => {
  const storage = await open('flow-empty');
  const data = await loadAppData(storage, DEFAULT_SETTINGS);
  assert.equal(data.semester, null);
  assert.deepEqual(data.todayLessons, []);
  assert.equal(data.nextLesson, undefined);
});

test('新建学期并加课后，周视图与今日视图都能看到', async () => {
  const storage = await open('flow-full');
  const today = formatDate(Date.now(), TIME_ZONE);
  const start = weekStart(today);
  const dow = dayOfWeek(today);
  const week = weekOfDate(today, start);

  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '测试学期',
    startDate: start,
    totalWeeks: 20,
    timeZone: TIME_ZONE,
  });
  const course = await createCourse(storage, {
    semesterId: String(semester['id']),
    name: '高等数学',
    shortName: '高数',
    location: '教三-201',
    color: '#4F8DFD',
  });
  await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: dow,
    periodStart: 1,
    periodEnd: 2,
    weeks: [week],
  });

  // 窗口要包含今天（周末也算），显式关掉跳过周末
  const data = await loadAppData(storage, { ...DEFAULT_SETTINGS, hideWeekends: false });
  assert.notEqual(data.semester, null);
  assert.equal(data.week, week);
  assert.equal(data.todayOfWeek, dow);

  // 网格按日期键：窗口从今天开始，今天的这一格必须能看到刚建的课
  const cells = data.grid.get(`${today}:1`) ?? [];
  assert.equal(cells.length, 1);
  assert.equal(cells[0]?.name, '高数');
  assert.equal(cells[0]?.room, '教三-201');

  assert.equal(data.todayLessons.length, 1);
  assert.equal(data.todayLessons[0]?.courseName, '高等数学');
  assert.ok(
    data.nextLesson === undefined || data.nextLesson.startAt > Date.now(),
    '下一节课要么不存在，要么在将来',
  );
});

test('设置可持久化并影响加载结果', async () => {
  const storage = await open('flow-settings');
  const saved = await writeSettings(storage, { viewDays: 7, theme: 'dark', themePreset: 'mono' });
  assert.equal(saved.viewDays, 7);
  assert.equal((await readSettings(storage)).themePreset, 'mono');

  await writeSettings(storage, { autoTimeZone: true });
  assert.equal((await readSettings(storage)).autoTimeZone, true);
});

test('软删除的课程不再出现在周视图', async () => {
  const storage = await open('flow-delete');
  const today = formatDate(Date.now(), TIME_ZONE);
  const start = weekStart(today);
  const dow = dayOfWeek(today);

  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '测试学期',
    startDate: start,
    timeZone: TIME_ZONE,
  });
  const course = await createCourse(storage, { semesterId: String(semester['id']), name: '大学物理' });
  await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: dow,
    periodStart: 3,
    periodEnd: 4,
    weeks: [weekOfDate(today, start)],
  });

  assert.equal((await loadAppData(storage, DEFAULT_SETTINGS)).todayLessons.length, 1);

  const { deleteCourse } = await import('@dawn-tick/core');
  await deleteCourse(storage, String(course['id']));
  assert.equal((await loadAppData(storage, DEFAULT_SETTINGS)).todayLessons.length, 0);
});

test('窗口起点：今天为第一天，关掉后从本周周一开头', async () => {
  const storage = await open('flow-window-start');
  const today = formatDate(Date.now(), TIME_ZONE);
  await createSemester(storage, {
    userId: USER_ID,
    name: '窗口学期',
    startDate: weekStart(today),
    totalWeeks: 20,
    timeZone: TIME_ZONE,
  });

  // 这条只测「今天为第一天 / 关掉后从周一开始」：显式关掉跳过周末，避免周末运行时起点被顺延
  const showWeekends = { ...DEFAULT_SETTINGS, hideWeekends: false };
  assert.equal((await loadAppData(storage, showWeekends)).windowStart, today);
  const fromMonday = await loadAppData(storage, { ...showWeekends, weekStartsToday: false });
  assert.equal(fromMonday.windowStart, weekStart(today));
  assert.equal(fromMonday.windowDates[0], weekStart(today));
});

test('不显示周末：列数按天数、日期里没有周六日', async () => {
  const storage = await open('flow-window-weekend');
  const today = formatDate(Date.now(), TIME_ZONE);
  await createSemester(storage, {
    userId: USER_ID,
    name: '周末学期',
    startDate: weekStart(today),
    totalWeeks: 20,
    timeZone: TIME_ZONE,
  });

  const data = await loadAppData(storage, { ...DEFAULT_SETTINGS, viewDays: 5, hideWeekends: true });
  assert.equal(data.windowDates.length, 5);
  assert.equal(
    data.windowDates.every((date) => dayOfWeek(date) <= 5),
    true,
    `出现了周末：${data.windowDates.join(',')}`,
  );
  assert.equal(data.windowStart, data.windowDates[0]);
});

test('默认窗口起点的纯函数：默认跳过周末，关掉后周末原样保留', async () => {
  const { defaultWindowStart, resolveWindowStart } = await import('../src/data.ts');
  const saturday = '2026-10-17';
  const sunday = '2026-10-18';
  // I-05 起默认「不显示周末」：起点落在周末时顺延到下一个工作日
  assert.equal(defaultWindowStart(saturday, DEFAULT_SETTINGS), '2026-10-19');
  assert.equal(
    defaultWindowStart(saturday, { ...DEFAULT_SETTINGS, hideWeekends: true }),
    '2026-10-19',
  );
  assert.equal(
    defaultWindowStart(saturday, { ...DEFAULT_SETTINGS, weekStartsToday: false }),
    '2026-10-12',
  );
  assert.equal(defaultWindowStart(sunday, { ...DEFAULT_SETTINGS, hideWeekends: true }), '2026-10-19');
  assert.equal(resolveWindowStart('2026-10-16', { ...DEFAULT_SETTINGS, hideWeekends: true }), '2026-10-16');
  // 关掉后周末保持原样，周末列才能出现
  assert.equal(defaultWindowStart(saturday, { ...DEFAULT_SETTINGS, hideWeekends: false }), saturday);
  assert.equal(resolveWindowStart(sunday, { ...DEFAULT_SETTINGS, hideWeekends: false }), sunday);
});

// ————————————————— 拆出来的四个纯函数 —————————————————

/** 只给纯函数用的学期行：其余字段它们不读 */
function semesterRow(startDate: string, totalWeeks = 20): SemesterRow {
  return {
    id: 'sem-1',
    user_id: USER_ID,
    name: '纯函数学期',
    start_date: startDate,
    total_weeks: totalWeeks,
    time_zone: TIME_ZONE,
    is_active: 1,
  } as unknown as SemesterRow;
}

test('loadSemesterContext：窗口起点、周次与列数都是纯计算', () => {
  const semester = semesterRow('2026-03-02');
  // 默认：今天为第一天，5 天窗口，今天落在第 1 周（这里显式关掉跳过周末，专测连续 5 天）
  const today = loadSemesterContext({
    semester,
    today: '2026-03-04',
    settings: { ...DEFAULT_SETTINGS, hideWeekends: false },
  });
  assert.equal(today.windowStart, '2026-03-04');
  assert.deepEqual(today.windowDates, ['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']);
  assert.deepEqual(today.weekOfDay, [1, 1, 1, 1, 1]);
  assert.equal(today.currentWeek, 1);
  assert.equal(today.viewWeek, 1);
  assert.equal(today.weekStartDate, '2026-03-02');
  assert.equal(today.windowSpansWeeks, false);

  // 本周周一开头：5 天正好一周，不跨周
  const monday = loadSemesterContext({
    semester,
    today: '2026-03-04',
    settings: { ...DEFAULT_SETTINGS, weekStartsToday: false },
  });
  assert.equal(monday.windowStart, '2026-03-02');
  assert.deepEqual(monday.windowDates, ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']);

  // 指定周次：窗口落在那一周的周一，周次跟着走
  const byWeek = loadSemesterContext({
    semester,
    today: '2026-03-04',
    settings: DEFAULT_SETTINGS,
    options: { viewWeek: 3 },
  });
  assert.equal(byWeek.windowStart, weekDateOf(semester, 3, 1));
  assert.equal(byWeek.viewWeek, 3);
  assert.deepEqual(byWeek.weekOfDay, [3, 3, 3, 3, 3]);

  // 跨周窗口：7 天从周三开始时覆盖两周（不跳过周末才能连续 7 天）
  const spanning = loadSemesterContext({
    semester,
    today: '2026-03-04',
    settings: { ...DEFAULT_SETTINGS, viewDays: 7, hideWeekends: false },
  });
  assert.equal(spanning.windowSpansWeeks, true);
  assert.deepEqual(spanning.weekOfDay, [1, 1, 1, 1, 1, 2, 2]);
  assert.equal(spanning.viewWeek, 1);

  // 不显示周末：列数仍是设置的天数，但日期里没有周六日
  const weekdayOnly = loadSemesterContext({
    semester,
    today: '2026-03-02',
    settings: { ...DEFAULT_SETTINGS, hideWeekends: true },
  });
  assert.equal(weekdayOnly.windowDates.length, 5);
  assert.equal(
    weekdayOnly.windowDates.every((date) => dayOfWeek(date) <= 5),
    true,
    `出现了周末：${weekdayOnly.windowDates.join(',')}`,
  );

  // 显式起点夹进学期：早于学期停在边界，晚于学期停在最后一个窗口起点
  assert.equal(
    loadSemesterContext({ semester, today: '2026-03-04', settings: DEFAULT_SETTINGS, options: { windowStart: '2026-01-01' } })
      .windowStart,
    '2026-03-02',
  );
  assert.equal(
    loadSemesterContext({ semester, today: '2026-03-04', settings: DEFAULT_SETTINGS, options: { windowStart: '2027-01-01' } })
      .windowStart,
    '2026-07-13',
  );
});

test('loadHolidays：内置节假日、手工假日与调休上班日合并', () => {
  const builtin = builtinHolidays()[0];
  assert.ok(builtin !== undefined);
  const empty = loadHolidays([]);
  assert.equal(empty.holidayLabels.has(builtin), true);
  assert.equal(empty.holidayDates.has(builtin), true);
  assert.equal(empty.workdays.includes(builtin), false);

  const holiday = {
    type: 'holiday',
    title: '校庆',
    on_date: '2026-05-18',
    deleted_at: null,
    semester_id: 'sem-1',
  } as unknown as EventRow;
  const workday = {
    type: 'workday',
    title: '非假日',
    on_date: builtin,
    deleted_at: null,
    semester_id: 'sem-1',
  } as unknown as EventRow;
  const merged = loadHolidays([holiday, workday]);
  assert.equal(merged.holidayLabels.get('2026-05-18'), '校庆');
  assert.equal(merged.holidayDates.has('2026-05-18'), true);
  // 手工「非假日」扣掉内置假日，同时进调休上班日
  assert.equal(merged.holidayLabels.has(builtin), false);
  assert.equal(merged.holidayDates.has(builtin), false);
  assert.equal(merged.workdays.includes(builtin), true);
  // 调休上班日按升序
  assert.deepEqual(merged.workdays, [...merged.workdays].sort());
});

test('buildGrid：主课次、停课、调课落点、虚线与实验各就各位', async () => {
  const storage = await open('pure-grid');
  const semester = (await createSemester(storage, {
    userId: USER_ID,
    name: '网格学期',
    startDate: '2026-03-02',
    totalWeeks: 20,
    timeZone: TIME_ZONE,
  })) as unknown as SemesterRow;
  const math = await createCourse(storage, {
    semesterId: semester.id,
    name: '高等数学',
    shortName: '高数',
    location: '教三-201',
  });
  const english = await createCourse(storage, { semesterId: semester.id, name: '大学英语', shortName: '英语' });
  const monday = weekDateOf(semester, 1, 1);
  // 高数只排第 1 周：第 2 周那一列就是虚线课
  await createSchedule(storage, {
    courseId: String(math['id']),
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: [1],
  });
  // 英语每周二 1–2 节：用来验证停课与调课
  const englishSchedule = await createSchedule(storage, {
    courseId: String(english['id']),
    dayOfWeek: 2,
    periodStart: 1,
    periodEnd: 2,
    weeks: Array.from({ length: 20 }, (_, index) => index + 1),
  });
  const englishScheduleId = String(englishSchedule['id']);
  await createReschedule(storage, {
    userId: USER_ID,
    semesterId: semester.id,
    refScheduleId: englishScheduleId,
    onDate: weekDateOf(semester, 3, 2),
    action: 'cancel',
  });
  await createReschedule(storage, {
    userId: USER_ID,
    semesterId: semester.id,
    refScheduleId: englishScheduleId,
    onDate: weekDateOf(semester, 4, 2),
    action: 'move',
    newDate: weekDateOf(semester, 4, 4),
    newPeriodStart: 3,
    newPeriodEnd: 4,
  });
  // 一条实验：直接给节次与日期，进网格且带 eventId
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: semester.id,
    type: 'lab',
    title: '物理实验',
    onDate: monday,
    periodStart: 5,
    periodEnd: 6,
    showInTimetable: true,
  });

  const rows = {
    courses: await storage.collection<CourseRow>('courses').getAll(),
    schedules: await storage.collection<CourseScheduleRow>('course_schedules').getAll(),
    events: await storage.collection<EventRow>('events').getAll(),
  };
  const slots = await storage
    .collection<{ period_no: number; start_time: string; end_time: string }>('time_slots')
    .getAll();
  const events = rows.events.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const holidays = loadHolidays(events);
  const gridOf = (windowDates: string[], weekOfDay: number[]): ReturnType<typeof buildGrid> =>
    buildGrid({
      semester,
      slots,
      courses: rows.courses,
      schedules: rows.schedules,
      events: rows.events,
      windowDates,
      weekOfDay,
      holidays,
      timeZone: TIME_ZONE,
    });

  // 第 1 周周一：主课次落到 1 节，带课程短名与教室
  const week1 = gridOf([monday], [1]);
  const cell = week1.grid.get(`${monday}:1`)?.find((item) => item.courseId === String(math['id']));
  assert.ok(cell !== undefined);
  assert.equal(cell.name, '高数');
  assert.equal(cell.room, '教三-201');
  assert.equal(cell.inWeek, true);
  assert.equal(cell.holiday, false);
  assert.equal(cell.cancelled, false);
  // 实验格：按节次落到 5、带 eventId 与实验角标
  const labCell = week1.grid.get(`${monday}:5`)?.find((item) => item.eventId !== undefined);
  assert.ok(labCell !== undefined);
  assert.equal(labCell.lab, true);
  assert.equal(labCell.eventLabel, '实验');
  assert.equal(week1.labs.length, 1);

  // 第 2 周：高数这一周不上，进网格但是虚线（inWeek = false）
  const week2Date = weekDateOf(semester, 2, 1);
  const week2 = gridOf([week2Date], [2]);
  assert.equal(week2.grid.get(`${week2Date}:1`)?.find((item) => item.courseId === String(math['id']))?.inWeek, false);

  // 第 3 周：英语那节课停课
  const week3Date = weekDateOf(semester, 3, 2);
  const week3 = gridOf([week3Date], [3]);
  assert.equal(week3.grid.get(`${week3Date}:1`)?.find((item) => item.scheduleId === englishScheduleId)?.cancelled, true);

  // 第 4 周：原位置标「已调课」，落点格标「调课」
  const week4Tuesday = weekDateOf(semester, 4, 2);
  const week4Thursday = weekDateOf(semester, 4, 4);
  const week4 = gridOf([week4Tuesday, week4Thursday], [4, 4]);
  assert.equal(week4.grid.get(`${week4Tuesday}:1`)?.find((item) => item.scheduleId === englishScheduleId)?.movedOut, true);
  const movedIn = week4.grid.get(`${week4Thursday}:3`)?.find((item) => item.movedIn === true);
  assert.ok(movedIn !== undefined);
  assert.equal(movedIn.periodEnd, 4);
});

test('buildTimelineData：按日期归档并给出正在上 / 下一节', () => {
  const now = Date.parse('2026-03-02T10:00:00+08:00');
  const base = {
    semesterId: 'sem-1',
    scheduleId: 'sch-1',
    courseId: 'course-1',
    courseName: '高等数学',
    shortName: '高数',
    color: '#4F8DFD',
    periodStart: 1,
    periodEnd: 2,
    startAt: Date.parse('2026-03-02T08:00:00+08:00'),
    endAt: Date.parse('2026-03-02T09:40:00+08:00'),
    room: null,
    cancelled: false,
  };
  const today: Occurrence = { ...base, date: '2026-03-02' };
  const running: Occurrence = {
    ...base,
    date: '2026-03-02',
    scheduleId: 'sch-2',
    startAt: Date.parse('2026-03-02T09:50:00+08:00'),
    endAt: Date.parse('2026-03-02T11:30:00+08:00'),
  };
  const tomorrow: Occurrence = {
    ...base,
    date: '2026-03-03',
    scheduleId: 'sch-3',
    startAt: Date.parse('2026-03-03T08:00:00+08:00'),
    endAt: Date.parse('2026-03-03T09:40:00+08:00'),
  };
  const cancelled: Occurrence = { ...base, date: '2026-03-02', scheduleId: 'sch-4', cancelled: true };

  const data = buildTimelineData({ occurrences: [today, running, tomorrow, cancelled], today: '2026-03-02', now });
  // 停课的课次不进时间线
  assert.deepEqual((data.lessonsByDate.get('2026-03-02') ?? []).map((item) => item.scheduleId), ['sch-1', 'sch-2']);
  assert.equal(data.todayLessons.length, 2);
  assert.equal(data.tomorrowLessons.length, 1);
  assert.equal(data.currentLesson?.scheduleId, 'sch-2');
  assert.equal(data.nextLesson?.scheduleId, 'sch-3');

  const empty = buildTimelineData({ occurrences: [], today: '2026-03-02', now });
  assert.equal(empty.todayLessons.length, 0);
  assert.equal(empty.currentLesson, undefined);
  assert.equal(empty.nextLesson, undefined);
});
