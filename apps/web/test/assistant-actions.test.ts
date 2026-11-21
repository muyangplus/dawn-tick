import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiArgError,
  createCourse,
  createEvent,
  createReschedule,
  createSchedule,
  createSemester,
  findAction,
  listManagedCourses,
  validatedStorage,
  weeksToMask,
  type AiArgs,
  type AiCoreContext,
  type CourseScheduleRow,
  type EventRow,
  type ManagedSchedule,
  type Storage,
} from '@dawn-tick/core';
import { createStorage } from '@dawn-tick/core/testing';
import { AI_EVENT_ACTIONS, eventColumnsOf, type EventDraftFields } from '../src/assistant/actions-events.ts';
import { AI_ADJUST_ACTIONS } from '../src/assistant/actions-adjust.ts';
import { adjustCopy } from '../src/copy/timetable-adjust.ts';
import { loadEventAdvance } from '../src/screens/todo-form-model.ts';

const USER_ID = 'u1';
const TIME_ZONE = 'Asia/Shanghai';
/** 学期自 2026-03-02（周一）起 20 周，到 2026-07-19 */
const START = '2026-03-02';
const TOTAL_WEEKS = 20;
const NOW = Date.UTC(2026, 2, 5, 4, 0);
const ACTIONS = [...AI_EVENT_ACTIONS, ...AI_ADJUST_ACTIONS];

/** 上海墙钟 → UTC 毫秒（上海无夏令时，固定 +8），不依赖本机时区。 */
function shanghai(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

interface Seeded {
  storage: Storage;
  context: AiCoreContext;
  semesterId: string;
  mathId: string;
  englishId: string;
  /** 高数周一 1–2 节，1–20 周 */
  mathMon: ManagedSchedule;
  /** 高数周四 5–6 节，1–16 周 */
  mathThu: ManagedSchedule;
  /** 英语周三 3–4 节，1–16 周 */
  englishWed: ManagedSchedule;
}

async function seed(timeZone = TIME_ZONE): Promise<Seeded> {
  const storage = validatedStorage(createStorage());
  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '测试学期',
    startDate: START,
    totalWeeks: TOTAL_WEEKS,
    timeZone: TIME_ZONE,
  });
  const semesterId = String(semester['id']);
  const math = await createCourse(storage, { semesterId, name: '高等数学', shortName: '高数', location: '教三-201' });
  const english = await createCourse(storage, { semesterId, name: '大学英语', shortName: '英语' });
  const mathId = String(math['id']);
  const englishId = String(english['id']);
  const all = Array.from({ length: TOTAL_WEEKS }, (_, index) => index + 1);
  const first16 = all.slice(0, 16);
  await createSchedule(storage, { courseId: mathId, dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: all });
  await createSchedule(storage, { courseId: mathId, dayOfWeek: 4, periodStart: 5, periodEnd: 6, weeks: first16 });
  await createSchedule(storage, { courseId: englishId, dayOfWeek: 3, periodStart: 3, periodEnd: 4, weeks: first16 });
  const courses = await listManagedCourses(storage, semesterId);
  const mathCourse = courses.find((course) => course.id === mathId)!;
  const englishCourse = courses.find((course) => course.id === englishId)!;
  return {
    storage,
    context: { storage, userId: USER_ID, now: () => NOW, timeZone },
    semesterId,
    mathId,
    englishId,
    mathMon: mathCourse.schedules.find((item) => item.dayOfWeek === 1)!,
    mathThu: mathCourse.schedules.find((item) => item.dayOfWeek === 4)!,
    englishWed: englishCourse.schedules[0]!,
  };
}

function actionOf(name: string) {
  const action = findAction(ACTIONS, name);
  assert.ok(action !== undefined, `未登记动作 ${name}`);
  return action;
}

/** 按助手的顺序跑一遍：parse → preview → run。 */
async function call(context: AiCoreContext, name: string, args: AiArgs): Promise<{ preview: string; result: unknown }> {
  const action = actionOf(name);
  const params = await action.parse(args, context);
  const preview = await action.preview(params, context);
  const result = await action.run(params, context);
  return { preview, result };
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

async function liveEvents(storage: Storage): Promise<EventRow[]> {
  return (await storage.collection<EventRow>('events').getAll()).filter((row) => row.deleted_at === null);
}

async function onlyEvent(storage: Storage): Promise<EventRow> {
  const rows = await liveEvents(storage);
  assert.equal(rows.length, 1, `应只有一条日程，实际 ${rows.length} 条`);
  return rows[0]!;
}

async function createOne(seeded: Seeded, args: AiArgs): Promise<EventRow> {
  await call(seeded.context, 'create_event', args);
  const rows = await liveEvents(seeded.storage);
  return rows[rows.length - 1]!;
}

async function reload(storage: Storage, id: string): Promise<EventRow> {
  const row = await storage.collection<EventRow>('events').get(id);
  assert.ok(row !== undefined);
  return row;
}

// ---- eventColumnsOf ----

function fieldsOf(overrides: Partial<EventDraftFields> = {}): EventDraftFields {
  return {
    kind: 'todo',
    title: '交材料',
    date: '2026-03-10',
    time: '09:00',
    startTime: null,
    endTime: null,
    courseId: null,
    location: '图书馆',
    seatNo: '12',
    note: '带学生证',
    countdown: false,
    manualDone: false,
    showInTimetable: false,
    periodStart: null,
    periodEnd: null,
    weeks: null,
    dayOfWeek: null,
    ...overrides,
  };
}

test('eventColumnsOf：未关联的待办写成 temp，不带截止、地点与座位号', () => {
  assert.deepEqual(eventColumnsOf(fieldsOf(), 'sem-1', TIME_ZONE), {
    type: 'temp',
    title: '交材料',
    semester_id: 'sem-1',
    on_date: '2026-03-10',
    start_at: shanghai('2026-03-10', '09:00'),
    end_at: null,
    due_at: null,
    subject: null,
    location: null,
    seat_no: null,
    note: '带学生证',
    countdown: 0,
    manual_done: 0,
    start_time: null,
    end_time: null,
    period_start: null,
    period_end: null,
    weeks_mask: null,
    as_day_of_week: null,
    nature: null,
    show_in_timetable: 0,
  });
});

test('eventColumnsOf：关联课程的待办为 todo，自定义时间时截止取结束时刻', () => {
  const columns = eventColumnsOf(fieldsOf({ courseId: 'c-1', startTime: '14:00', endTime: '15:30' }), 'sem-1', TIME_ZONE);
  assert.equal(columns['type'], 'todo');
  assert.equal(columns['subject'], 'c-1');
  assert.equal(columns['start_at'], shanghai('2026-03-10', '14:00'));
  assert.equal(columns['end_at'], shanghai('2026-03-10', '15:30'));
  assert.equal(columns['due_at'], shanghai('2026-03-10', '15:30'));
  assert.equal(columns['start_time'], '14:00');
  assert.equal(columns['end_time'], '15:30');
});

test('eventColumnsOf：只有开始时刻不算自定义时间，按 time 写开始', () => {
  const columns = eventColumnsOf(fieldsOf({ time: '10:30', startTime: '14:00' }), 'sem-1', TIME_ZONE);
  assert.equal(columns['start_at'], shanghai('2026-03-10', '10:30'));
  assert.equal(columns['end_at'], null);
  assert.equal(columns['start_time'], null);
  assert.equal(columns['end_time'], null);
});

test('eventColumnsOf：作业没有自定义时间时截止取开始，地点不写', () => {
  const columns = eventColumnsOf(fieldsOf({ kind: 'homework', time: '23:00' }), 'sem-1', TIME_ZONE);
  assert.equal(columns['type'], 'homework');
  assert.equal(columns['due_at'], shanghai('2026-03-10', '23:00'));
  assert.equal(columns['due_at'], columns['start_at']);
  assert.equal(columns['location'], null);
  assert.equal(columns['seat_no'], null);
});

test('eventColumnsOf：考试不关联课程，保留地点与座位号，不设截止', () => {
  const columns = eventColumnsOf(fieldsOf({ kind: 'exam', courseId: 'c-1', countdown: true }), 'sem-1', TIME_ZONE);
  assert.equal(columns['type'], 'exam');
  assert.equal(columns['subject'], null);
  assert.equal(columns['due_at'], null);
  assert.equal(columns['location'], '图书馆');
  assert.equal(columns['seat_no'], '12');
  assert.equal(columns['countdown'], 1);
});

test('eventColumnsOf：实验按周重复时写周次掩码与星期，总是显示在课表上', () => {
  const columns = eventColumnsOf(
    fieldsOf({ kind: 'lab', periodStart: 3, periodEnd: 4, weeks: [2, 4, 6], dayOfWeek: 2 }),
    'sem-1',
    TIME_ZONE,
  );
  assert.equal(columns['type'], 'lab');
  assert.equal(columns['nature'], 'lab');
  assert.equal(columns['period_start'], 3);
  assert.equal(columns['period_end'], 4);
  assert.equal(columns['weeks_mask'], weeksToMask([2, 4, 6]));
  assert.equal(columns['as_day_of_week'], 2);
  assert.equal(columns['show_in_timetable'], 1);
  assert.equal(columns['location'], '图书馆');
  assert.equal(columns['seat_no'], null);

  const once = eventColumnsOf(fieldsOf({ kind: 'lab', periodStart: 3, periodEnd: 4, weeks: [], dayOfWeek: 2 }), 'sem-1', TIME_ZONE);
  assert.equal(once['weeks_mask'], null, '空周次只这一次');
  assert.equal(once['as_day_of_week'], null);
});

test('eventColumnsOf：非实验不写节次，显示在课表按开关', () => {
  const columns = eventColumnsOf(fieldsOf({ periodStart: 3, periodEnd: 4, weeks: [1], showInTimetable: true }), 'sem-1', TIME_ZONE);
  assert.equal(columns['period_start'], null);
  assert.equal(columns['period_end'], null);
  assert.equal(columns['weeks_mask'], null);
  assert.equal(columns['nature'], null);
  assert.equal(columns['show_in_timetable'], 1);
});

test('eventColumnsOf：时刻按传入时区换算，不看本机时区', () => {
  const newYork = eventColumnsOf(fieldsOf({ date: '2026-11-27' }), 'sem-1', 'America/New_York');
  assert.equal(newYork['start_at'], Date.UTC(2026, 10, 27, 14, 0), '11 月纽约为 UTC-5');
  const kolkata = eventColumnsOf(fieldsOf({ date: '2026-11-27' }), 'sem-1', 'Asia/Kolkata');
  assert.equal(kolkata['start_at'], Date.UTC(2026, 10, 27, 3, 30));
});

// ---- create_event ----

test('create_event：默认待办写成 temp、09:00、提前 30 分钟提醒', async () => {
  const seeded = await seed();
  const { preview, result } = await call(seeded.context, 'create_event', { kind: 'todo', title: '交材料', date: '2026-03-10' });
  assert.equal(preview, '新建待办「交材料」2026-03-10 09:00，提前 30 分钟提醒');
  assert.equal(result, '已新建待办「交材料」');
  const row = await onlyEvent(seeded.storage);
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.semester_id, seeded.semesterId);
  assert.equal(row.type, 'temp');
  assert.equal(row.on_date, '2026-03-10');
  assert.equal(row.start_at, shanghai('2026-03-10', '09:00'));
  assert.equal(row.end_at, null);
  assert.equal(row.due_at, null);
  assert.equal(row.subject, null);
  assert.equal(row.countdown, 0);
  assert.equal(row.manual_done, 0);
  assert.equal(row.show_in_timetable, 0);
  assert.equal(await loadEventAdvance(seeded.storage, row.id), 30);
});

test('create_event：关联课程的待办为 todo，带截止与课程名', async () => {
  const seeded = await seed();
  const { preview } = await call(seeded.context, 'create_event', {
    kind: 'todo',
    title: '交报告',
    date: '2026-03-10',
    time: '20:00',
    courseId: seeded.mathId,
    location: '教三',
    seatNo: '5',
  });
  assert.match(preview, /关联「高等数学」/);
  const row = await onlyEvent(seeded.storage);
  assert.equal(row.type, 'todo');
  assert.equal(row.subject, seeded.mathId);
  assert.equal(row.due_at, shanghai('2026-03-10', '20:00'));
  assert.equal(row.location, null, '地点只给考试与实验');
  assert.equal(row.seat_no, null);
});

test('create_event：作业默认倒计时与手动完成，自定义时间截止取结束', async () => {
  const seeded = await seed();
  const row = await createOne(seeded, {
    kind: 'homework',
    title: '习题 3',
    date: '2026-03-12',
    startTime: '19:00',
    endTime: '23:59',
  });
  assert.equal(row.type, 'homework');
  assert.equal(row.countdown, 1);
  assert.equal(row.manual_done, 1);
  assert.equal(row.start_time, '19:00');
  assert.equal(row.end_time, '23:59');
  assert.equal(row.start_at, shanghai('2026-03-12', '19:00'));
  assert.equal(row.end_at, shanghai('2026-03-12', '23:59'));
  assert.equal(row.due_at, shanghai('2026-03-12', '23:59'));
});

test('create_event：考试不关联课程，保留地点与座位号，倒计时开', async () => {
  const seeded = await seed();
  const { preview } = await call(seeded.context, 'create_event', {
    kind: 'exam',
    title: '高数期中',
    date: '2026-04-20',
    startTime: '09:00',
    endTime: '11:00',
    courseId: seeded.mathId,
    location: 'A101',
    seatNo: '23',
  });
  assert.doesNotMatch(preview, /关联/);
  assert.match(preview, /，A101/);
  const row = await onlyEvent(seeded.storage);
  assert.equal(row.type, 'exam');
  assert.equal(row.subject, null);
  assert.equal(row.due_at, null);
  assert.equal(row.location, 'A101');
  assert.equal(row.seat_no, '23');
  assert.equal(row.countdown, 1);
  assert.equal(row.manual_done, 0);
});

test('create_event：开关可覆盖类型默认值', async () => {
  const seeded = await seed();
  const row = await createOne(seeded, {
    kind: 'homework',
    title: '读书笔记',
    date: '2026-03-12',
    countdown: false,
    manualDone: false,
    showInTimetable: true,
  });
  assert.equal(row.countdown, 0);
  assert.equal(row.manual_done, 0);
  assert.equal(row.show_in_timetable, 1);
});

test('create_event：实验要给起始节，结束节默认同起始节，总是显示在课表', async () => {
  const seeded = await seed();
  await rejectsArg(seeded.context, 'create_event', { kind: 'lab', title: '物理实验', date: '2026-03-11' }, '实验要给出 periodStart');
  const { preview } = await call(seeded.context, 'create_event', {
    kind: 'lab',
    title: '物理实验',
    date: '2026-03-11',
    periodStart: 5,
    location: '实验楼 302',
    seatNo: '9',
    showInTimetable: false,
  });
  assert.match(preview, /第 5-5 节/);
  const row = await onlyEvent(seeded.storage);
  assert.equal(row.type, 'lab');
  assert.equal(row.nature, 'lab');
  assert.equal(row.period_start, 5);
  assert.equal(row.period_end, 5);
  assert.equal(row.weeks_mask, null);
  assert.equal(row.as_day_of_week, null);
  assert.equal(row.location, '实验楼 302');
  assert.equal(row.seat_no, null);
  assert.equal(row.show_in_timetable, 1);
});

test('create_event：实验按周重复，星期默认取日期的 ISO 星期', async () => {
  const seeded = await seed();
  // 2026-03-11 是周三，2026-03-15 是周日
  const wednesday = await createOne(seeded, {
    kind: 'lab',
    title: '电路实验',
    date: '2026-03-11',
    periodStart: 3,
    periodEnd: 4,
    weeks: [6, 2, 4, 2],
  });
  assert.equal(wednesday.weeks_mask, weeksToMask([2, 4, 6]));
  assert.equal(wednesday.as_day_of_week, 3);
  const sunday = await createOne(seeded, { kind: 'lab', title: '周日实验', date: '2026-03-15', periodStart: 1, weeks: [3] });
  assert.equal(sunday.as_day_of_week, 7);
  const explicit = await createOne(seeded, {
    kind: 'lab',
    title: '指定星期',
    date: '2026-03-11',
    periodStart: 1,
    weeks: [3],
    dayOfWeek: 5,
  });
  assert.equal(explicit.as_day_of_week, 5);
  await rejectsArg(
    seeded.context,
    'create_event',
    { kind: 'lab', title: 'x', date: '2026-03-11', periodStart: 1, weeks: [TOTAL_WEEKS + 1] },
    /weeks/,
  );
});

test('create_event：advanceMinutes 为 -1 不提醒，0 为准时提醒', async () => {
  const seeded = await seed();
  const { preview } = await call(seeded.context, 'create_event', {
    kind: 'todo',
    title: '不提醒',
    date: '2026-03-10',
    advanceMinutes: -1,
  });
  assert.match(preview, /，不提醒$/);
  const silent = await onlyEvent(seeded.storage);
  assert.equal(await loadEventAdvance(seeded.storage, silent.id), null);
  assert.equal((await seeded.storage.collection('reminders').getAll()).length, 0);

  const onTime = await createOne(seeded, { kind: 'todo', title: '准时', date: '2026-03-10', advanceMinutes: 0 });
  assert.equal(await loadEventAdvance(seeded.storage, onTime.id), 0);
});

test('create_event：可指定其他学期', async () => {
  const seeded = await seed();
  const other = await createSemester(seeded.storage, {
    userId: USER_ID,
    name: '下学期',
    startDate: '2026-09-07',
    isActive: false,
    timeZone: TIME_ZONE,
  });
  const row = await createOne(seeded, { kind: 'todo', title: '选课', date: '2026-09-08', semesterId: String(other['id']) });
  assert.equal(row.semester_id, String(other['id']));
  await rejectsArg(seeded.context, 'create_event', { kind: 'todo', title: 'x', date: '2026-03-10', semesterId: 'nope' }, '找不到学期 nope');
});

test('create_event：时刻按上下文时区换算', async () => {
  const seeded = await seed('America/New_York');
  const row = await createOne(seeded, { kind: 'todo', title: '纽约', date: '2026-03-10', time: '09:00' });
  // 2026-03-10 纽约已进入夏令时（3 月 8 日起），UTC-4
  assert.equal(row.start_at, Date.UTC(2026, 2, 10, 13, 0));
});

test('create_event：不合法的参数抛 AiArgError', async () => {
  const { context } = await seed();
  const base = { kind: 'todo', title: '交材料', date: '2026-03-10' };
  await rejectsArg(context, 'create_event', { ...base, title: '' }, '缺少参数 title');
  await rejectsArg(context, 'create_event', { ...base, title: '   ' }, '缺少参数 title');
  await rejectsArg(context, 'create_event', { ...base, kind: 'party' }, /参数 kind 只能是/);
  await rejectsArg(context, 'create_event', { ...base, date: '2026-02-30' }, /有效日期/);
  await rejectsArg(context, 'create_event', { ...base, startTime: '14:00' }, 'startTime 与 endTime 要一起给出');
  await rejectsArg(context, 'create_event', { ...base, endTime: '14:00' }, 'startTime 与 endTime 要一起给出');
  await rejectsArg(context, 'create_event', { ...base, startTime: '14:00', endTime: '14:00' }, 'endTime 应晚于 startTime');
  await rejectsArg(context, 'create_event', { ...base, startTime: '14:00', endTime: '13:00' }, 'endTime 应晚于 startTime');
  await rejectsArg(context, 'create_event', { ...base, courseId: 'c-missing' }, /没有课程 c-missing/);
  await rejectsArg(context, 'create_event', { ...base, advanceMinutes: -2 }, /advanceMinutes 不能小于 -1/);
  assert.equal((await liveEvents(context.storage)).length, 0);
});

// ---- update_event ----

async function seededTodo(seeded: Seeded): Promise<EventRow> {
  return createOne(seeded, {
    kind: 'todo',
    title: '交报告',
    date: '2026-03-10',
    startTime: '14:00',
    endTime: '15:30',
    courseId: seeded.mathId,
    note: '打印两份',
    advanceMinutes: 60,
  });
}

test('update_event：只改传了的字段，其余列与提醒不动', async () => {
  const seeded = await seed();
  const before = await seededTodo(seeded);
  const { preview, result } = await call(seeded.context, 'update_event', { id: before.id, title: '交实验报告' });
  assert.equal(preview, '修改为待办「交实验报告」2026-03-10 14:00-15:30，关联「高等数学」');
  assert.equal(result, '已修改「交实验报告」');
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.title, '交实验报告');
  for (const key of [
    'type',
    'on_date',
    'start_at',
    'end_at',
    'due_at',
    'subject',
    'note',
    'start_time',
    'end_time',
    'countdown',
    'manual_done',
    'show_in_timetable',
  ] as const) {
    assert.equal(after[key], before[key], `${key} 不应变化`);
  }
  assert.equal(await loadEventAdvance(seeded.storage, before.id), 60);
});

test('update_event：改日期时沿用原时刻', async () => {
  const seeded = await seed();
  const before = await createOne(seeded, { kind: 'homework', title: '习题', date: '2026-03-10', time: '21:00' });
  await call(seeded.context, 'update_event', { id: before.id, date: '2026-03-12' });
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.on_date, '2026-03-12');
  assert.equal(after.start_at, shanghai('2026-03-12', '21:00'));
  assert.equal(after.due_at, shanghai('2026-03-12', '21:00'));
});

test('update_event：空串清空课程、备注与自定义时间', async () => {
  const seeded = await seed();
  const before = await seededTodo(seeded);
  await call(seeded.context, 'update_event', { id: before.id, courseId: '', note: '', startTime: '', endTime: '' });
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.type, 'temp', '取消关联后不再是 todo');
  assert.equal(after.subject, null);
  assert.equal(after.due_at, null);
  assert.equal(after.note, null);
  assert.equal(after.start_time, null);
  assert.equal(after.end_time, null);
  assert.equal(after.end_at, null);
  assert.equal(after.start_at, shanghai('2026-03-10', '14:00'), '取消自定义时间后按原开始时刻');
});

test('update_event：只清空 startTime 也取消自定义时间', async () => {
  const seeded = await seed();
  const before = await seededTodo(seeded);
  await call(seeded.context, 'update_event', { id: before.id, startTime: '' });
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.start_time, null);
  assert.equal(after.end_time, null);
});

test('update_event：改起止时刻时可只给一端，另一端沿用原值', async () => {
  const seeded = await seed();
  const before = await seededTodo(seeded);
  await call(seeded.context, 'update_event', { id: before.id, endTime: '17:00' });
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.start_time, '14:00');
  assert.equal(after.end_time, '17:00');
  assert.equal(after.due_at, shanghai('2026-03-10', '17:00'));
  await rejectsArg(seeded.context, 'update_event', { id: before.id, endTime: '13:00' }, 'endTime 应晚于 startTime');
});

test('update_event：给没有自定义时间的条目只补一端时报错', async () => {
  const seeded = await seed();
  const before = await createOne(seeded, { kind: 'todo', title: '交材料', date: '2026-03-10' });
  await rejectsArg(seeded.context, 'update_event', { id: before.id, startTime: '10:00' }, 'startTime 与 endTime 要一起给出');
  await call(seeded.context, 'update_event', { id: before.id, startTime: '10:00', endTime: '11:00' });
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.start_time, '10:00');
  assert.equal(after.end_time, '11:00');
  assert.equal(after.start_at, shanghai('2026-03-10', '10:00'));
});

test('update_event：考试的地点与座位号可清空', async () => {
  const seeded = await seed();
  const before = await createOne(seeded, {
    kind: 'exam',
    title: '期中',
    date: '2026-04-20',
    location: 'A101',
    seatNo: '23',
  });
  await call(seeded.context, 'update_event', { id: before.id, location: '', seatNo: '' });
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.location, null);
  assert.equal(after.seat_no, null);
});

test('update_event：改类型时倒计时与手动完成回到新类型的默认值', async () => {
  const seeded = await seed();
  const homework = await createOne(seeded, { kind: 'homework', title: '习题', date: '2026-03-10', courseId: seeded.mathId });
  await call(seeded.context, 'update_event', { id: homework.id, kind: 'exam', location: 'B201' });
  const exam = await reload(seeded.storage, homework.id);
  assert.equal(exam.type, 'exam');
  assert.equal(exam.countdown, 1);
  assert.equal(exam.manual_done, 0);
  assert.equal(exam.subject, null, '考试不关联课程');
  assert.equal(exam.due_at, null);
  assert.equal(exam.location, 'B201');

  const todo = await createOne(seeded, { kind: 'todo', title: '待办', date: '2026-03-10' });
  await call(seeded.context, 'update_event', { id: todo.id, kind: 'homework', manualDone: false });
  const changed = await reload(seeded.storage, todo.id);
  assert.equal(changed.type, 'homework');
  assert.equal(changed.countdown, 1);
  assert.equal(changed.manual_done, 0, '传了的开关优先于默认值');
  assert.equal(changed.due_at, shanghai('2026-03-10', '09:00'));
});

test('update_event：类型不变时不重置开关', async () => {
  const seeded = await seed();
  const before = await createOne(seeded, { kind: 'homework', title: '习题', date: '2026-03-10', countdown: false });
  await call(seeded.context, 'update_event', { id: before.id, kind: 'homework', title: '习题 2' });
  const after = await reload(seeded.storage, before.id);
  assert.equal(after.countdown, 0);
  assert.equal(after.manual_done, 1);
});

test('update_event：改成实验要给起始节；实验周次传空数组取消重复', async () => {
  const seeded = await seed();
  const todo = await createOne(seeded, { kind: 'todo', title: '待办', date: '2026-03-11' });
  await rejectsArg(seeded.context, 'update_event', { id: todo.id, kind: 'lab' }, '实验要给出 periodStart');

  const lab = await createOne(seeded, {
    kind: 'lab',
    title: '实验',
    date: '2026-03-11',
    periodStart: 3,
    periodEnd: 4,
    weeks: [2, 3],
  });
  await call(seeded.context, 'update_event', { id: lab.id, location: '实验楼' });
  const kept = await reload(seeded.storage, lab.id);
  assert.equal(kept.weeks_mask, weeksToMask([2, 3]), '不传 weeks 时保留原周次');
  assert.equal(kept.as_day_of_week, 3);
  assert.equal(kept.period_start, 3);
  assert.equal(kept.period_end, 4);
  assert.equal(kept.location, '实验楼');

  await call(seeded.context, 'update_event', { id: lab.id, weeks: [] });
  const once = await reload(seeded.storage, lab.id);
  assert.equal(once.weeks_mask, null);
  assert.equal(once.as_day_of_week, null);
});

test('update_event：实验改回待办时去掉节次，保留原性质标签', async () => {
  const seeded = await seed();
  const lab = await createOne(seeded, { kind: 'lab', title: '实验', date: '2026-03-11', periodStart: 3, location: '实验楼' });
  await call(seeded.context, 'update_event', { id: lab.id, kind: 'todo' });
  const after = await reload(seeded.storage, lab.id);
  assert.equal(after.type, 'temp');
  assert.equal(after.period_start, null);
  assert.equal(after.period_end, null);
  assert.equal(after.location, null);
  assert.equal(after.nature, 'lab', '与表单一致：非实验沿用原性质');
  assert.equal(after.show_in_timetable, 1, '原来显示在课表上，开关沿用');
});

test('update_event：不传 advanceMinutes 不动提醒，-1 删除，其他值改写', async () => {
  const seeded = await seed();
  const before = await seededTodo(seeded);
  await call(seeded.context, 'update_event', { id: before.id, note: '改备注' });
  assert.equal(await loadEventAdvance(seeded.storage, before.id), 60);

  await call(seeded.context, 'update_event', { id: before.id, advanceMinutes: 1440 });
  assert.equal(await loadEventAdvance(seeded.storage, before.id), 1440);

  const { preview } = await call(seeded.context, 'update_event', { id: before.id, advanceMinutes: -1 });
  assert.match(preview, /，不提醒$/);
  assert.equal(await loadEventAdvance(seeded.storage, before.id), null);
});

test('update_event：拒绝未知 id、调整记录、已删除条目与空标题', async () => {
  const seeded = await seed();
  const todo = await seededTodo(seeded);
  const reschedule = await createReschedule(seeded.storage, {
    userId: USER_ID,
    semesterId: seeded.semesterId,
    refScheduleId: seeded.mathMon.id,
    onDate: '2026-03-09',
    action: 'cancel',
  });
  const makeup = await createEvent(seeded.storage, {
    userId: USER_ID,
    semesterId: seeded.semesterId,
    type: 'makeup',
    title: '调休',
    onDate: '2026-03-14',
    asDayOfWeek: 1,
  });
  await rejectsArg(seeded.context, 'update_event', { id: 'nope', title: 'x' }, '找不到日程 nope');
  await rejectsArg(seeded.context, 'update_event', { id: String(reschedule['id']), title: 'x' }, `${String(reschedule['id'])} 不是日程条目`);
  await rejectsArg(seeded.context, 'update_event', { id: String(makeup['id']), title: 'x' }, `${String(makeup['id'])} 不是日程条目`);
  await rejectsArg(seeded.context, 'update_event', { id: todo.id, title: '' }, '标题不能为空');
  await rejectsArg(seeded.context, 'update_event', { id: todo.id, title: '  ' }, '标题不能为空');
  await rejectsArg(seeded.context, 'update_event', { id: todo.id, courseId: 'c-missing' }, /没有课程 c-missing/);
  await rejectsArg(seeded.context, 'update_event', { title: 'x' }, '缺少参数 id');
});

test('update_event：别人的日程按找不到处理，原行不变', async () => {
  const seeded = await seed();
  const other = await createSemester(seeded.storage, { userId: 'u2', name: '别人的学期', startDate: START, timeZone: TIME_ZONE });
  const created = await createEvent(seeded.storage, {
    userId: 'u2',
    semesterId: String(other['id']),
    type: 'temp',
    title: '别人的待办',
    onDate: '2026-03-10',
    startAt: shanghai('2026-03-10', '09:00'),
  });
  const id = String(created['id']);
  const before = await reload(seeded.storage, id);
  await rejectsArg(seeded.context, 'update_event', { id, title: '改掉' }, `找不到日程 ${id}`);
  assert.deepEqual(await reload(seeded.storage, id), before);
});

// ---- move_lesson ----

async function reschedules(storage: Storage): Promise<EventRow[]> {
  return (await liveEvents(storage)).filter((row) => row.type === 'reschedule');
}

test('move_lesson：默认按指定日期改期，节次沿用原排课', async () => {
  const seeded = await seed();
  const { preview, result } = await call(seeded.context, 'move_lesson', {
    scheduleId: seeded.mathMon.id,
    date: '2026-03-09',
    newDate: '2026-03-20',
  });
  assert.equal(preview, '「高等数学」2026-03-09 这次改到 2026-03-20 第 1-2 节');
  assert.equal(result, '已把「高等数学」2026-03-09 的课改到 2026-03-20');
  const [row, ...rest] = await reschedules(seeded.storage);
  assert.equal(rest.length, 0);
  assert.equal(row!.action, 'move');
  assert.equal(row!.ref_schedule_id, seeded.mathMon.id);
  assert.equal(row!.semester_id, seeded.semesterId);
  assert.equal(row!.user_id, USER_ID);
  assert.equal(row!.on_date, '2026-03-09');
  assert.equal(row!.new_date, '2026-03-20');
  assert.equal(row!.new_period_start, 1);
  assert.equal(row!.new_period_end, 2);
  assert.equal(row!.new_room, null);
  assert.equal(row!.as_day_of_week, 5);
  assert.equal(row!.title, adjustCopy.moveRecordTitle('高等数学'));
});

test('move_lesson：只改起始节时保持原来的节数，可另给结束节与教室', async () => {
  const seeded = await seed();
  await call(seeded.context, 'move_lesson', {
    scheduleId: seeded.mathMon.id,
    date: '2026-03-09',
    newDate: '2026-03-09',
    periodStart: 5,
  });
  const { preview } = await call(seeded.context, 'move_lesson', {
    scheduleId: seeded.mathMon.id,
    date: '2026-03-16',
    newDate: '2026-03-17',
    periodStart: 3,
    periodEnd: 5,
    room: '教一-101',
  });
  assert.match(preview, /第 3-5 节，教室 教一-101$/);
  const [first, second] = await reschedules(seeded.storage);
  assert.equal(first!.new_period_start, 5);
  assert.equal(first!.new_period_end, 6);
  assert.equal(second!.new_period_start, 3);
  assert.equal(second!.new_period_end, 5);
  assert.equal(second!.new_room, '教一-101');
});

test('move_lesson：空串教室按不换教室', async () => {
  const seeded = await seed();
  await call(seeded.context, 'move_lesson', { scheduleId: seeded.mathMon.id, date: '2026-03-09', newDate: '2026-03-10', room: '' });
  const [row] = await reschedules(seeded.storage);
  assert.equal(row!.new_room, null);
});

test('move_lesson：week 要给 targetWeek，星期取 newDate 的星期', async () => {
  const seeded = await seed();
  const args = { scheduleId: seeded.mathMon.id, date: '2026-03-09', newDate: '2026-03-11', scope: 'week' };
  await rejectsArg(seeded.context, 'move_lesson', args, 'scope 为 week 时要给出 targetWeek');
  await rejectsArg(seeded.context, 'move_lesson', { ...args, targetWeek: TOTAL_WEEKS + 1 }, adjustCopy.targetWeekRange(TOTAL_WEEKS));
  await call(seeded.context, 'move_lesson', { ...args, targetWeek: 5 });
  const [row] = await reschedules(seeded.storage);
  // 第 5 周周三：2026-03-02 + 4 周 + 2 天
  assert.equal(row!.new_date, '2026-04-01');
  assert.equal(row!.as_day_of_week, 3);
});

test('move_lesson：this 不能跨周', async () => {
  const seeded = await seed();
  await rejectsArg(
    seeded.context,
    'move_lesson',
    { scheduleId: seeded.mathMon.id, date: '2026-03-09', newDate: '2026-03-16', scope: 'this' },
    adjustCopy.thisScopeCrossWeek,
  );
  await call(seeded.context, 'move_lesson', { scheduleId: seeded.mathMon.id, date: '2026-03-09', newDate: '2026-03-13', scope: 'this' });
  const [row] = await reschedules(seeded.storage);
  assert.equal(row!.new_date, '2026-03-13');
});

test('move_lesson：weekly 直接改排课，不记调课', async () => {
  const seeded = await seed();
  const { preview, result } = await call(seeded.context, 'move_lesson', {
    scheduleId: seeded.mathMon.id,
    date: '2026-03-09',
    newDate: '2026-03-10',
    scope: 'weekly',
    periodStart: 7,
  });
  assert.equal(preview, '「高等数学」以后每周改到星期2 第 7-8 节');
  assert.equal(result, '已改「高等数学」的课表');
  const schedule = await seeded.storage.collection<CourseScheduleRow>('course_schedules').get(seeded.mathMon.id);
  assert.equal(schedule!.day_of_week, 2);
  assert.equal(schedule!.period_start, 7);
  assert.equal(schedule!.period_end, 8);
  assert.equal(schedule!.weeks_mask, weeksToMask(seeded.mathMon.weeks), '周次不变');
  assert.equal((await liveEvents(seeded.storage)).length, 0);
});

test('move_lesson：计划校验失败时抛 AiArgError', async () => {
  const seeded = await seed();
  const id = seeded.mathMon.id;
  await rejectsArg(seeded.context, 'move_lesson', { scheduleId: id, date: '2026-03-09', newDate: '2026-03-09' }, adjustCopy.sameAsBefore);
  await rejectsArg(
    seeded.context,
    'move_lesson',
    { scheduleId: id, date: '2026-03-09', newDate: '2026-03-16', scope: 'weekly' },
    adjustCopy.sameAsBefore,
  );
  await rejectsArg(seeded.context, 'move_lesson', { scheduleId: id, date: '2026-03-09', newDate: '2026-08-03' }, /调整后日期/);
  await rejectsArg(
    seeded.context,
    'move_lesson',
    { scheduleId: id, date: '2026-02-23', newDate: '2026-03-10' },
    '「高等数学」2026-02-23 没有这节课',
  );
  await rejectsArg(
    seeded.context,
    'move_lesson',
    { scheduleId: id, date: '2026-03-09', newDate: '2026-03-10', periodStart: 4, periodEnd: 3 },
    adjustCopy.invalidPeriods,
  );
  await rejectsArg(seeded.context, 'move_lesson', { scheduleId: 'nope', date: '2026-03-09', newDate: '2026-03-10' }, '找不到排课 nope');
  assert.equal((await liveEvents(seeded.storage)).length, 0);
});

test('move_lesson：原日期那天没有这节课时拒绝', async () => {
  const seeded = await seed();
  const id = seeded.mathThu.id;
  // 周四时段：2026-03-10 是周二，2026-06-25 是第 17 周周四（只上 1–16 周）
  await rejectsArg(seeded.context, 'move_lesson', { scheduleId: id, date: '2026-03-10', newDate: '2026-03-13' }, '「高等数学」2026-03-10 没有这节课');
  await rejectsArg(seeded.context, 'move_lesson', { scheduleId: id, date: '2026-06-25', newDate: '2026-06-26' }, '「高等数学」2026-06-25 没有这节课');
  assert.equal((await liveEvents(seeded.storage)).length, 0);
  await call(seeded.context, 'move_lesson', { scheduleId: id, date: '2026-06-18', newDate: '2026-06-19' });
  const [row] = await reschedules(seeded.storage);
  assert.equal(row!.on_date, '2026-06-18');
  assert.equal(row!.new_date, '2026-06-19');
});

test('move_lesson：沿用节数推出的结束节不超过 20', async () => {
  const seeded = await seed();
  await createSchedule(seeded.storage, { courseId: seeded.englishId, dayOfWeek: 5, periodStart: 19, periodEnd: 20, weeks: [1, 2] });
  const late = (await listManagedCourses(seeded.storage, seeded.semesterId))
    .find((course) => course.id === seeded.englishId)!
    .schedules.find((item) => item.dayOfWeek === 5)!;
  const { preview } = await call(seeded.context, 'move_lesson', { scheduleId: late.id, date: '2026-03-06', newDate: '2026-03-07', periodStart: 20 });
  assert.match(preview, /第 20 节$/);
  const [row] = await reschedules(seeded.storage);
  assert.equal(row!.new_period_start, 20);
  assert.equal(row!.new_period_end, 20);
});

// ---- cancel_lessons ----

async function cancelled(storage: Storage): Promise<Array<[string | null, string | null]>> {
  return (await reschedules(storage))
    .filter((row) => row.action === 'cancel')
    .map((row): [string | null, string | null] => [row.ref_schedule_id, row.on_date])
    .sort((left, right) => String(left[1]).localeCompare(String(right[1])) || String(left[0]).localeCompare(String(right[0])));
}

test('cancel_lessons：默认只停 from 那一次', async () => {
  const seeded = await seed();
  const { preview, result } = await call(seeded.context, 'cancel_lessons', { scheduleId: seeded.mathMon.id, from: '2026-03-09' });
  assert.equal(preview, '停课「高等数学」2026-03-09，共 1 次课');
  assert.equal(result, '已为「高等数学」记 1 次停课');
  assert.deepEqual(await cancelled(seeded.storage), [[seeded.mathMon.id, '2026-03-09']]);
  const [row] = await reschedules(seeded.storage);
  assert.equal(row!.title, adjustCopy.cancelRecordTitle('高等数学'));
  assert.equal(row!.semester_id, seeded.semesterId);
});

test('cancel_lessons：整门课只给 courseId，按日期段停掉全部时段', async () => {
  const seeded = await seed();
  const { preview } = await call(seeded.context, 'cancel_lessons', {
    courseId: seeded.mathId,
    target: 'course',
    range: 'range',
    from: '2026-03-09',
    to: '2026-03-19',
  });
  assert.equal(preview, '停课「高等数学」2026-03-09 至 2026-03-19，共 4 次课');
  assert.deepEqual(await cancelled(seeded.storage), [
    [seeded.mathMon.id, '2026-03-09'],
    [seeded.mathThu.id, '2026-03-12'],
    [seeded.mathMon.id, '2026-03-16'],
    [seeded.mathThu.id, '2026-03-19'],
  ]);
});

test('cancel_lessons：from 从这天起结课到学期末', async () => {
  const seeded = await seed();
  // 周四时段只上 1–16 周，最后一次是 2026-06-18
  const { preview } = await call(seeded.context, 'cancel_lessons', { scheduleId: seeded.mathThu.id, range: 'from', from: '2026-06-01' });
  assert.equal(preview, '结课「高等数学」2026-06-01 至 2026-06-18，共 3 次课');
  assert.deepEqual(await cancelled(seeded.storage), [
    [seeded.mathThu.id, '2026-06-04'],
    [seeded.mathThu.id, '2026-06-11'],
    [seeded.mathThu.id, '2026-06-18'],
  ]);
});

test('cancel_lessons：已停的课跳过，全都停过时报错', async () => {
  const seeded = await seed();
  await call(seeded.context, 'cancel_lessons', { scheduleId: seeded.mathMon.id, from: '2026-03-16' });
  const { result } = await call(seeded.context, 'cancel_lessons', {
    scheduleId: seeded.mathMon.id,
    range: 'range',
    from: '2026-03-09',
    to: '2026-03-23',
  });
  assert.equal(result, '已为「高等数学」记 2 次停课');
  assert.deepEqual(await cancelled(seeded.storage), [
    [seeded.mathMon.id, '2026-03-09'],
    [seeded.mathMon.id, '2026-03-16'],
    [seeded.mathMon.id, '2026-03-23'],
  ]);
  await rejectsArg(
    seeded.context,
    'cancel_lessons',
    { scheduleId: seeded.mathMon.id, range: 'range', from: '2026-03-09', to: '2026-03-23' },
    adjustCopy.cancelNothing,
  );
});

test('cancel_lessons：没有 semester_id 的停课记录按排课与日期认作已停，别人的停课记录不算', async () => {
  const seeded = await seed();
  await call(seeded.context, 'cancel_lessons', { scheduleId: seeded.mathMon.id, from: '2026-03-09' });
  const [template] = await reschedules(seeded.storage);
  const events = seeded.storage.collection<EventRow>('events');
  // 导入或同步来的停课记录可能没有学期
  await events.put({ ...template!, semester_id: null });
  // 别人的停课记录，即使同一排课、同一天、同一学期，也不影响本人
  await events.put({ ...template!, id: 'other-cancel', user_id: 'u2', on_date: '2026-03-16' });

  const args = { scheduleId: seeded.mathMon.id, range: 'range', from: '2026-03-09', to: '2026-03-23' };
  const preview = (await call(seeded.context, 'cancel_lessons', args)).preview;
  assert.equal(preview, '停课「高等数学」2026-03-09 至 2026-03-23，共 2 次课');
  const mine = (await reschedules(seeded.storage))
    .filter((row) => row.user_id === USER_ID && row.action === 'cancel')
    .map((row) => [row.ref_schedule_id, row.on_date, row.semester_id])
    .sort((left, right) => String(left[1]).localeCompare(String(right[1])));
  assert.deepEqual(mine, [
    [seeded.mathMon.id, '2026-03-09', null],
    [seeded.mathMon.id, '2026-03-16', seeded.semesterId],
    [seeded.mathMon.id, '2026-03-23', seeded.semesterId],
  ]);
  // 别人的那条原样保留
  assert.equal((await reload(seeded.storage, 'other-cancel')).user_id, 'u2');
  // 都停过了：没有 semester_id 的那条也算
  await rejectsArg(seeded.context, 'cancel_lessons', args, adjustCopy.cancelNothing);
});

test('cancel_lessons：参数不全或没有课可停时抛 AiArgError', async () => {
  const seeded = await seed();
  await rejectsArg(seeded.context, 'cancel_lessons', { courseId: seeded.mathId, from: '2026-03-09' }, '只停一个时段时要给出 scheduleId');
  await rejectsArg(seeded.context, 'cancel_lessons', { target: 'course', from: '2026-03-09' }, '缺少参数 courseId');
  await rejectsArg(seeded.context, 'cancel_lessons', { target: 'course', courseId: 'nope', from: '2026-03-09' }, '找不到课程 nope');
  await rejectsArg(
    seeded.context,
    'cancel_lessons',
    { scheduleId: seeded.mathMon.id, range: 'range', from: '2026-03-09' },
    'range 为 range 时要给出 to',
  );
  await rejectsArg(
    seeded.context,
    'cancel_lessons',
    { scheduleId: seeded.mathMon.id, range: 'range', from: '2026-03-16', to: '2026-03-09' },
    adjustCopy.cancelToBeforeFrom,
  );
  // 周二没有高数
  await rejectsArg(seeded.context, 'cancel_lessons', { scheduleId: seeded.mathMon.id, from: '2026-03-10' }, adjustCopy.cancelNothing);
  await rejectsArg(seeded.context, 'cancel_lessons', { scheduleId: seeded.mathMon.id, from: '2026-08-03' }, /原日期/);
  assert.equal((await liveEvents(seeded.storage)).length, 0);
});

// ---- swap_day ----

test('swap_day：写一条 makeup，星期取原上课日', async () => {
  const seeded = await seed();
  const { preview, result } = await call(seeded.context, 'swap_day', { from: '2026-05-04', to: '2026-05-09' });
  assert.equal(preview, '调休：2026-05-09 上 2026-05-04 的课');
  assert.equal(result, '已记调休：2026-05-09 上 2026-05-04 的课');
  const row = await onlyEvent(seeded.storage);
  assert.equal(row.type, 'makeup');
  assert.equal(row.on_date, '2026-05-09');
  assert.equal(row.as_day_of_week, 1);
  assert.equal(row.semester_id, seeded.semesterId);
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.title, adjustCopy.swapEventTitle('2026-05-04', '2026-05-09'));
});

test('swap_day：日期不在学期内时抛 AiArgError', async () => {
  const seeded = await seed();
  await rejectsArg(seeded.context, 'swap_day', { from: '2026-05-04', to: '2026-08-01' }, /目标上课日/);
  await rejectsArg(seeded.context, 'swap_day', { from: '2026-02-01', to: '2026-05-09' }, /原日期课表/);
  await rejectsArg(seeded.context, 'swap_day', { from: '2026-05-04' }, '缺少参数 to');
  assert.equal((await liveEvents(seeded.storage)).length, 0);
});

// ---- add_extra_lesson ----

async function schedulesOf(storage: Storage, courseId: string): Promise<CourseScheduleRow[]> {
  return (await storage.collection<CourseScheduleRow>('course_schedules').getAll()).filter(
    (row) => row.deleted_at === null && row.course_id === courseId,
  );
}

test('add_extra_lesson：已有课程只加这一周的一次课，结束节默认同起始节', async () => {
  const seeded = await seed();
  const { preview, result } = await call(seeded.context, 'add_extra_lesson', {
    courseId: seeded.englishId,
    date: '2026-03-21',
    periodStart: 3,
  });
  assert.equal(preview, '2026-03-21 第 3 节加一次「大学英语」');
  assert.equal(result, '已在 2026-03-21 加一次「大学英语」');
  const added = (await schedulesOf(seeded.storage, seeded.englishId)).find((row) => row.id !== seeded.englishWed.id);
  assert.ok(added !== undefined);
  assert.equal(added.day_of_week, 6);
  assert.equal(added.period_start, 3);
  assert.equal(added.period_end, 3);
  assert.equal(added.weeks_mask, weeksToMask([3]));
  assert.equal((await listManagedCourses(seeded.storage, seeded.semesterId)).length, 2, '不新建课程');
});

test('add_extra_lesson：给 courseName 时新建课程', async () => {
  const seeded = await seed();
  const { preview } = await call(seeded.context, 'add_extra_lesson', {
    courseName: '形势与政策讲座',
    date: '2026-04-08',
    periodStart: 9,
    periodEnd: 10,
  });
  assert.equal(preview, '2026-04-08 第 9-10 节加一次「形势与政策讲座」（新课程）');
  const course = (await listManagedCourses(seeded.storage, seeded.semesterId)).find((item) => item.name === '形势与政策讲座');
  assert.ok(course !== undefined);
  assert.equal(course.schedules.length, 1);
  assert.deepEqual(course.schedules[0]!.weeks, [6]);
  assert.equal(course.schedules[0]!.dayOfWeek, 3);
  assert.equal(course.schedules[0]!.periodStart, 9);
  assert.equal(course.schedules[0]!.periodEnd, 10);
});

test('add_extra_lesson：同时给 courseId 与 courseName 时用已有课程', async () => {
  const seeded = await seed();
  await call(seeded.context, 'add_extra_lesson', { courseId: seeded.mathId, courseName: '别的名字', date: '2026-03-21', periodStart: 1 });
  const courses = await listManagedCourses(seeded.storage, seeded.semesterId);
  assert.equal(courses.length, 2);
  assert.equal(courses.find((item) => item.id === seeded.mathId)!.schedules.length, 3);
});

test('add_extra_lesson：没有课程、课程不存在或日期越界时抛 AiArgError', async () => {
  const seeded = await seed();
  await rejectsArg(seeded.context, 'add_extra_lesson', { date: '2026-03-21', periodStart: 1 }, adjustCopy.pickExtraCourse);
  await rejectsArg(seeded.context, 'add_extra_lesson', { courseName: '  ', date: '2026-03-21', periodStart: 1 }, adjustCopy.pickExtraCourse);
  await rejectsArg(seeded.context, 'add_extra_lesson', { courseId: 'nope', date: '2026-03-21', periodStart: 1 }, /没有课程 nope/);
  await rejectsArg(seeded.context, 'add_extra_lesson', { courseId: seeded.mathId, date: '2026-08-01', periodStart: 1 }, /2026-03-02/);
  await rejectsArg(
    seeded.context,
    'add_extra_lesson',
    { courseId: seeded.mathId, date: '2026-03-21', periodStart: 3, periodEnd: 2 },
    adjustCopy.invalidPeriods,
  );
  await rejectsArg(seeded.context, 'add_extra_lesson', { courseId: seeded.mathId, date: '2026-03-21' }, '缺少参数 periodStart');
});

// ---- lesson_to_exam ----

test('lesson_to_exam：写一条考试并停掉原来那次课，时刻按作息表', async () => {
  const seeded = await seed();
  const { preview, result } = await call(seeded.context, 'lesson_to_exam', { scheduleId: seeded.mathMon.id, date: '2026-04-20' });
  assert.equal(preview, '2026-04-20 的课改为考试「高等数学」：2026-04-20 08:00-09:40');
  assert.equal(result, '已改为考试「高等数学」');
  const rows = await liveEvents(seeded.storage);
  const exam = rows.find((row) => row.type === 'exam');
  const cancel = rows.find((row) => row.type === 'reschedule');
  assert.equal(rows.length, 2);
  assert.ok(exam !== undefined && cancel !== undefined);
  assert.equal(exam.title, '高等数学');
  assert.equal(exam.subject, seeded.mathId);
  assert.equal(exam.on_date, '2026-04-20');
  assert.equal(exam.start_time, '08:00');
  assert.equal(exam.end_time, '09:40');
  assert.equal(exam.start_at, shanghai('2026-04-20', '08:00'));
  assert.equal(exam.end_at, shanghai('2026-04-20', '09:40'));
  assert.equal(exam.countdown, 1);
  assert.equal(exam.show_in_timetable, 1);
  assert.equal(exam.as_day_of_week, 1);
  assert.equal(cancel.action, 'cancel');
  assert.equal(cancel.ref_schedule_id, seeded.mathMon.id);
  assert.equal(cancel.on_date, '2026-04-20');
  assert.equal(cancel.title, adjustCopy.examRecordTitle('高等数学'));
});

test('lesson_to_exam：可改考试日期、节次、名称与备注；只改起始节时结束节同起始节', async () => {
  const seeded = await seed();
  await call(seeded.context, 'lesson_to_exam', {
    scheduleId: seeded.mathMon.id,
    date: '2026-04-20',
    examDate: '2026-04-22',
    periodStart: 5,
    title: '高数期中',
    note: '带计算器',
  });
  const exam = (await liveEvents(seeded.storage)).find((row) => row.type === 'exam')!;
  assert.equal(exam.title, '高数期中');
  assert.equal(exam.note, '带计算器');
  assert.equal(exam.on_date, '2026-04-22');
  assert.equal(exam.start_time, '14:00');
  assert.equal(exam.end_time, '14:45');
  assert.equal(exam.as_day_of_week, 3);
  const cancel = (await reschedules(seeded.storage))[0]!;
  assert.equal(cancel.on_date, '2026-04-20');
});

test('lesson_to_exam：时刻不依赖显示时区，按学期时区换算', async () => {
  const seeded = await seed('America/New_York');
  await call(seeded.context, 'lesson_to_exam', { scheduleId: seeded.englishWed.id, date: '2026-04-22' });
  const exam = (await liveEvents(seeded.storage)).find((row) => row.type === 'exam')!;
  assert.equal(exam.start_at, shanghai('2026-04-22', '10:00'));
  assert.equal(exam.end_at, shanghai('2026-04-22', '11:40'));
});

test('lesson_to_exam：节次没有作息时间或日期越界时抛 AiArgError', async () => {
  const seeded = await seed();
  await rejectsArg(
    seeded.context,
    'lesson_to_exam',
    { scheduleId: seeded.mathMon.id, date: '2026-04-20', periodStart: 11, periodEnd: 12 },
    adjustCopy.noSlotForPeriods(11, 12),
  );
  await rejectsArg(seeded.context, 'lesson_to_exam', { scheduleId: seeded.mathMon.id, date: '2026-04-20', examDate: '2026-09-01' }, /考试日期/);
  await rejectsArg(seeded.context, 'lesson_to_exam', { scheduleId: 'nope', date: '2026-04-20' }, '找不到排课 nope');
  assert.equal((await liveEvents(seeded.storage)).length, 0);
});

test('lesson_to_exam：原日期那天没有这节课时拒绝', async () => {
  const seeded = await seed();
  // 英语周三 1–16 周：2026-04-20 是周一，2026-06-24 是第 17 周周三
  await rejectsArg(seeded.context, 'lesson_to_exam', { scheduleId: seeded.englishWed.id, date: '2026-04-20' }, '「大学英语」2026-04-20 没有这节课');
  await rejectsArg(seeded.context, 'lesson_to_exam', { scheduleId: seeded.englishWed.id, date: '2026-06-24' }, '「大学英语」2026-06-24 没有这节课');
  assert.equal((await liveEvents(seeded.storage)).length, 0);
  await call(seeded.context, 'lesson_to_exam', { scheduleId: seeded.englishWed.id, date: '2026-06-17' });
  assert.equal((await liveEvents(seeded.storage)).length, 2);
});

// ---- delete_adjustment ----

test('delete_adjustment：删除调课与调休记录', async () => {
  const seeded = await seed();
  await call(seeded.context, 'cancel_lessons', { scheduleId: seeded.mathMon.id, from: '2026-03-09' });
  await call(seeded.context, 'swap_day', { from: '2026-05-04', to: '2026-05-09' });
  const [cancel] = await reschedules(seeded.storage);
  const { preview, result } = await call(seeded.context, 'delete_adjustment', { id: cancel!.id });
  assert.equal(preview, `删除「${adjustCopy.cancelRecordTitle('高等数学')}」（2026-03-09）`);
  assert.equal(result, `已删除「${adjustCopy.cancelRecordTitle('高等数学')}」`);
  assert.notEqual((await reload(seeded.storage, cancel!.id)).deleted_at, null);

  const makeup = (await liveEvents(seeded.storage)).find((row) => row.type === 'makeup')!;
  await call(seeded.context, 'delete_adjustment', { id: makeup.id });
  assert.equal((await liveEvents(seeded.storage)).length, 0);
});

test('delete_adjustment：只接受调课与调休记录', async () => {
  const seeded = await seed();
  const todo = await createOne(seeded, { kind: 'todo', title: '交材料', date: '2026-03-10' });
  const holiday = await createEvent(seeded.storage, {
    userId: USER_ID,
    semesterId: seeded.semesterId,
    type: 'holiday',
    title: '劳动节',
    onDate: '2026-05-01',
  });
  await rejectsArg(seeded.context, 'delete_adjustment', { id: todo.id }, `${todo.id} 不是调课、停课或调休记录`);
  await rejectsArg(seeded.context, 'delete_adjustment', { id: String(holiday['id']) }, `${String(holiday['id'])} 不是调课、停课或调休记录`);
  await rejectsArg(seeded.context, 'delete_adjustment', { id: 'nope' }, '找不到调整记录 nope');

  await call(seeded.context, 'swap_day', { from: '2026-05-04', to: '2026-05-09' });
  const makeup = (await liveEvents(seeded.storage)).find((row) => row.type === 'makeup')!;
  await call(seeded.context, 'delete_adjustment', { id: makeup.id });
  await rejectsArg(seeded.context, 'delete_adjustment', { id: makeup.id }, `找不到调整记录 ${makeup.id}`);
  await rejectsArg(seeded.context, 'delete_adjustment', { id: makeup.id }, `找不到调整记录 ${makeup.id}`);
  assert.equal((await reload(seeded.storage, todo.id)).deleted_at, null);
});
