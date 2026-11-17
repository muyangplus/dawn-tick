import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  dayOfWeek,
  isWeekend,
  type AppSettings,
  type SemesterRow,
  type TimeSlotRow,
} from '@dawn-tick/core';
import type { AppData, LessonCell } from '../src/data.ts';
import { courseTextOn, courseTint, resolveTokens } from '../src/design/tokens.ts';
import {
  buildTimetableImageModel,
  renderTimetablePng,
  timetableFileName,
  type TimetableCanvasFactory,
  type TimetableImageModel,
} from '../src/lib/timetable-image.ts';

const WEEK_START = '2026-10-19';
const PERIODS: TimeSlotRow[] = [
  { period_no: 1, start_time: '08:00', end_time: '08:45' },
  { period_no: 2, start_time: '08:50', end_time: '09:35' },
  { period_no: 3, start_time: '09:40', end_time: '10:25' },
  { period_no: 4, start_time: '10:30', end_time: '11:15' },
].map((slot) => ({
  ...slot,
  id: `slot-${slot.period_no}`,
  semester_id: 'sem-1',
  label: null,
  section: null,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
  rev: 1,
  dirty: 0,
}));

const SEMESTER: SemesterRow = {
  id: 'sem-1',
  user_id: 'u1',
  name: '2026-2027 第一学期',
  start_date: '2026-09-07',
  total_weeks: 20,
  time_zone: 'Asia/Shanghai',
  is_active: 1,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
  rev: 1,
  dirty: 0,
};

function lesson(overrides: Partial<LessonCell> = {}): LessonCell {
  return {
    scheduleId: 's-1',
    courseId: 'c-1',
    name: '高等数学',
    teacher: '张老师',
    room: '教三-201',
    color: '#3366FF',
    dayOfWeek: 1,
    date: '2026-10-19',
    periodStart: 1,
    periodEnd: 2,
    startTime: '08:00',
    endTime: '09:35',
    inWeek: true,
    holiday: false,
    cancelled: false,
    movedOut: false,
    movedIn: false,
    lab: false,
    ...overrides,
  };
}

function appData(overrides: Partial<AppData> = {}, cells: readonly LessonCell[] = []): AppData {
  const grid = new Map<string, LessonCell[]>();
  for (const cell of cells) {
    const key = `${cell.date}:${cell.periodStart}`;
    grid.set(key, [...(grid.get(key) ?? []), cell]);
  }
  return {
    timeZone: 'Asia/Shanghai',
    today: '2026-10-21',
    todayOfWeek: 3,
    week: 7,
    viewWeek: 7,
    weekStartDate: WEEK_START,
    windowStart: WEEK_START,
    windowDates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
    windowSpansWeeks: false,
    hasLessons: cells.length > 0,
    courses: [],
    lessonsByDate: new Map(),
    holidayLabels: new Map(),
    workdayDates: [],
    semester: SEMESTER,
    semesters: [SEMESTER],
    slots: PERIODS,
    grid,
    todayLessons: [],
    todoSort: 'start',
    tomorrowLessons: [],
    currentLesson: undefined,
    nextLesson: undefined,
    exams: [],
    todos: [],
    labs: [],
    countdowns: [],
    reschedules: [],
    ...overrides,
  };
}

function model(
  settings: Partial<AppSettings> = {},
  cells: readonly LessonCell[] = [],
  data: AppData = appData({}, cells),
): TimetableImageModel {
  return buildTimetableImageModel({
    data,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    weekStart: WEEK_START,
  });
}

test('7 天周视图：列、标题、节次行与课程卡几何完整', () => {
  const result = model({ viewDays: 7, hideWeekends: false }, [
    lesson(),
    lesson({
      scheduleId: 's-2',
      courseId: 'c-2',
      name: '线性代数',
      room: '理科楼-105',
      teacher: '李老师',
      color: '#2F80ED',
      date: '2026-10-21',
      dayOfWeek: 3,
      periodStart: 3,
      periodEnd: 4,
      startTime: '09:40',
      endTime: '11:15',
    }),
  ]);

  assert.deepEqual(
    result.columns.map((column) => column.date),
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'],
  );
  assert.deepEqual(
    result.columns.map((column) => column.weekdayLabel),
    ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  );
  assert.equal(result.title, '2026-2027 第一学期');
  assert.equal(result.subtitle, '第 7 周 · 10/19–25');
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[0]?.periodNo, 1);
  assert.equal(result.rows[0]?.startTime, '08:00');
  assert.equal(result.rows[3]?.endTime, '11:15');
  assert.equal(result.empty, false);
  assert.equal(result.cards.length, 2);
  assert.equal(result.scale, 2);
  assert.equal(result.pixelWidth, result.width * 2);
  assert.equal(result.pixelHeight, result.height * 2);

  const first = result.cards[0] as (typeof result.cards)[number];
  assert.equal(first.name, '高等数学');
  assert.equal(first.room, '教三-201');
  assert.equal(first.teacher, '张老师');
  assert.equal(first.timeLabel, '08:00–09:35');
  assert.equal(first.color, '#3366FF');
  assert.equal(first.tint, courseTint(result.tokens.surface, '#3366FF', 0.18));
  assert.equal(first.textColor, courseTextOn(first.tint));
  const columnWidth = (result.width - result.layout.padding * 2 - result.layout.axisWidth) / 7;
  assert.equal(first.x, (result.columns[0]?.x ?? 0) + 4);
  assert.equal(first.width, columnWidth - 8);
  assert.equal(first.height, 2 * result.layout.rowHeight - 8);
  assert.equal(first.y, result.layout.gridTop + 4);
  assert.equal(first.dashed, false);
  assert.equal(first.muted, false);
});

test('5 天并隐藏周末：只取周一到周五，标题带周次与日期范围', () => {
  const result = model({ viewDays: 5, hideWeekends: true });
  assert.equal(result.columns.length, 5);
  assert.ok(result.columns.every((column) => !isWeekend(column.date) && dayOfWeek(column.date) <= 5));
  assert.equal(result.columns[0]?.date, '2026-10-19');
  assert.equal(result.columns[4]?.date, '2026-10-23');
  assert.equal(result.subtitle, '第 7 周 · 10/19–23');
  assert.equal(result.empty, true);
  assert.equal(result.emptyText, '这周没有课程');
});

test('7 天但隐藏周末：跨到下一周的 7 个工作日，标题写第 7–8 周', () => {
  const result = model({ viewDays: 7, hideWeekends: true });
  assert.equal(result.columns.length, 7);
  assert.ok(result.columns.every((column) => !isWeekend(column.date)));
  assert.equal(result.columns[5]?.date, '2026-10-26');
  assert.equal(result.columns[6]?.date, '2026-10-27');
  assert.equal(result.subtitle, '第 7–8 周 · 10/19–27');
});

test('无课空态：保留节次网格并给出空态文案', () => {
  const result = model({ viewDays: 5, hideWeekends: true });
  assert.equal(result.cards.length, 0);
  assert.equal(result.empty, true);
  assert.equal(result.rows.length, 4);
  assert.equal(result.layout.gridHeight, 4 * result.layout.rowHeight);
});

test('没有学期：标题退到「课表」，不抛错', () => {
  const data = appData({ semester: null, semesters: [], slots: [], grid: new Map() });
  const result = model({}, [], data);
  assert.equal(result.title, '课表');
  assert.equal(result.subtitle, '还没有设置学期');
  assert.equal(result.emptyText, '还没有学期，先创建学期再导出课表');
  assert.equal(result.rows.length, 0);
  assert.ok(result.layout.gridHeight > 0);
});

test('非本周课程按「显示非本周课程」设置进出，并画虚线', () => {
  const ghost = lesson({ inWeek: false, name: '大学物理' });
  const hidden = model({ showOtherWeeks: false }, [ghost]);
  assert.equal(hidden.cards.length, 0);
  assert.equal(hidden.empty, true);

  const shown = model({ showOtherWeeks: true }, [ghost]);
  assert.equal(shown.cards.length, 1);
  assert.equal(shown.cards[0]?.dashed, true);
  assert.equal(shown.cards[0]?.muted, true);
});

test('停课与放假：停课标「停课」用虚线，放假列带假期名且课程灰显', () => {
  const result = model({}, [
    lesson({ cancelled: true, holiday: true, name: '停课课' }),
  ]);
  assert.equal(result.cards[0]?.status, '停课');
  assert.equal(result.cards[0]?.dashed, true);
  assert.equal(result.cards[0]?.muted, true);

  const holiday = model({}, [lesson({ holiday: true, name: '放假课' })]);
  const data = appData({ holidayLabels: new Map([['2026-10-19', '国庆节']]) }, [
    lesson({ holiday: true, name: '放假课' }),
  ]);
  const holidayModel = model({}, [], data);
  assert.equal(holiday.columns[0]?.holidayName, null);
  assert.equal(holidayModel.columns[0]?.holidayName, '国庆节');
  assert.equal(holidayModel.cards[0]?.muted, true);
});

test('坏色值退回主题主色，不让整页绘制失败', () => {
  const result = model({}, [lesson({ color: 'not-a-color' })]);
  assert.equal(result.cards[0]?.color, resolveTokens(DEFAULT_SETTINGS.themePreset, 'light').primary);
});

function fakeCanvas(): {
  factory: TimetableCanvasFactory;
  calls: { scale: Array<[number, number]>; fillRect: number; imageData: Array<[number, number, number, number]> };
  size: () => [number, number] | null;
} {
  const calls = {
    scale: [] as Array<[number, number]>,
    fillRect: 0,
    imageData: [] as Array<[number, number, number, number]>,
  };
  let size: [number, number] | null = null;
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    scale: (x: number, y: number) => {
      calls.scale.push([x, y]);
    },
    fillRect: () => {
      calls.fillRect += 1;
    },
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    setLineDash: () => {},
    measureText: (value: string) => ({ width: value.length * 8 }),
    fillText: () => {},
    getImageData: (x: number, y: number, width: number, height: number) => {
      calls.imageData.push([x, y, width, height]);
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    },
  };
  const factory: TimetableCanvasFactory = (width, height) => {
    size = [width, height];
    return { width, height, getContext: (id) => (id === '2d' ? (context as unknown as CanvasRenderingContext2D) : null) };
  };
  return { factory, calls, size: () => size };
}

function chunkData(png: Uint8Array, type: string): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const found = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (found === type) return png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  throw new Error(`PNG 缺少 ${type} 数据块`);
}

test('PNG 渲染：按 2x DPR 建画布，输出合法的 RGB PNG', async () => {
  const result = model({ viewDays: 5, hideWeekends: true }, [lesson()]);
  const canvas = fakeCanvas();
  const png = await renderTimetablePng(result, { canvasFactory: canvas.factory });

  assert.deepEqual(canvas.size(), [result.pixelWidth, result.pixelHeight]);
  assert.deepEqual(canvas.calls.scale, [[2, 2]]);
  assert.ok(canvas.calls.fillRect > 10, `fillRect 调用 ${canvas.calls.fillRect} 次`);
  assert.deepEqual(canvas.calls.imageData, [[0, 0, result.pixelWidth, result.pixelHeight]]);

  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16), result.pixelWidth);
  assert.equal(view.getUint32(20), result.pixelHeight);
  assert.equal(png[24], 8, '位深 8');
  assert.equal(png[25], 2, 'RGB 真彩色');
  assert.deepEqual([...png.subarray(png.length - 12)], [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

  const raw = new Uint8Array(
    await new Response(
      new Blob([chunkData(png, 'IDAT').slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer(),
  );
  assert.equal(raw.length, result.pixelHeight * (1 + result.pixelWidth * 3));
  for (let y = 0; y < result.pixelHeight; y += 1) {
    assert.equal(raw[y * (1 + result.pixelWidth * 3)], 0, `第 ${y} 行 filter 为 0`);
  }
});

test('Canvas 不可用时抛出可读原因', async () => {
  const result = model({});
  await assert.rejects(() => renderTimetablePng(result, { canvasFactory: () => null }), /Canvas/);
});

test('文件名按 DawnTick-学期名-日期 生成并清理保留字符', () => {
  const stamp = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(timetableFileName('2026-2027 第一学期', 'png', stamp), 'DawnTick-2026-2027 第一学期-2026-10-21.png');
  assert.equal(timetableFileName('A/B:C*?"<>|', 'pdf', stamp), 'DawnTick-ABC-2026-10-21.pdf');
  assert.equal(timetableFileName(null, 'pdf', stamp), 'DawnTick-课表-2026-10-21.pdf');
});
