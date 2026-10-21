import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppData, LessonCell } from '../src/data.ts';
import {
  bodyRangeOf,
  beginLessonPress,
  clashLabel,
  clashingLessons,
  dragRows,
  emptyDragEdgeOf,
  firstClash,
  lessonDraggable,
  lessonDropChanged,
  lessonDropPeriod,
  lessonLongPress,
  lessonPressMove,
  lessonTouchAction,
  periodAt,
  resizeEmptyRange,
  stepEmptyRange,
  wheelRangeOf,
  type EmptyDragState,
} from '../src/screens/timetable/drag-session.ts';

function cell(overrides: Partial<LessonCell> & Pick<LessonCell, 'date' | 'periodStart' | 'periodEnd'>): LessonCell {
  return {
    scheduleId: 'sch-1',
    courseId: 'course-1',
    name: '高数',
    teacher: null,
    room: null,
    color: '#4F8DFD',
    dayOfWeek: 1,
    startTime: '08:00',
    endTime: '09:40',
    inWeek: true,
    holiday: false,
    cancelled: false,
    movedOut: false,
    movedIn: false,
    lab: false,
    ...overrides,
  };
}

/** 只给碰撞判定用的最小 AppData：函数只读 grid 与 courses */
function appData(cells: LessonCell[], courses: { id: string; name: string }[]): AppData {
  const grid = new Map<string, LessonCell[]>();
  for (const item of cells) {
    const key = `${item.date}:${item.periodStart}`;
    grid.set(key, [...(grid.get(key) ?? []), item]);
  }
  return { grid, courses } as unknown as AppData;
}

test('lessonDraggable / lessonTouchAction：只有参与拖动的卡片才吃手势，其余留纵向滚动', () => {
  const base = cell({ date: '2026-03-02', periodStart: 1, periodEnd: 2 });
  assert.equal(lessonDraggable(base), true);
  assert.equal(lessonTouchAction(base), 'none');
  // 停课、已调课、调课落点、实验、非本周都不参与拖动，页面要能照常滚
  for (const overrides of [
    { cancelled: true },
    { movedOut: true },
    { movedIn: true },
    { lab: true },
    { inWeek: false },
  ] as const) {
    const lesson = { ...base, ...overrides };
    assert.equal(lessonDraggable(lesson), false);
    assert.equal(lessonTouchAction(lesson), 'pan-y');
  }
  // 停课优先于其它状态：依然不可拖
  assert.equal(lessonDraggable({ ...base, cancelled: true, inWeek: false }), false);
});

test('beginLessonPress / lessonLongPress：按下不算拖动，长按只生效一次', () => {
  const press = beginLessonPress({ pointerId: 3, pointerType: 'touch', x: 100, y: 100 });
  assert.equal(press.pointerId, 3);
  assert.equal(press.pointerType, 'touch');
  assert.equal(press.active, false);
  assert.equal(press.captured, false);
  assert.equal(lessonLongPress(press), true);
  assert.equal(lessonLongPress({ ...press, active: true }), false);
  // 拿不到 pointerType（如 jsdom）时按鼠标/触控笔处理
  assert.equal(beginLessonPress({ pointerId: 1, pointerType: undefined, x: 0, y: 0 }).pointerType, 'pointer');
});

test('lessonPressMove：touch 抖动取消长按，鼠标越过阈值直接开拖，拖动后移动才捕获', () => {
  const touch = beginLessonPress({ pointerId: 1, pointerType: 'touch', x: 100, y: 100 });
  // 抖动不超过阈值：继续等长按
  assert.deepEqual(lessonPressMove(touch, 104, 104), { outcome: 'ignore', capture: false });
  // 触屏越过阈值：这一下按滑动处理，取消长按
  assert.deepEqual(lessonPressMove(touch, 100, 120), { outcome: 'cancel', capture: false });

  // 鼠标：越过阈值立即进入拖动，并在同一拍请求捕获（拖动入口不再被长按计时器卡住）
  const mouse = beginLessonPress({ pointerId: 2, pointerType: 'mouse', x: 100, y: 100 });
  assert.deepEqual(lessonPressMove(mouse, 100, 120), { outcome: 'activate', capture: true });
  assert.deepEqual(lessonPressMove({ ...mouse, active: true }, 100, 120), { outcome: 'ignore', capture: true });
  // 已捕获后不再重复请求
  assert.deepEqual(lessonPressMove({ ...mouse, active: true, captured: true }, 100, 120), {
    outcome: 'ignore',
    capture: false,
  });
});

test('lessonDropChanged：同一天同一节松手不算调整', () => {
  const lesson = { date: '2026-03-02', periodStart: 3 };
  assert.equal(lessonDropChanged(lesson, '2026-03-02', 3), false);
  assert.equal(lessonDropChanged(lesson, '2026-03-02', 4), true);
  assert.equal(lessonDropChanged(lesson, '2026-03-03', 3), true);
});

test('periodAt：按列高换算节次，越界夹到首尾节', () => {
  // 列顶 100，行高 60，无补白：100→1 节，160→2 节
  assert.equal(periodAt(100, 100, 12, 60), 1);
  assert.equal(periodAt(159, 100, 12, 60), 1);
  assert.equal(periodAt(160, 100, 12, 60), 2);
  assert.equal(periodAt(50, 100, 12, 60), 1);
  assert.equal(periodAt(100_000, 100, 12, 60), 12);
  // 头部补白会整体下移可落点范围
  assert.equal(periodAt(160, 100, 12, 60, 30), 1);
});

test('dragRows：按行高四舍五入，正数向下', () => {
  assert.equal(dragRows(100, 100, 60), 0);
  assert.equal(dragRows(100, 129, 60), 0);
  assert.equal(dragRows(100, 130, 60), 1);
  assert.equal(dragRows(100, 100 - 70, 60), -1);
  assert.equal(dragRows(100, 100 - 130, 60), -2);
});

test('emptyDragEdgeOf：滚轮条与单节取 both，其余按按住的上半/下半取边', () => {
  const bounds = { top: 100, height: 60 };
  const single = { date: '2026-03-02', start: 3, end: 3 };
  const multi = { date: '2026-03-02', start: 3, end: 5 };
  assert.equal(emptyDragEdgeOf(bounds, 110, single, 'body'), 'both');
  assert.equal(emptyDragEdgeOf(bounds, 110, multi, 'wheel'), 'both');
  assert.equal(emptyDragEdgeOf(bounds, 110, multi, 'body'), 'top');
  assert.equal(emptyDragEdgeOf(bounds, 140, multi, 'body'), 'bottom');
  assert.equal(emptyDragEdgeOf(bounds, 130, multi, 'select'), 'bottom');
});

test('stepEmptyRange：向下扩结束节，向上收起始节，夹在 1–总节数', () => {
  const target = { date: '2026-03-02', start: 2, end: 3 };
  assert.deepEqual(stepEmptyRange(target, 1, 12), { date: '2026-03-02', start: 2, end: 4 });
  assert.deepEqual(stepEmptyRange(target, -1, 12), { date: '2026-03-02', start: 1, end: 3 });
  // 起始已到 1：向上不再动
  assert.deepEqual(stepEmptyRange({ ...target, start: 1 }, -1, 12), { date: '2026-03-02', start: 1, end: 3 });
  // 结束已到总节数：向下不再动
  assert.deepEqual(stepEmptyRange({ ...target, end: 12 }, 1, 12), { date: '2026-03-02', start: 2, end: 12 });
  // 一次扩很多节也被夹住
  assert.deepEqual(stepEmptyRange(target, 99, 12), { date: '2026-03-02', start: 2, end: 12 });
});

test('resizeEmptyRange：没有变化时返回 null', () => {
  const target = { date: '2026-03-02', start: 2, end: 3 };
  assert.deepEqual(resizeEmptyRange(target, 1, 12), { date: '2026-03-02', start: 2, end: 4 });
  assert.deepEqual(resizeEmptyRange(target, -1, 12), { date: '2026-03-02', start: 2, end: 2 });
  // 已收到起始节：再收没有变化
  assert.equal(resizeEmptyRange({ ...target, end: 2 }, -1, 12), null);
  // 已到最后一节：再扩没有变化
  assert.equal(resizeEmptyRange({ ...target, end: 12 }, 1, 12), null);
});

function dragState(overrides: Partial<EmptyDragState> = {}): EmptyDragState {
  return {
    pointerId: 1,
    mode: 'wheel',
    edge: 'both',
    startY: 100,
    startPeriod: 4,
    endPeriod: 5,
    moved: false,
    ...overrides,
  };
}

test('wheelRangeOf：整段平移并夹在 1–总节数', () => {
  const active = dragState();
  assert.deepEqual(wheelRangeOf(active, 1, 12), { start: 5, end: 6 });
  assert.deepEqual(wheelRangeOf(active, -2, 12), { start: 2, end: 3 });
  // 起点已到 1：整段被压到 1（两端一起平移，越界后收成一节）
  assert.deepEqual(wheelRangeOf(dragState({ startPeriod: 1, endPeriod: 2 }), -3, 12), { start: 1, end: 1 });
  // 末端已到总节数：结束节被夹住
  assert.deepEqual(wheelRangeOf(dragState({ startPeriod: 11, endPeriod: 12 }), 5, 12), { start: 12, end: 12 });
});

test('bodyRangeOf：按边伸缩，单节时上下都扩', () => {
  const active = dragState({ mode: 'body' });
  // 上边跟着指针：结束节不动
  assert.deepEqual(bodyRangeOf({ ...active, edge: 'top' }, -2, 12), { start: 2, end: 5 });
  // 下边跟着指针：起始节不动
  assert.deepEqual(bodyRangeOf({ ...active, edge: 'bottom' }, 2, 12), { start: 4, end: 7 });
  // 单节（both）：向哪边都能扩
  assert.deepEqual(bodyRangeOf({ ...active, edge: 'both', startPeriod: 4, endPeriod: 4 }, 3, 12), {
    start: 4,
    end: 7,
  });
  assert.deepEqual(bodyRangeOf({ ...active, edge: 'both', startPeriod: 4, endPeriod: 4 }, -3, 12), {
    start: 1,
    end: 4,
  });
});

test('lessonDropPeriod：整段课要放得进窗口，越界夹回', () => {
  const lesson = cell({ date: '2026-03-02', periodStart: 1, periodEnd: 2 });
  assert.equal(lessonDropPeriod(1, lesson, 12), 1);
  assert.equal(lessonDropPeriod(5, lesson, 12), 5);
  assert.equal(lessonDropPeriod(0, lesson, 12), 1);
  // 两节的课放到最后一节：起始节最多到 11
  assert.equal(lessonDropPeriod(12, lesson, 12), 11);
});

test('clashingLessons / firstClash：按日期与节次判重叠，同一门课只算一次', () => {
  const date = '2026-03-02';
  const data = appData(
    [
      cell({ date, periodStart: 1, periodEnd: 2 }),
      cell({ date, periodStart: 3, periodEnd: 4, scheduleId: 'sch-2', courseId: 'course-2', name: '英语' }),
      // 非本周的虚线课不参与
      cell({ date, periodStart: 5, periodEnd: 6, scheduleId: 'sch-3', inWeek: false }),
      // 别的日期不参与
      cell({ date: '2026-03-03', periodStart: 1, periodEnd: 2, scheduleId: 'sch-4' }),
    ],
    [
      { id: 'course-1', name: '高等数学' },
      { id: 'course-2', name: '大学英语' },
    ],
  );
  assert.equal(clashingLessons(data, date, 1, 2).length, 1);
  // 1–4 节同时压到两门课
  assert.equal(clashingLessons(data, date, 1, 4).length, 2);
  assert.equal(clashingLessons(data, date, 5, 6).length, 0);
  assert.equal(clashingLessons(data, '2026-03-04', 1, 2).length, 0);

  const clash = firstClash(data, date, 3, 4);
  assert.deepEqual(clash, { name: '大学英语', start: 3, end: 4 });
  assert.equal(firstClash(data, date, 9, 10), null);
  assert.equal(clashLabel({ name: '大学英语', start: 3, end: 4 }), '与「大学英语」第 3–4 节重叠');
});
