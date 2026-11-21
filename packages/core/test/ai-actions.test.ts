import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_DAY_KIND_MAX_DAYS,
  AI_EVENT_LIST_LIMIT,
  AI_QUERY_ACTIONS,
  AI_QUERY_MAX_DAYS,
  AI_TIMETABLE_ACTIONS,
  AiArgError,
  findAction,
  type AiArgs,
  type AiCoreContext,
} from '../src/ai/index.ts';
import { builtinHolidayName, builtinWorkdayName } from '../src/holidays.ts';
import { addDays } from '../src/time.ts';
import { describeWeeks, weeksToMask } from '../src/weeks.ts';
import type { CourseRow, CourseScheduleRow, EventRow, ReminderRow, SemesterRow, TimeSlotRow } from '../src/types.ts';
import type { Storage } from '../src/storage.ts';
import {
  NOW,
  SEMESTER_ID,
  createStorage,
  courseRow,
  eventRow,
  scheduleRow,
  seedStorage,
  semesterRow,
  timeSlotRow,
  userRow,
  weekRange,
} from './kit/index.ts';

const ACTIONS = [...AI_QUERY_ACTIONS, ...AI_TIMETABLE_ACTIONS];

function contextOf(storage: Storage, timeZone = 'Asia/Shanghai'): AiCoreContext {
  return { storage, userId: 'u1', now: () => NOW, timeZone };
}

/** 样例数据：sem-1 自 2026-09-07 起 20 周、6 节；c-1 周一 1-2 节 1-16 周，c-2 周三 3-4 节双周，c-3 周五 5-6 节 1,3,5,7 周。 */
async function seeded(timeZone?: string): Promise<AiCoreContext> {
  const storage = createStorage();
  await seedStorage(storage);
  return contextOf(storage, timeZone);
}

/** 另一个用户 u2 及其当前学期 sem-u2。 */
async function addOtherUser(storage: Storage): Promise<void> {
  await storage.collection('users').put(userRow({ id: 'u2', nickname: '别人' }));
  await storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-u2', user_id: 'u2', name: '别人的学期' }));
}

function actionOf(name: string) {
  const action = findAction(ACTIONS, name);
  assert.ok(action !== undefined, `未登记动作 ${name}`);
  return action;
}

/** 按助手的顺序跑一遍：parse → preview → run。 */
async function call(context: AiCoreContext, name: string, args: AiArgs = {}): Promise<{ preview: string; result: unknown }> {
  const action = actionOf(name);
  const params = await action.parse(args, context);
  const preview = await action.preview(params, context);
  const result = await action.run(params, context);
  return { preview, result };
}

async function previewOf(context: AiCoreContext, name: string, args: AiArgs = {}): Promise<string> {
  const action = actionOf(name);
  return action.preview(await action.parse(args, context), context);
}

async function rejectsArg(context: AiCoreContext, name: string, args: AiArgs, message: RegExp | string): Promise<void> {
  const action = actionOf(name);
  await assert.rejects(
    async () => action.parse(args, context),
    (error: unknown) => {
      assert.ok(error instanceof AiArgError, `应抛 AiArgError：${String(error)}`);
      if (typeof message === 'string') assert.equal(error.message, message);
      else assert.match(error.message, message);
      return true;
    },
  );
}

async function row<T>(storage: Storage, store: Parameters<Storage['collection']>[0], id: string): Promise<T> {
  const found = await storage.collection<T>(store).get(id);
  assert.ok(found !== undefined, `${store} 缺少 ${id}`);
  return found;
}

async function alive<T extends { deleted_at: number | null }>(storage: Storage, store: Parameters<Storage['collection']>[0]): Promise<T[]> {
  return (await storage.collection<T>(store).getAll()).filter((item) => item.deleted_at === null);
}

function reminderRow(overrides: Partial<ReminderRow> & Pick<ReminderRow, 'id' | 'target_id'>): ReminderRow {
  return {
    user_id: 'u1',
    target_type: 'course',
    advance_minutes: 10,
    enabled: 1,
    skip_holidays: 1,
    sound: 1,
    vibrate: 1,
    dnd: 0,
    snooze_minutes: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    rev: 0,
    dirty: 0,
    ...overrides,
  };
}

// ---- 登记与风险等级 ----

test('动作名唯一，查询类为 query、删除学期为 danger、其余写入为 write', () => {
  const names = ACTIONS.map((action) => action.name);
  assert.equal(new Set(names).size, names.length);
  for (const action of AI_QUERY_ACTIONS) assert.equal(action.risk, 'query', action.name);
  for (const action of AI_TIMETABLE_ACTIONS) {
    assert.equal(action.risk, action.name === 'delete_semester' ? 'danger' : 'write', action.name);
  }
  assert.equal(findAction(ACTIONS, 'no_such_action'), undefined);
});

// ---- 学期参数 ----

test('semesterOf：不给学期 id 时用当前学期', async () => {
  const context = await seeded();
  const { result } = await call(context, 'list_periods');
  const periods = result as Array<Record<string, unknown>>;
  assert.equal(periods.length, 6);
  assert.deepEqual(periods[0], { period: 1, start: '08:00', end: '08:45', label: null });
});

test('semesterOf：没有任何学期时提示先新建', async () => {
  const context = contextOf(createStorage());
  await rejectsArg(context, 'list_courses', {}, /^还没有学期/);
  await rejectsArg(context, 'get_lessons', { from: '2026-09-07' }, /^还没有学期/);
});

test('semesterOf：别人的学期、已删除的学期都找不到', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  await rejectsArg(context, 'list_periods', { semesterId: 'sem-u2' }, '找不到学期 sem-u2');
  await rejectsArg(context, 'list_courses', { semesterId: 'sem-none' }, '找不到学期 sem-none');
  await context.storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-gone', is_active: 0, deleted_at: NOW }));
  await rejectsArg(context, 'list_courses', { semesterId: 'sem-gone' }, '找不到学期 sem-gone');
  // 空串按未填处理
  const { result } = await call(context, 'list_periods', { semesterId: '' });
  assert.equal((result as unknown[]).length, 6);
});

// ---- list_semesters ----

test('list_semesters 只列本人的学期并按开学日期排序', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  await context.storage
    .collection<SemesterRow>('semesters')
    .put(semesterRow({ id: 'sem-0', name: '上学期', start_date: '2026-02-23', total_weeks: 18, is_active: 0 }));
  const { result } = await call(context, 'list_semesters');
  assert.deepEqual(result, [
    { id: 'sem-0', name: '上学期', startDate: '2026-02-23', totalWeeks: 18, timeZone: 'Asia/Shanghai', active: false },
    { id: SEMESTER_ID, name: '2026-2027 第一学期', startDate: '2026-09-07', totalWeeks: 20, timeZone: 'Asia/Shanghai', active: true },
  ]);
});

// ---- list_courses ----

test('list_courses：时段按星期与节次排序，带周次文本与周次列表', async () => {
  const context = await seeded();
  const schedules = context.storage.collection<CourseScheduleRow>('course_schedules');
  await schedules.put(scheduleRow('s-0', 'c-1', [1, 2, 3], { day_of_week: 3, period_start: 3, period_end: 4, room: '教一-101' }));
  await schedules.put(scheduleRow('s-9', 'c-1', weekRange(1, 20), { day_of_week: 1, period_start: 5, period_end: 6 }));
  await schedules.put(scheduleRow('s-dead', 'c-1', [1], { day_of_week: 1, period_start: 3, period_end: 3, deleted_at: NOW }));
  const { result } = await call(context, 'list_courses');
  const courses = result as Array<Record<string, unknown>>;
  assert.deepEqual(courses.map((course) => course['id']).sort(), ['c-1', 'c-2', 'c-3']);
  const math = courses.find((course) => course['id'] === 'c-1');
  assert.ok(math !== undefined);
  assert.equal(math['name'], '高等数学');
  assert.equal(math['shortName'], '高数');
  assert.equal(math['teacher'], '张老师');
  assert.equal(math['credits'], 5);
  const items = math['schedules'] as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((item) => item['id']), ['s-1', 's-9', 's-0']);
  assert.equal(items[0]?.['weeks'], '1-16周');
  assert.deepEqual(items[0]?.['weekList'], weekRange(1, 16));
  assert.equal(items[1]?.['weeks'], '1-20周');
  assert.equal(items[2]?.['room'], '教一-101');
  assert.deepEqual(items[2]?.['weekList'], [1, 2, 3]);
  const physics = courses.find((course) => course['id'] === 'c-2');
  const physicsSchedules = physics?.['schedules'] as Array<Record<string, unknown>>;
  assert.equal(physicsSchedules[0]?.['weeks'], '2-16周(双)');
  assert.deepEqual(physicsSchedules[0]?.['weekList'], weekRange(2, 16, 2));
  assert.deepEqual(
    { dayOfWeek: physicsSchedules[0]?.['dayOfWeek'], periodStart: physicsSchedules[0]?.['periodStart'], periodEnd: physicsSchedules[0]?.['periodEnd'] },
    { dayOfWeek: 3, periodStart: 3, periodEnd: 4 },
  );
});

// ---- get_lessons ----

/** 第 2 周（2026-09-14 至 09-20）：周一高数、周三大物；周五英语只在单周。 */
async function lessonFixture(timeZone?: string): Promise<AiCoreContext> {
  const context = await seeded(timeZone);
  const events = context.storage.collection<EventRow>('events');
  // 周三设为手动假日：大物不上
  await events.put(eventRow('h-1', 'holiday', { on_date: '2026-09-16', title: '运动会' }));
  // 周一高数停课：仍返回，标 cancelled
  await events.put(eventRow('r-cancel', 'reschedule', { ref_schedule_id: 's-1', on_date: '2026-09-14', action: 'cancel' }));
  // 第 1 周的高数调到 09-15：只有调到的日期在范围内；调课记录可以不带学期
  await events.put(
    eventRow('r-move', 'reschedule', {
      semester_id: null,
      ref_schedule_id: 's-1',
      on_date: '2026-09-07',
      action: 'move',
      new_date: '2026-09-15',
      new_period_start: 3,
      new_period_end: 4,
      new_room: '教五-301',
    }),
  );
  // 范围外的调课不返回
  await events.put(eventRow('r-far', 'reschedule', { ref_schedule_id: 's-1', on_date: '2026-10-12', action: 'cancel' }));
  // 已删除的假日不返回
  await events.put(eventRow('h-dead', 'holiday', { on_date: '2026-09-18', deleted_at: NOW }));
  return context;
}

test('get_lessons：含停课的课、假日去掉当天的课并列在 dayKinds', async () => {
  const context = await lessonFixture();
  const { result } = await call(context, 'get_lessons', { from: '2026-09-14', to: '2026-09-20' });
  const value = result as { semester: string; lessons: Array<Record<string, unknown>>; dayKinds: unknown[]; adjustments: Array<Record<string, unknown>> };
  assert.equal(value.semester, '2026-2027 第一学期');
  assert.deepEqual(
    value.lessons.map((item) => [item['date'], item['scheduleId'], item['cancelled']]),
    [
      ['2026-09-14', 's-1', true],
      ['2026-09-15', 's-1', false],
    ],
  );
  assert.deepEqual(value.lessons[0], {
    date: '2026-09-14',
    week: 2,
    dayOfWeek: 1,
    courseId: 'c-1',
    courseName: '高等数学',
    scheduleId: 's-1',
    periodStart: 1,
    periodEnd: 2,
    start: '08:00',
    end: '09:40',
    room: '教三-201',
    cancelled: true,
  });
  assert.deepEqual(
    { start: value.lessons[1]?.['start'], end: value.lessons[1]?.['end'], room: value.lessons[1]?.['room'], periodStart: value.lessons[1]?.['periodStart'] },
    { start: '10:00', end: '11:40', room: '教五-301', periodStart: 3 },
  );
  // 09-20 是内置的国庆调休上班日，没有记录也列出
  assert.deepEqual(value.dayKinds, [
    { id: 'h-1', date: '2026-09-16', kind: 'holiday', title: '运动会', source: 'manual' },
    { id: null, date: '2026-09-20', kind: 'workday', title: builtinWorkdayName('2026-09-20'), source: 'builtin' },
  ]);
  assert.deepEqual(
    value.adjustments.map((item) => item['id']).sort(),
    ['r-cancel', 'r-move'],
  );
  const moved = value.adjustments.find((item) => item['id'] === 'r-move');
  assert.deepEqual(moved, {
    id: 'r-move',
    scheduleId: 's-1',
    date: '2026-09-07',
    action: 'move',
    newDate: '2026-09-15',
    newPeriodStart: 3,
    newPeriodEnd: 4,
    newRoom: '教五-301',
  });
});

test('get_lessons：时刻按学期时区换算，与显示时区无关', async () => {
  for (const timeZone of ['America/New_York', 'Asia/Kolkata', 'Asia/Shanghai']) {
    const context = await lessonFixture(timeZone);
    const { result } = await call(context, 'get_lessons', { from: '2026-09-14' });
    const lessons = (result as { lessons: Array<Record<string, unknown>> }).lessons;
    assert.equal(lessons.length, 1, timeZone);
    assert.equal(lessons[0]?.['start'], '08:00', timeZone);
    assert.equal(lessons[0]?.['end'], '09:40', timeZone);
  }
  const context = await seeded();
  await context.storage
    .collection<SemesterRow>('semesters')
    .put(semesterRow({ time_zone: 'Europe/London' }));
  const { result } = await call(context, 'get_lessons', { from: '2026-09-14' });
  const lessons = (result as { lessons: Array<Record<string, unknown>> }).lessons;
  assert.equal(lessons[0]?.['start'], '08:00');
});

test('get_lessons：内置法定假日去掉当天的课并列在 dayKinds，有记录的日期以记录为准，按日期排序', async () => {
  const context = await seeded();
  // 09-26 有学校导入的记录：不再重复列内置项
  await context.storage.collection<EventRow>('events').put(eventRow('h-school', 'holiday', { on_date: '2026-09-26', title: '校历假期', source: 'from_school' }));
  await context.storage.collection<EventRow>('events').put(eventRow('h-early', 'holiday', { on_date: '2026-09-22', title: '运动会' }));
  const { result } = await call(context, 'get_lessons', { from: '2026-09-21', to: '2026-09-27' });
  const value = result as { lessons: Array<Record<string, unknown>>; dayKinds: unknown[] };
  // 第 3 周周五 09-25 的英语因中秋放假不上
  assert.ok(!value.lessons.some((item) => item['date'] === '2026-09-25'));
  assert.deepEqual(value.dayKinds, [
    { id: 'h-early', date: '2026-09-22', kind: 'holiday', title: '运动会', source: 'manual' },
    { id: null, date: '2026-09-25', kind: 'holiday', title: builtinHolidayName('2026-09-25'), source: 'builtin' },
    { id: 'h-school', date: '2026-09-26', kind: 'holiday', title: '校历假期', source: 'from_school' },
    { id: null, date: '2026-09-27', kind: 'holiday', title: builtinHolidayName('2026-09-27'), source: 'builtin' },
  ]);
  assert.equal(builtinHolidayName('2026-09-25'), '中秋节');
});

test('get_lessons：其他学期排课的调课记录不出现', async () => {
  const context = await lessonFixture();
  const storage = context.storage;
  await storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-b', name: '另一学期', is_active: 0 }));
  await storage.collection<CourseRow>('courses').put(courseRow('c-b', '别的课', { semester_id: 'sem-b' }));
  await storage.collection<CourseScheduleRow>('course_schedules').put(scheduleRow('s-b', 'c-b', [1, 2]));
  await storage.collection<EventRow>('events').put(
    eventRow('r-b', 'reschedule', { semester_id: null, ref_schedule_id: 's-b', on_date: '2026-09-14', action: 'cancel' }),
  );
  await storage.collection<EventRow>('events').put(eventRow('h-b', 'holiday', { semester_id: 'sem-b', on_date: '2026-09-15' }));
  const { result } = await call(context, 'get_lessons', { from: '2026-09-14', to: '2026-09-20' });
  const value = result as { dayKinds: Array<Record<string, unknown>>; adjustments: Array<Record<string, unknown>> };
  assert.ok(!value.adjustments.some((item) => item['id'] === 'r-b'));
  assert.ok(!value.dayKinds.some((item) => item['id'] === 'h-b'));
});

test('get_lessons：指定学期、日期参数与跨度校验', async () => {
  const context = await seeded();
  await rejectsArg(context, 'get_lessons', {}, '缺少参数 from');
  await rejectsArg(context, 'get_lessons', { from: '2026-02-30' }, '参数 from 应为有效日期 YYYY-MM-DD');
  await rejectsArg(context, 'get_lessons', { from: '2026/09/14' }, /有效日期/);
  await rejectsArg(context, 'get_lessons', { from: 20260914 }, '参数 from 应为文本');
  await rejectsArg(context, 'get_lessons', { from: '2026-09-14', to: '2026-09-13' }, '结束日期不能早于开始日期');
  await rejectsArg(
    context,
    'get_lessons',
    { from: '2026-09-07', to: addDays('2026-09-07', AI_QUERY_MAX_DAYS) },
    `一次最多查 ${AI_QUERY_MAX_DAYS} 天`,
  );
  await rejectsArg(context, 'get_lessons', { semesterId: 'nope', from: '2026-09-14' }, '找不到学期 nope');
  // 正好 62 天可以查
  const { result } = await call(context, 'get_lessons', { semesterId: SEMESTER_ID, from: '2026-09-07', to: addDays('2026-09-07', AI_QUERY_MAX_DAYS - 1) });
  assert.ok((result as { lessons: unknown[] }).lessons.length > 0);
});

// ---- list_events ----

async function eventFixture(timeZone?: string): Promise<AiCoreContext> {
  const context = await seeded(timeZone);
  await addOtherUser(context.storage);
  const events = context.storage.collection<EventRow>('events');
  await events.put(eventRow('e-todo', 'todo', { title: '交报告', on_date: '2026-09-10', note: '两页' }));
  // 2026-09-20T17:00Z：上海 09-21 01:00，纽约 09-20 13:00
  await events.put(
    eventRow('e-exam', 'exam', { title: '高数期中', start_at: Date.UTC(2026, 8, 20, 17, 0), end_at: Date.UTC(2026, 8, 20, 19, 0), subject: 'c-1' }),
  );
  await events.put(eventRow('e-hw', 'homework', { title: '习题 3', due_at: Date.UTC(2026, 8, 15, 15, 59) }));
  await events.put(eventRow('e-lab', 'lab', { title: '光学实验', on_date: '2026-09-12', period_start: 5, period_end: 6, start_time: '14:00', end_time: '16:00' }));
  await events.put(eventRow('e-temp', 'temp', { title: '社团', on_date: '2026-09-11', countdown: 1 }));
  await events.put(eventRow('e-done', 'todo', { title: '已办', on_date: '2026-09-09', done: 1 }));
  await events.put(eventRow('e-dead', 'todo', { title: '已删', on_date: '2026-09-10', deleted_at: NOW }));
  await events.put(eventRow('e-other', 'todo', { title: '别人的', user_id: 'u2', semester_id: 'sem-u2', on_date: '2026-09-10' }));
  await events.put(eventRow('e-holiday', 'holiday', { on_date: '2026-09-10' }));
  await events.put(eventRow('e-res', 'reschedule', { ref_schedule_id: 's-1', on_date: '2026-09-14', action: 'cancel' }));
  return context;
}

type EventList = { total: number; items: Array<Record<string, unknown>> };

test('list_events：只列本人的条目类型，默认不含已完成，按日期排序', async () => {
  const context = await eventFixture();
  const { result } = await call(context, 'list_events');
  const value = result as EventList;
  assert.equal(value.total, 5);
  // 没日期的排在最后
  assert.deepEqual(value.items.map((item) => item['id']), ['e-todo', 'e-temp', 'e-lab', 'e-exam', 'e-hw']);
  const todo = value.items.find((item) => item['id'] === 'e-todo');
  assert.deepEqual(todo, {
    id: 'e-todo',
    type: 'todo',
    title: '交报告',
    date: '2026-09-10',
    start: null,
    end: null,
    due: null,
    location: null,
    note: '两页',
    courseId: null,
    done: false,
    countdown: false,
  });
  const hw = value.items.find((item) => item['id'] === 'e-hw');
  assert.equal(hw?.['date'], null);
  assert.equal(hw?.['due'], '2026-09-15 23:59');
  const exam = value.items.find((item) => item['id'] === 'e-exam');
  assert.deepEqual([exam?.['date'], exam?.['start'], exam?.['end'], exam?.['courseId']], ['2026-09-21', '01:00', '03:00', 'c-1']);
  const lab = value.items.find((item) => item['id'] === 'e-lab');
  assert.deepEqual([lab?.['start'], lab?.['end']], ['14:00', '16:00']);
  assert.equal(value.items.find((item) => item['id'] === 'e-temp')?.['countdown'], true);
});

test('list_events：时刻按上下文时区换算', async () => {
  const context = await eventFixture('America/New_York');
  const { result } = await call(context, 'list_events', { type: 'exam' });
  const exam = (result as EventList).items[0];
  assert.deepEqual([exam?.['date'], exam?.['start']], ['2026-09-20', '13:00']);
});

test('list_events：includeDone、类型与日期筛选', async () => {
  const context = await eventFixture();
  const all = (await call(context, 'list_events', { includeDone: true })).result as EventList;
  assert.equal(all.total, 6);
  assert.equal(all.items.find((item) => item['id'] === 'e-done')?.['done'], true);

  const todos = (await call(context, 'list_events', { type: 'todo', includeDone: true })).result as EventList;
  assert.deepEqual(todos.items.map((item) => item['id']), ['e-done', 'e-todo']);

  // 给了日期范围时，没日期的条目不列
  const ranged = (await call(context, 'list_events', { from: '2026-09-10', to: '2026-09-12' })).result as EventList;
  assert.deepEqual(ranged.items.map((item) => item['id']), ['e-todo', 'e-temp', 'e-lab']);
  const fromOnly = (await call(context, 'list_events', { from: '2026-09-12' })).result as EventList;
  assert.deepEqual(fromOnly.items.map((item) => item['id']), ['e-lab', 'e-exam']);
  const toOnly = (await call(context, 'list_events', { to: '2026-09-10' })).result as EventList;
  assert.deepEqual(toOnly.items.map((item) => item['id']), ['e-todo']);
});

test('list_events：最多返回上限条数，total 为全部条数', async () => {
  const context = await seeded();
  const events = context.storage.collection<EventRow>('events');
  const count = AI_EVENT_LIST_LIMIT + 5;
  for (let index = 0; index < count; index += 1) {
    await events.put(eventRow(`t-${String(index).padStart(3, '0')}`, 'todo', { on_date: addDays('2026-09-07', index % 30) }));
  }
  const { result } = await call(context, 'list_events');
  const value = result as EventList;
  assert.equal(value.total, count);
  assert.equal(value.items.length, AI_EVENT_LIST_LIMIT);
  const dates = value.items.map((item) => String(item['date']));
  assert.deepEqual(dates, [...dates].sort());
});

test('list_events：参数校验', async () => {
  const context = await seeded();
  await rejectsArg(context, 'list_events', { from: '2026-09-10', to: '2026-09-09' }, '结束日期不能早于开始日期');
  await rejectsArg(context, 'list_events', { type: 'holiday' }, '参数 type 只能是 todo / temp / homework / exam / lab');
  await rejectsArg(context, 'list_events', { includeDone: 'yes' }, '参数 includeDone 应为 true 或 false');
  await rejectsArg(context, 'list_events', { from: '2026-13-01' }, /有效日期/);
});

// ---- search ----

test('search：按关键字搜当前学期，缺关键字报错', async () => {
  const context = await seeded();
  const { result } = await call(context, 'search', { keyword: '高等数学' });
  const hits = result as Array<Record<string, unknown>>;
  assert.ok(hits.some((hit) => hit['courseId'] === 'c-1' || hit['id'] === 'c-1'));
  await rejectsArg(context, 'search', {}, '缺少参数 keyword');
  await rejectsArg(context, 'search', { keyword: '  ' }, '缺少参数 keyword');
});

// ---- list_reminders ----

test('list_reminders：带课程、时段与日程的名称，只列本人未删除的', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  await context.storage.collection<EventRow>('events').put(eventRow('e-1', 'exam', { title: '高数期中' }));
  const reminders = context.storage.collection<ReminderRow>('reminders');
  await reminders.put(reminderRow({ id: 'rm-1', target_type: 'course', target_id: 'c-1', advance_minutes: 15 }));
  await reminders.put(reminderRow({ id: 'rm-2', target_type: 'schedule', target_id: 's-2', enabled: 0 }));
  await reminders.put(reminderRow({ id: 'rm-3', target_type: 'event', target_id: 'e-1', advance_minutes: 60 }));
  await reminders.put(reminderRow({ id: 'rm-4', target_type: 'event', target_id: 'e-missing' }));
  await reminders.put(reminderRow({ id: 'rm-dead', target_id: 'c-2', deleted_at: NOW }));
  await reminders.put(reminderRow({ id: 'rm-other', target_id: 'c-3', user_id: 'u2' }));
  const { result } = await call(context, 'list_reminders');
  const items = (result as Array<Record<string, unknown>>).sort((left, right) => String(left['id']).localeCompare(String(right['id'])));
  assert.deepEqual(items, [
    { id: 'rm-1', targetType: 'course', targetId: 'c-1', targetName: '高等数学', advanceMinutes: 15, enabled: true },
    { id: 'rm-2', targetType: 'schedule', targetId: 's-2', targetName: '大学物理', advanceMinutes: 10, enabled: false },
    { id: 'rm-3', targetType: 'event', targetId: 'e-1', targetName: '高数期中', advanceMinutes: 60, enabled: true },
    { id: 'rm-4', targetType: 'event', targetId: 'e-missing', targetName: null, advanceMinutes: 10, enabled: true },
  ]);
});

// ---- 学期写入 ----

test('create_semester：默认 20 周、设为当前学期并带默认节次', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'create_semester', { name: '2027 春', startDate: '2027-02-22' });
  assert.equal(preview, '新建学期「2027 春」，2027-02-22 开学，共 20 周，设为当前学期');
  assert.equal(result, '已新建学期「2027 春」');
  const semesters = await alive<SemesterRow>(context.storage, 'semesters');
  const created = semesters.find((item) => item.name === '2027 春');
  assert.ok(created !== undefined);
  assert.deepEqual([created.start_date, created.total_weeks, created.is_active, created.user_id], ['2027-02-22', 20, 1, 'u1']);
  assert.equal((await row<SemesterRow>(context.storage, 'semesters', SEMESTER_ID)).is_active, 0);
  const slots = (await alive<TimeSlotRow>(context.storage, 'time_slots')).filter((slot) => slot.semester_id === created.id);
  assert.ok(slots.length > 0);
});

test('create_semester：不设为当前学期时原当前学期不变', async () => {
  const context = await seeded();
  const { preview } = await call(context, 'create_semester', { name: '备用', startDate: '2027-02-22', totalWeeks: 18, active: false });
  assert.equal(preview, '新建学期「备用」，2027-02-22 开学，共 18 周');
  assert.equal((await row<SemesterRow>(context.storage, 'semesters', SEMESTER_ID)).is_active, 1);
  const created = (await alive<SemesterRow>(context.storage, 'semesters')).find((item) => item.name === '备用');
  assert.deepEqual([created?.total_weeks, created?.is_active], [18, 0]);
});

test('create_semester：参数校验', async () => {
  const context = await seeded();
  await rejectsArg(context, 'create_semester', { startDate: '2027-02-22' }, '缺少参数 name');
  await rejectsArg(context, 'create_semester', { name: 'x' }, '缺少参数 startDate');
  await rejectsArg(context, 'create_semester', { name: 'x', startDate: '2027-02-29' }, /有效日期/);
  await rejectsArg(context, 'create_semester', { name: 'x', startDate: '2027-02-22', totalWeeks: 31 }, '参数 totalWeeks 不能大于 30');
  await rejectsArg(context, 'create_semester', { name: 'x', startDate: '2027-02-22', totalWeeks: 0 }, '参数 totalWeeks 不能小于 1');
  await rejectsArg(context, 'create_semester', { name: 'x', startDate: '2027-02-22', totalWeeks: 1.5 }, '参数 totalWeeks 应为整数');
});

test('update_semester：多个字段一起改', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'update_semester', {
    id: SEMESTER_ID,
    name: '秋季学期',
    startDate: '2026-09-14',
    totalWeeks: '18',
    timeZone: 'Asia/Tokyo',
  });
  assert.equal(preview, '学期「2026-2027 第一学期」：名称改为「秋季学期」，开学日期改为 2026-09-14，总周数改为 18，时区改为 Asia/Tokyo');
  assert.equal(result, '已修改学期「2026-2027 第一学期」');
  const updated = await row<SemesterRow>(context.storage, 'semesters', SEMESTER_ID);
  assert.deepEqual([updated.name, updated.start_date, updated.total_weeks, updated.time_zone], ['秋季学期', '2026-09-14', 18, 'Asia/Tokyo']);
});

test('update_semester：参数校验', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  await rejectsArg(context, 'update_semester', {}, '缺少参数 id');
  await rejectsArg(context, 'update_semester', { id: 'sem-u2', name: 'x' }, '找不到学期 sem-u2');
  await rejectsArg(context, 'update_semester', { id: SEMESTER_ID }, '没有要修改的字段');
  await rejectsArg(context, 'update_semester', { id: SEMESTER_ID, name: '  ', timeZone: '' }, '没有要修改的字段');
  await rejectsArg(context, 'update_semester', { id: SEMESTER_ID, timeZone: 'Mars/Base' }, '无效的时区 Mars/Base');
  await rejectsArg(context, 'update_semester', { id: SEMESTER_ID, totalWeeks: 40 }, '参数 totalWeeks 不能大于 30');
});

test('set_active_semester：只有目标学期为当前，别人的学期不受影响', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  await context.storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-b', name: '学期 B', is_active: 0 }));
  const { preview, result } = await call(context, 'set_active_semester', { id: 'sem-b' });
  assert.equal(preview, '切换到学期「学期 B」');
  assert.equal(result, '已切换到学期「学期 B」');
  assert.equal((await row<SemesterRow>(context.storage, 'semesters', 'sem-b')).is_active, 1);
  assert.equal((await row<SemesterRow>(context.storage, 'semesters', SEMESTER_ID)).is_active, 0);
  assert.equal((await row<SemesterRow>(context.storage, 'semesters', 'sem-u2')).is_active, 1);
  // 再设一次：已是当前学期，不变
  await call(context, 'set_active_semester', { id: 'sem-b' });
  const active = (await alive<SemesterRow>(context.storage, 'semesters')).filter((item) => item.user_id === 'u1' && item.is_active === 1);
  assert.deepEqual(active.map((item) => item.id), ['sem-b']);
  await rejectsArg(context, 'set_active_semester', { id: 'sem-u2' }, '找不到学期 sem-u2');
});

test('delete_semester：高危，连同课程与日程删除', async () => {
  const context = await seeded();
  await context.storage.collection<EventRow>('events').put(eventRow('e-1', 'todo', { title: '交报告' }));
  const action = actionOf('delete_semester');
  assert.equal(action.risk, 'danger');
  const { preview, result } = await call(context, 'delete_semester', { id: SEMESTER_ID });
  assert.equal(preview, '删除学期「2026-2027 第一学期」及其全部课程、日程与提醒');
  assert.equal(result, '已删除学期「2026-2027 第一学期」（课程 3 门，日程 1 条）');
  assert.notEqual((await row<SemesterRow>(context.storage, 'semesters', SEMESTER_ID)).deleted_at, null);
  assert.deepEqual(await alive<CourseRow>(context.storage, 'courses'), []);
  assert.deepEqual(await alive<CourseScheduleRow>(context.storage, 'course_schedules'), []);
  assert.deepEqual(await alive<EventRow>(context.storage, 'events'), []);
  await rejectsArg(context, 'delete_semester', { id: SEMESTER_ID }, `找不到学期 ${SEMESTER_ID}`);
  await rejectsArg(context, 'list_courses', {}, /^还没有学期/);
});

// ---- 节次 ----

test('update_period：只改上课时间，补齐前导零', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'update_period', { period: 2, start: '8:50' });
  assert.equal(preview, '第 2 节改为 08:50-09:40');
  assert.equal(result, '已修改第 2 节');
  const slot = await row<TimeSlotRow>(context.storage, 'time_slots', 'ts-2');
  assert.deepEqual([slot.start_time, slot.end_time], ['08:50', '09:40']);
  assert.equal(await previewOf(context, 'update_period', { period: 1, start: '07:50', end: '08:35' }), '第 1 节改为 07:50-08:35');
});

test('update_period：参数校验', async () => {
  const context = await seeded();
  await rejectsArg(context, 'update_period', {}, '缺少参数 period');
  await rejectsArg(context, 'update_period', { period: 21, start: '08:00' }, '参数 period 不能大于 20');
  await rejectsArg(context, 'update_period', { period: 7, start: '16:00' }, '没有第 7 节');
  await rejectsArg(context, 'update_period', { period: 2 }, '没有要修改的时间');
  await rejectsArg(context, 'update_period', { period: 2, end: '08:55' }, '下课时间要晚于上课时间');
  await rejectsArg(context, 'update_period', { period: 2, start: '09:40' }, '下课时间要晚于上课时间');
  await rejectsArg(context, 'update_period', { period: 2, start: '24:00' }, '参数 start 应为 HH:MM');
  await rejectsArg(context, 'update_period', { period: 2, start: '8:5' }, '参数 start 应为 HH:MM');
});

test('add_period：在最后一节后追加', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'add_period', { start: '15:50', end: '16:35' });
  assert.equal(preview, '追加第 7 节 15:50-16:35');
  assert.equal(result, '已追加第 7 节');
  const slots = (await alive<TimeSlotRow>(context.storage, 'time_slots')).filter((slot) => slot.semester_id === SEMESTER_ID);
  const added = slots.find((slot) => slot.period_no === 7);
  assert.deepEqual([added?.start_time, added?.end_time], ['15:50', '16:35']);
  assert.equal(slots.length, 7);
});

test('add_period：没有节次时从第 1 节开始，时刻补齐前导零', async () => {
  const context = await seeded();
  await context.storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-e', name: '空学期', is_active: 0 }));
  const { preview } = await call(context, 'add_period', { semesterId: 'sem-e', start: '8:05', end: '8:50' });
  assert.equal(preview, '追加第 1 节 08:05-08:50');
  const slots = (await alive<TimeSlotRow>(context.storage, 'time_slots')).filter((slot) => slot.semester_id === 'sem-e');
  assert.deepEqual(slots.map((slot) => [slot.period_no, slot.start_time, slot.end_time]), [[1, '08:05', '08:50']]);
});

test('add_period：参数校验', async () => {
  const context = await seeded();
  await rejectsArg(context, 'add_period', { start: '16:00' }, '缺少上课或下课时间');
  await rejectsArg(context, 'add_period', { start: '17:00', end: '16:00' }, '下课时间要晚于上课时间');
  await rejectsArg(context, 'add_period', { start: '15:30', end: '16:15' }, '上课时间不能早于第 6 节下课（15:40）');
  // 正好接在下课时刻可以
  assert.equal(await previewOf(context, 'add_period', { start: '15:40', end: '16:25' }), '追加第 7 节 15:40-16:25');

  await context.storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-full', name: '满节', is_active: 0 }));
  const slots = context.storage.collection<TimeSlotRow>('time_slots');
  for (let period = 1; period <= 20; period += 1) {
    const hour = String(period + 2).padStart(2, '0');
    await slots.put({ ...timeSlotRow(period, `${hour}:00`, `${hour}:45`), id: `full-${period}`, semester_id: 'sem-full' });
  }
  await rejectsArg(context, 'add_period', { semesterId: 'sem-full', start: '23:00', end: '23:30' }, '节次不能超过 20 节');
});

test('delete_period：有课排着时拒绝，空出来后可删', async () => {
  const context = await seeded();
  await rejectsArg(context, 'delete_period', { period: 6 }, '第 6 节还排着 1 个课程时段，先调整这些时段');
  await rejectsArg(context, 'delete_period', { period: 2 }, '第 2 节还排着 1 个课程时段，先调整这些时段');
  await rejectsArg(context, 'delete_period', { period: 9 }, '没有第 9 节');
  await rejectsArg(context, 'delete_period', {}, '缺少参数 period');

  // 已删除的时段不算占用
  await context.storage
    .collection<CourseScheduleRow>('course_schedules')
    .put(scheduleRow('s-3', 'c-3', [1, 3, 5, 7], { day_of_week: 5, period_start: 5, period_end: 6, deleted_at: NOW }));
  const { preview, result } = await call(context, 'delete_period', { period: 6 });
  assert.equal(preview, '删除第 6 节');
  assert.equal(result, '已删除第 6 节');
  const slots = (await alive<TimeSlotRow>(context.storage, 'time_slots')).filter((slot) => slot.semester_id === SEMESTER_ID);
  assert.deepEqual(slots.map((slot) => slot.period_no).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

// ---- 课程 ----

test('create_course：带排课时段，周次缺省为全学期', async () => {
  const context = await seeded();
  const args = {
    name: '线性代数',
    shortName: '',
    teacher: '赵老师',
    location: '教二-105',
    credits: 2.5,
    note: '双语',
    schedules: [
      { dayOfWeek: 2, periodStart: 3, periodEnd: 4, room: 'A-101' },
      { dayOfWeek: 4, periodStart: 1, weeks: [3, 1, 2, 3] },
    ],
  };
  const { preview, result } = await call(context, 'create_course', args);
  assert.equal(preview, '新建课程「线性代数」（赵老师）：周二 第 3-4 节，1-20周 A-101；周四 第 1 节，1-3周');
  assert.equal(result, '已新建课程「线性代数」');
  const course = (await alive<CourseRow>(context.storage, 'courses')).find((item) => item.name === '线性代数');
  assert.ok(course !== undefined);
  assert.deepEqual(
    [course.semester_id, course.short_name, course.teacher, course.location, course.credits, course.note],
    [SEMESTER_ID, null, '赵老师', '教二-105', 2.5, '双语'],
  );
  const schedules = (await alive<CourseScheduleRow>(context.storage, 'course_schedules'))
    .filter((item) => item.course_id === course.id)
    .sort((left, right) => left.day_of_week - right.day_of_week);
  assert.deepEqual(
    schedules.map((item) => [item.day_of_week, item.period_start, item.period_end, item.weeks_mask, item.room]),
    [
      [2, 3, 4, weeksToMask(weekRange(1, 20)), 'A-101'],
      [4, 1, 1, weeksToMask([1, 2, 3]), null],
    ],
  );
});

test('create_course：不带时段与教师时预览只有课程名，学分可为空', async () => {
  const context = await seeded();
  const { preview } = await call(context, 'create_course', { name: '体育', credits: null });
  assert.equal(preview, '新建课程「体育」');
  const course = (await alive<CourseRow>(context.storage, 'courses')).find((item) => item.name === '体育');
  assert.deepEqual([course?.credits, course?.teacher], [null, null]);
});

test('create_course：时段错误带上第几项', async () => {
  const context = await seeded();
  await rejectsArg(context, 'create_course', { name: 'x', schedules: [{ dayOfWeek: 1, periodStart: 1 }, { dayOfWeek: 1, periodStart: 7 }] }, 'schedules 第 2 项：参数 periodStart 不能大于 6');
  await rejectsArg(context, 'create_course', { name: 'x', schedules: [{ dayOfWeek: 1, periodStart: 1, weeks: [21] }] }, 'schedules 第 1 项：参数 weeks 里的值应为 1-20 的整数');
  await rejectsArg(context, 'create_course', { name: 'x', schedules: [{ dayOfWeek: 1, periodStart: 3, periodEnd: 2 }] }, 'schedules 第 1 项：结束节次不能早于开始节次');
  await rejectsArg(context, 'create_course', { name: 'x', schedules: [{ dayOfWeek: 1, periodStart: 1, weeks: [] }] }, 'schedules 第 1 项：周次不能为空');
  await rejectsArg(context, 'create_course', { name: 'x', schedules: [{ periodStart: 1 }] }, 'schedules 第 1 项：缺少参数 dayOfWeek');
  await rejectsArg(context, 'create_course', { name: 'x', schedules: [{ dayOfWeek: 0, periodStart: 1 }] }, 'schedules 第 1 项：参数 dayOfWeek 不能小于 1');
  await rejectsArg(context, 'create_course', { name: 'x', schedules: [null] }, 'schedules 第 1 项应为对象');
  await rejectsArg(context, 'create_course', { name: 'x', schedules: { dayOfWeek: 1 } }, '参数 schedules 应为数组');
});

test('create_course：课程名、学分与学期校验', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  await rejectsArg(context, 'create_course', {}, '缺少参数 name');
  await rejectsArg(context, 'create_course', { name: '' }, '缺少参数 name');
  for (const credits of [-1, 51, '3', Number.NaN]) {
    await rejectsArg(context, 'create_course', { name: 'x', credits }, '参数 credits 应为 0-50 的数');
  }
  await rejectsArg(context, 'create_course', { name: 'x', semesterId: 'sem-u2' }, '找不到学期 sem-u2');
});

test('update_course：改名、清空文本（空串或 null）与学分', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'update_course', {
    id: 'c-1',
    name: '高等数学 A',
    teacher: '',
    location: null,
    note: '期末闭卷',
    credits: null,
  });
  assert.equal(preview, '课程「高等数学」：名称改为「高等数学 A」，清空教师，清空教室，备注改为「期末闭卷」，清空学分');
  assert.equal(result, '已修改课程「高等数学」');
  const course = await row<CourseRow>(context.storage, 'courses', 'c-1');
  assert.deepEqual(
    [course.name, course.short_name, course.teacher, course.location, course.note, course.credits],
    ['高等数学 A', '高数', null, null, '期末闭卷', null],
  );
  assert.equal(await previewOf(context, 'update_course', { id: 'c-2', shortName: '物理', credits: 4 }), '课程「大学物理」：简称改为「物理」，学分改为 4');
});

test('update_course：参数校验', async () => {
  const context = await seeded();
  await context.storage.collection<CourseRow>('courses').put(courseRow('c-dead', '已删课', { deleted_at: NOW }));
  await rejectsArg(context, 'update_course', { name: 'x' }, '缺少参数 id');
  await rejectsArg(context, 'update_course', { id: 'c-none', name: 'x' }, '找不到课程 c-none');
  await rejectsArg(context, 'update_course', { id: 'c-dead', name: 'x' }, '找不到课程 c-dead');
  await rejectsArg(context, 'update_course', { id: 'c-1' }, '没有要修改的字段');
  await rejectsArg(context, 'update_course', { id: 'c-1', name: '' }, '没有要修改的字段');
  await rejectsArg(context, 'update_course', { id: 'c-1', credits: 'x' }, '参数 credits 应为 0-50 的数');
  await rejectsArg(context, 'update_course', { id: 'c-1', teacher: 5 }, '参数 teacher 应为文本');
});

test('delete_course：连同时段删除', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'delete_course', { id: 'c-1' });
  assert.equal(preview, '删除课程「高等数学」及其全部时段');
  assert.equal(result, '已删除课程「高等数学」');
  assert.notEqual((await row<CourseRow>(context.storage, 'courses', 'c-1')).deleted_at, null);
  assert.notEqual((await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1')).deleted_at, null);
  await rejectsArg(context, 'delete_course', { id: 'c-1' }, '找不到课程 c-1');
});

// ---- 排课时段 ----

test('add_schedule：按课程所在学期校验节次与周次', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'add_schedule', { courseId: 'c-2', dayOfWeek: 5, periodStart: 1, periodEnd: 2, weeks: [1, 2], room: '实验楼' });
  assert.equal(preview, `给「大学物理」加时段：周五 第 1-2 节，${describeWeeks(weeksToMask([1, 2]), 20)} 实验楼`);
  assert.equal(result, '已给「大学物理」加时段');
  const added = (await alive<CourseScheduleRow>(context.storage, 'course_schedules')).filter((item) => item.course_id === 'c-2' && item.day_of_week === 5);
  assert.deepEqual(added.map((item) => [item.period_start, item.period_end, item.weeks_mask, item.room]), [[1, 2, weeksToMask([1, 2]), '实验楼']]);

  await rejectsArg(context, 'add_schedule', { courseId: 'c-2', dayOfWeek: 8, periodStart: 1 }, '参数 dayOfWeek 不能大于 7');
  await rejectsArg(context, 'add_schedule', { courseId: 'c-2', dayOfWeek: 1 }, '缺少参数 periodStart');
  await rejectsArg(context, 'add_schedule', { courseId: 'c-2', dayOfWeek: 1, periodStart: 1, weeks: [0] }, '参数 weeks 里的值应为 1-20 的整数');
  await rejectsArg(context, 'add_schedule', { courseId: 'c-2', dayOfWeek: 1, periodStart: 1, weeks: 'all' }, '参数 weeks 应为整数数组');
  await rejectsArg(context, 'add_schedule', { courseId: 'nope', dayOfWeek: 1, periodStart: 1 }, '找不到课程 nope');
});

test('add_schedule：周次上限随学期总周数', async () => {
  const context = await seeded();
  await context.storage.collection<SemesterRow>('semesters').put(semesterRow({ total_weeks: 16 }));
  await rejectsArg(context, 'add_schedule', { courseId: 'c-1', dayOfWeek: 1, periodStart: 1, weeks: [17] }, '参数 weeks 里的值应为 1-16 的整数');
  assert.equal(await previewOf(context, 'add_schedule', { courseId: 'c-1', dayOfWeek: 2, periodStart: 1 }), '给「高等数学」加时段：周二 第 1 节，1-16周');
});

test('课程所在学期已删除时按找不到课程拒绝', async () => {
  const context = await seeded();
  await context.storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-gone', is_active: 0, deleted_at: NOW }));
  await context.storage.collection<CourseRow>('courses').put(courseRow('c-orphan', '孤儿课', { semester_id: 'sem-gone' }));
  await rejectsArg(context, 'add_schedule', { courseId: 'c-orphan', dayOfWeek: 1, periodStart: 1 }, '找不到课程 c-orphan');
  await rejectsArg(context, 'update_course', { id: 'c-orphan', name: 'x' }, '找不到课程 c-orphan');
});

async function scheduleFixture(): Promise<AiCoreContext> {
  const context = await seeded();
  await context.storage
    .collection<CourseScheduleRow>('course_schedules')
    .put(scheduleRow('s-1', 'c-1', weekRange(1, 16), { day_of_week: 1, period_start: 1, period_end: 2, weeks_raw: '1-16周', room: 'R1' }));
  return context;
}

test('update_schedule：没给的字段沿用原值（含周次与教室）', async () => {
  const context = await scheduleFixture();
  const { preview, result } = await call(context, 'update_schedule', { id: 's-1', dayOfWeek: 2 });
  assert.equal(preview, '「高等数学」的时段改为：周二 第 1-2 节，1-16周 R1');
  assert.equal(result, '已修改「高等数学」的时段');
  const updated = await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1');
  assert.deepEqual(
    [updated.day_of_week, updated.period_start, updated.period_end, updated.weeks_mask, updated.weeks_raw, updated.room],
    [2, 1, 2, weeksToMask(weekRange(1, 16)), null, 'R1'],
  );
});

test('update_schedule：只给开始节次时结束节次随之重置', async () => {
  const context = await scheduleFixture();
  assert.equal(await previewOf(context, 'update_schedule', { id: 's-1', periodStart: 4 }), '「高等数学」的时段改为：周一 第 4 节，1-16周 R1');
  await call(context, 'update_schedule', { id: 's-1', periodStart: 3, periodEnd: 4 });
  const updated = await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1');
  assert.deepEqual([updated.period_start, updated.period_end], [3, 4]);
  // 显式 null 与不给一样：开始与结束节次都沿用原值
  assert.equal(await previewOf(context, 'update_schedule', { id: 's-1', periodStart: null, dayOfWeek: 2 }), '「高等数学」的时段改为：周二 第 3-4 节，1-16周 R1');
  // 只改结束节次：开始节次不变
  await call(context, 'update_schedule', { id: 's-1', periodEnd: 5 });
  const again = await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1');
  assert.deepEqual([again.period_start, again.period_end], [3, 5]);
});

test('update_schedule：改周次、空串清空教室', async () => {
  const context = await scheduleFixture();
  const { preview } = await call(context, 'update_schedule', { id: 's-1', weeks: [2, 4], room: '' });
  assert.equal(preview, `「高等数学」的时段改为：周一 第 1-2 节，${describeWeeks(weeksToMask([2, 4]), 20)}`);
  const updated = await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1');
  assert.deepEqual([updated.weeks_mask, updated.room], [weeksToMask([2, 4]), null]);
  await call(context, 'update_schedule', { id: 's-1', room: '新教室' });
  assert.equal((await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1')).room, '新教室');
  await call(context, 'update_schedule', { id: 's-1', room: null });
  assert.equal((await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1')).room, null);
});

test('update_schedule：参数校验', async () => {
  const context = await scheduleFixture();
  const schedules = context.storage.collection<CourseScheduleRow>('course_schedules');
  await schedules.put(scheduleRow('s-dead', 'c-1', [1], { deleted_at: NOW }));
  await context.storage.collection<CourseRow>('courses').put(courseRow('c-dead', '已删课', { deleted_at: NOW }));
  await schedules.put(scheduleRow('s-of-dead', 'c-dead', [1]));
  await rejectsArg(context, 'update_schedule', {}, '缺少参数 id');
  await rejectsArg(context, 'update_schedule', { id: 's-dead', dayOfWeek: 2 }, '找不到排课时段 s-dead');
  await rejectsArg(context, 'update_schedule', { id: 's-of-dead', dayOfWeek: 2 }, '找不到课程 c-dead');
  await rejectsArg(context, 'update_schedule', { id: 's-1', periodStart: 2, periodEnd: 1 }, '结束节次不能早于开始节次');
  await rejectsArg(context, 'update_schedule', { id: 's-1', periodEnd: 7 }, '参数 periodEnd 不能大于 6');
  await rejectsArg(context, 'update_schedule', { id: 's-1', periodStart: 7 }, '参数 periodStart 不能大于 6');
  await rejectsArg(context, 'update_schedule', { id: 's-1', weeks: [] }, '周次不能为空');
  await rejectsArg(context, 'update_schedule', { id: 's-1', weeks: [21] }, '参数 weeks 里的值应为 1-20 的整数');
});

test('delete_schedule：删除一个时段', async () => {
  const context = await seeded();
  const { preview, result } = await call(context, 'delete_schedule', { id: 's-1' });
  assert.equal(preview, '删除「高等数学」周一 第 1-2 节的时段');
  assert.equal(result, '已删除「高等数学」的一个时段');
  assert.notEqual((await row<CourseScheduleRow>(context.storage, 'course_schedules', 's-1')).deleted_at, null);
  assert.equal((await row<CourseRow>(context.storage, 'courses', 'c-1')).deleted_at, null);
  await rejectsArg(context, 'delete_schedule', { id: 's-1' }, '找不到排课时段 s-1');
});

// ---- 假日与上课日 ----

async function dayKindFixture(): Promise<AiCoreContext> {
  const context = await seeded();
  const storage = context.storage;
  await storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-b', name: '学期 B', is_active: 0 }));
  const events = storage.collection<EventRow>('events');
  await events.put(eventRow('k-null', 'holiday', { on_date: '2026-10-10', source: null }));
  await events.put(eventRow('k-manual', 'workday', { on_date: '2026-10-11', source: 'manual' }));
  await events.put(eventRow('k-makeup', 'makeup', { on_date: '2026-10-12', as_day_of_week: 1 }));
  await events.put(eventRow('k-out', 'holiday', { on_date: '2026-10-13' }));
  await events.put(eventRow('k-other', 'holiday', { semester_id: 'sem-b', on_date: '2026-10-10' }));
  await events.put(eventRow('k-todo', 'todo', { on_date: '2026-10-10' }));
  return context;
}

/** 内置与学校来源的记录：与手动记录共用「同学期同日一条」的唯一键，只能放在没有手动记录的日期。 */
async function addProtectedMarks(storage: Storage, builtinDate: string, schoolDate: string): Promise<void> {
  const events = storage.collection<EventRow>('events');
  await events.put(eventRow('k-builtin', 'holiday', { on_date: builtinDate, source: 'builtin' }));
  await events.put(eventRow('k-school', 'workday', { on_date: schoolDate, source: 'from_school' }));
}

async function aliveIds(storage: Storage): Promise<string[]> {
  return (await alive<EventRow>(storage, 'events')).map((item) => item.id).sort();
}

test('set_day_kind：设为假日时替换手动设置，不动范围外与其他学期的记录', async () => {
  const context = await dayKindFixture();
  const { preview, result } = await call(context, 'set_day_kind', { from: '2026-10-10', to: '2026-10-12', kind: 'holiday', title: '' });
  assert.equal(preview, '2026-10-10 至 2026-10-12（3 天）设为假日');
  assert.equal(result, '已设置 3 天');
  const rows = await alive<EventRow>(context.storage, 'events');
  const ids = rows.map((item) => item.id);
  for (const gone of ['k-null', 'k-manual', 'k-makeup']) assert.ok(!ids.includes(gone), gone);
  for (const kept of ['k-out', 'k-other', 'k-todo']) assert.ok(ids.includes(kept), kept);
  const created = rows.filter((item) => !item.id.startsWith('k-'));
  assert.deepEqual(
    created.map((item) => [item.on_date, item.type, item.title, item.semester_id, item.user_id]).sort(),
    [
      ['2026-10-10', 'holiday', '假日', SEMESTER_ID, 'u1'],
      ['2026-10-11', 'holiday', '假日', SEMESTER_ID, 'u1'],
      ['2026-10-12', 'holiday', '假日', SEMESTER_ID, 'u1'],
    ],
  );
});

test('set_day_kind：单日假日带名称，重复设置同一天只留一条', async () => {
  const context = await seeded();
  assert.equal(await previewOf(context, 'set_day_kind', { from: '2026-09-21', kind: 'holiday', title: '运动会' }), '2026-09-21 设为假日「运动会」');
  assert.equal(await previewOf(context, 'set_day_kind', { from: '2026-10-10', kind: 'holiday' }), '2026-10-10 设为假日');
  assert.equal(await previewOf(context, 'set_day_kind', { from: '2026-10-10', kind: 'workday' }), '2026-10-10 设为上课日');
  await call(context, 'set_day_kind', { from: '2026-09-21', kind: 'holiday', title: '运动会' });
  await call(context, 'set_day_kind', { from: '2026-09-21', to: '2026-09-21', kind: 'holiday', title: '校庆' });
  const holidays = (await alive<EventRow>(context.storage, 'events')).filter((item) => item.type === 'holiday');
  assert.deepEqual(holidays.map((item) => [item.on_date, item.title]), [['2026-09-21', '校庆']]);
  // 设为假日后当天的课不再出现
  const { result } = await call(context, 'get_lessons', { from: '2026-09-21' });
  assert.deepEqual((result as { lessons: unknown[] }).lessons, []);
});

test('set_day_kind：设为上课日', async () => {
  const context = await dayKindFixture();
  const { preview, result } = await call(context, 'set_day_kind', { from: '2026-10-10', to: '2026-10-11', kind: 'workday', title: '忽略' });
  assert.equal(preview, '2026-10-10 至 2026-10-11（2 天）设为上课日');
  assert.equal(result, '已设置 2 天');
  const rows = await alive<EventRow>(context.storage, 'events');
  const created = rows.filter((item) => !item.id.startsWith('k-'));
  assert.deepEqual(created.map((item) => [item.on_date, item.type, item.title]).sort(), [
    ['2026-10-10', 'workday', '上课日'],
    ['2026-10-11', 'workday', '上课日'],
  ]);
  // 10-12 的调休记录不在范围内，保留
  assert.ok(rows.some((item) => item.id === 'k-makeup'));
});

test('set_day_kind：清除只删手动设置，不动内置与学校的记录', async () => {
  const context = await dayKindFixture();
  await context.storage.collection<EventRow>('events').put(eventRow('k-null', 'holiday', { on_date: '2026-10-10', deleted_at: NOW }));
  await context.storage.collection<EventRow>('events').put(eventRow('k-null-2', 'holiday', { on_date: '2026-10-09', source: null }));
  await addProtectedMarks(context.storage, '2026-10-14', '2026-10-15');
  const { preview, result } = await call(context, 'set_day_kind', { from: '2026-10-09', to: '2026-10-15', kind: 'clear' });
  assert.equal(preview, '清除 2026-10-09 至 2026-10-15（7 天）的手动假日与上课日设置');
  assert.equal(result, '已清除 4 条手动设置');
  assert.deepEqual(await aliveIds(context.storage), ['k-builtin', 'k-other', 'k-school', 'k-todo']);
  const single = await call(context, 'set_day_kind', { from: '2026-10-10', kind: 'clear' });
  assert.equal(single.preview, '清除 2026-10-10 的手动假日与上课日设置');
  assert.equal(single.result, '已清除 0 条手动设置');
});

test('set_day_kind：当天已有内置或学校来源的记录时就地改成手动设置', async () => {
  const context = await seeded();
  const events = context.storage.collection<EventRow>('events');
  await events.put(eventRow('k-builtin', 'holiday', { on_date: '2026-10-10', title: '国庆', source: 'builtin' }));
  await events.put(eventRow('k-school', 'makeup', { on_date: '2026-10-11', title: '补课', source: 'from_school', as_day_of_week: 3 }));
  await events.put(eventRow('k-manual', 'workday', { on_date: '2026-10-12', source: 'manual' }));
  const { result } = await call(context, 'set_day_kind', { from: '2026-10-10', to: '2026-10-13', kind: 'holiday', title: '秋假' });
  assert.equal(result, '已设置 4 天');
  const rows = (await alive<EventRow>(context.storage, 'events')).sort((left, right) => String(left.on_date).localeCompare(String(right.on_date)));
  assert.deepEqual(
    rows.map((item) => [item.on_date, item.type, item.title, item.source, item.as_day_of_week]),
    [
      ['2026-10-10', 'holiday', '秋假', 'manual', null],
      ['2026-10-11', 'holiday', '秋假', 'manual', null],
      ['2026-10-12', 'holiday', '秋假', null, null],
      ['2026-10-13', 'holiday', '秋假', null, null],
    ],
  );
  // 导入与内置的行就地更新，保留 id
  assert.deepEqual([rows[0]?.id, rows[1]?.id], ['k-builtin', 'k-school']);
  assert.notEqual((await row<EventRow>(context.storage, 'events', 'k-manual')).deleted_at, null);

  // 改成上课日：已是手动的行删掉重写
  await call(context, 'set_day_kind', { from: '2026-10-10', kind: 'workday' });
  const marks = (await alive<EventRow>(context.storage, 'events')).filter((item) => item.on_date === '2026-10-10');
  assert.equal(marks.length, 1);
  assert.deepEqual([marks[0]?.type, marks[0]?.title], ['workday', '上课日']);

  // 清除：就地改成手动的行也一并清掉
  assert.equal((await call(context, 'set_day_kind', { from: '2026-10-10', to: '2026-10-13', kind: 'clear' })).result, '已清除 4 条手动设置');
  assert.deepEqual(await alive<EventRow>(context.storage, 'events'), []);
});

test('set_day_kind：参数校验', async () => {
  const context = await seeded();
  await rejectsArg(context, 'set_day_kind', { kind: 'holiday' }, '缺少参数 from');
  await rejectsArg(context, 'set_day_kind', { from: '2026-10-10' }, '缺少参数 kind');
  await rejectsArg(context, 'set_day_kind', { from: '2026-10-10', kind: 'makeup' }, '参数 kind 只能是 holiday / workday / clear');
  await rejectsArg(context, 'set_day_kind', { from: '2026-10-10', to: '2026-10-09', kind: 'holiday' }, '结束日期不能早于开始日期');
  await rejectsArg(
    context,
    'set_day_kind',
    { from: '2026-10-10', to: addDays('2026-10-10', AI_DAY_KIND_MAX_DAYS), kind: 'holiday' },
    `一次最多设 ${AI_DAY_KIND_MAX_DAYS} 天`,
  );
  await rejectsArg(context, 'set_day_kind', { semesterId: 'nope', from: '2026-10-10', kind: 'holiday' }, '找不到学期 nope');
  const longest = await previewOf(context, 'set_day_kind', { from: '2026-10-10', to: addDays('2026-10-10', AI_DAY_KIND_MAX_DAYS - 1), kind: 'holiday' });
  assert.match(longest, new RegExp(`（${AI_DAY_KIND_MAX_DAYS} 天）`));
});

// ---- 日程删除与完成 ----

async function entryFixture(): Promise<AiCoreContext> {
  const context = await seeded();
  const events = context.storage.collection<EventRow>('events');
  await events.put(eventRow('e-1', 'homework', { title: '习题 3', on_date: '2026-09-10' }));
  await events.put(eventRow('e-2', 'todo', { title: '买书' }));
  await events.put(eventRow('e-dead', 'todo', { title: '已删', deleted_at: NOW }));
  await events.put(eventRow('h-1', 'holiday', { on_date: '2026-09-21' }));
  await events.put(eventRow('r-1', 'reschedule', { ref_schedule_id: 's-1', on_date: '2026-09-14', action: 'cancel' }));
  return context;
}

test('delete_event：删除日程条目', async () => {
  const context = await entryFixture();
  assert.equal(await previewOf(context, 'delete_event', { id: 'e-2' }), '删除「买书」');
  const { preview, result } = await call(context, 'delete_event', { id: 'e-1' });
  assert.equal(preview, '删除「习题 3」（2026-09-10）');
  assert.equal(result, '已删除「习题 3」');
  assert.notEqual((await row<EventRow>(context.storage, 'events', 'e-1')).deleted_at, null);
});

test('delete_event / set_event_done：不接受假日与调课记录', async () => {
  const context = await entryFixture();
  for (const name of ['delete_event', 'set_event_done']) {
    await rejectsArg(context, name, { id: 'h-1' }, 'h-1 不是日程条目');
    await rejectsArg(context, name, { id: 'r-1' }, 'r-1 不是日程条目');
    await rejectsArg(context, name, { id: 'e-dead' }, '找不到日程 e-dead');
    await rejectsArg(context, name, { id: 'e-none' }, '找不到日程 e-none');
    await rejectsArg(context, name, {}, '缺少参数 id');
  }
});

test('set_event_done：默认标为已完成，也可改回未完成', async () => {
  const context = await entryFixture();
  const done = await call(context, 'set_event_done', { id: 'e-1' });
  assert.equal(done.preview, '「习题 3」标为已完成');
  assert.equal(done.result, '「习题 3」已标为已完成');
  assert.equal((await row<EventRow>(context.storage, 'events', 'e-1')).done, 1);
  const undone = await call(context, 'set_event_done', { id: 'e-1', done: false });
  assert.equal(undone.preview, '「习题 3」标为未完成');
  assert.equal(undone.result, '「习题 3」已标为未完成');
  assert.equal((await row<EventRow>(context.storage, 'events', 'e-1')).done, 0);
  await rejectsArg(context, 'set_event_done', { id: 'e-1', done: 'yes' }, '参数 done 应为 true 或 false');
});

// ---- 提醒 ----

test('set_reminder：同一对象再设覆盖原提醒', async () => {
  const context = await seeded();
  const first = await call(context, 'set_reminder', { targetType: 'course', targetId: 'c-1' });
  assert.equal(first.preview, '给「高等数学」设提醒，提前 10 分钟');
  assert.equal(first.result, '已设置「高等数学」的提醒');
  const created = await alive<ReminderRow>(context.storage, 'reminders');
  assert.equal(created.length, 1);
  assert.deepEqual(
    [created[0]?.user_id, created[0]?.target_type, created[0]?.target_id, created[0]?.advance_minutes, created[0]?.enabled],
    ['u1', 'course', 'c-1', 10, 1],
  );

  const second = await call(context, 'set_reminder', { targetType: 'course', targetId: 'c-1', advanceMinutes: 30 });
  assert.equal(second.preview, '给「高等数学」设提醒，提前 30 分钟');
  const off = await call(context, 'set_reminder', { targetType: 'course', targetId: 'c-1', enabled: false });
  assert.equal(off.preview, '关闭「高等数学」的提醒');
  const rows = await alive<ReminderRow>(context.storage, 'reminders');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, created[0]?.id);
  assert.deepEqual([rows[0]?.advance_minutes, rows[0]?.enabled], [10, 0]);
});

test('set_reminder：时段与日程对象的名称', async () => {
  const context = await entryFixture();
  assert.equal(
    await previewOf(context, 'set_reminder', { targetType: 'schedule', targetId: 's-2', advanceMinutes: 15 }),
    '给「大学物理 周三 第 3 节」设提醒，提前 15 分钟',
  );
  await call(context, 'set_reminder', { targetType: 'event', targetId: 'e-1', advanceMinutes: 1440 });
  const { result } = await call(context, 'list_reminders');
  assert.deepEqual(
    (result as Array<Record<string, unknown>>).map((item) => [item['targetType'], item['targetName'], item['advanceMinutes']]),
    [['event', '习题 3', 1440]],
  );
});

test('set_reminder：参数校验', async () => {
  const context = await entryFixture();
  await rejectsArg(context, 'set_reminder', { targetId: 'c-1' }, '缺少参数 targetType');
  await rejectsArg(context, 'set_reminder', { targetType: 'course' }, '缺少参数 targetId');
  await rejectsArg(context, 'set_reminder', { targetType: 'semester', targetId: 'c-1' }, '参数 targetType 只能是 course / schedule / event');
  await rejectsArg(context, 'set_reminder', { targetType: 'course', targetId: 'c-none' }, '找不到课程 c-none');
  await rejectsArg(context, 'set_reminder', { targetType: 'schedule', targetId: 's-none' }, '找不到排课时段 s-none');
  await rejectsArg(context, 'set_reminder', { targetType: 'event', targetId: 'h-1' }, 'h-1 不是日程条目');
  await rejectsArg(context, 'set_reminder', { targetType: 'course', targetId: 'c-1', advanceMinutes: 10081 }, '参数 advanceMinutes 不能大于 10080');
  await rejectsArg(context, 'set_reminder', { targetType: 'course', targetId: 'c-1', advanceMinutes: -1 }, '参数 advanceMinutes 不能小于 0');
  await rejectsArg(context, 'set_reminder', { targetType: 'course', targetId: 'c-1', enabled: 1 }, '参数 enabled 应为 true 或 false');
});

test('delete_reminder：只删本人的提醒', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  const reminders = context.storage.collection<ReminderRow>('reminders');
  await reminders.put(reminderRow({ id: 'rm-1', target_id: 'c-1' }));
  await reminders.put(reminderRow({ id: 'rm-other', target_id: 'c-2', user_id: 'u2' }));
  await reminders.put(reminderRow({ id: 'rm-dead', target_id: 'c-3', deleted_at: NOW }));
  await rejectsArg(context, 'delete_reminder', { id: 'rm-other' }, '找不到提醒 rm-other');
  await rejectsArg(context, 'delete_reminder', { id: 'rm-dead' }, '找不到提醒 rm-dead');
  await rejectsArg(context, 'delete_reminder', {}, '缺少参数 id');
  const { preview, result } = await call(context, 'delete_reminder', { id: 'rm-1' });
  assert.equal(preview, '删除提醒 rm-1');
  assert.equal(result, '已删除提醒');
  assert.notEqual((await row<ReminderRow>(context.storage, 'reminders', 'rm-1')).deleted_at, null);
  assert.equal((await row<ReminderRow>(context.storage, 'reminders', 'rm-other')).deleted_at, null);
});

// ---- 归属 ----

test('别人的课程、排课时段与日程 id 一律按找不到拒绝', async () => {
  const context = await seeded();
  await addOtherUser(context.storage);
  await context.storage.collection<CourseRow>('courses').put(courseRow('c-u2', '别人的课', { semester_id: 'sem-u2' }));
  await context.storage.collection<CourseScheduleRow>('course_schedules').put(scheduleRow('s-u2', 'c-u2', [1, 2]));
  await context.storage
    .collection<EventRow>('events')
    .put(eventRow('e-u2', 'todo', { user_id: 'u2', semester_id: 'sem-u2', title: '别人的待办' }));

  await rejectsArg(context, 'update_course', { id: 'c-u2', name: 'x' }, '找不到课程 c-u2');
  await rejectsArg(context, 'delete_course', { id: 'c-u2' }, '找不到课程 c-u2');
  await rejectsArg(context, 'add_schedule', { courseId: 'c-u2', dayOfWeek: 1, periodStart: 1 }, '找不到课程 c-u2');
  await rejectsArg(context, 'update_schedule', { id: 's-u2', dayOfWeek: 2 }, '找不到课程 c-u2');
  await rejectsArg(context, 'delete_schedule', { id: 's-u2' }, '找不到课程 c-u2');
  await rejectsArg(context, 'delete_event', { id: 'e-u2' }, '找不到日程 e-u2');
  await rejectsArg(context, 'set_event_done', { id: 'e-u2' }, '找不到日程 e-u2');
  await rejectsArg(context, 'set_reminder', { targetType: 'course', targetId: 'c-u2' }, '找不到课程 c-u2');
  await rejectsArg(context, 'set_reminder', { targetType: 'schedule', targetId: 's-u2' }, '找不到课程 c-u2');
  await rejectsArg(context, 'set_reminder', { targetType: 'event', targetId: 'e-u2' }, '找不到日程 e-u2');
  // 别人的行没被动过
  assert.equal((await row<CourseRow>(context.storage, 'courses', 'c-u2')).deleted_at, null);
  assert.equal((await row<EventRow>(context.storage, 'events', 'e-u2')).done, 0);
});
