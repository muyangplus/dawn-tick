import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '@dawn-tick/core';
import {
  WIDGET_TRANSPARENT_ALPHA,
  buildWidgetColors,
  buildWidgetSnapshot,
  buildWidgetSurface,
  withAlpha,
} from '../src/widget-snapshot.ts';
import { PRESETS } from '../src/design/tokens.ts';
import type { AppData, LessonCell } from '../src/data.ts';

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    timeZone: 'Asia/Shanghai',
    today: '2026-09-21',
    todayOfWeek: 1,
    week: 3,
    viewWeek: 3,
    weekStartDate: '2026-09-21',
    semester: null,
    semesters: [],
    slots: [],
    grid: new Map(),
    todayLessons: [],
    currentLesson: undefined,
    nextLesson: undefined,
    exams: [],
    todos: [],
    reschedules: [],
    ...overrides,
  };
}

const lesson = {
  scheduleId: 's-1',
  courseId: 'c-1',
  courseName: '高等数学',
  room: '教三-201',
  color: '#4F8DFD',
  date: '2026-09-21',
  periodStart: 1,
  periodEnd: 2,
  startAt: 1790000000000,
  endAt: 1790003600000,
  cancelled: false,
};

const cell: LessonCell = {
  scheduleId: 's-1',
  courseId: 'c-1',
  name: '高数',
  teacher: '张老师',
  room: '教三-201',
  color: '#4F8DFD',
  dayOfWeek: 1,
  periodStart: 1,
  periodEnd: 2,
  startTime: '08:00',
  endTime: '09:40',
  inWeek: true,
  holiday: false,
  cancelled: false,
};

test('无课时的快照', () => {
  const snapshot = buildWidgetSnapshot(appData(), DEFAULT_SETTINGS, 42);
  assert.equal(snapshot.updatedAt, 42);
  assert.equal(snapshot.week, 3);
  assert.equal(snapshot.timeZone, 'Asia/Shanghai');
  assert.equal(snapshot.background, 'light');
  assert.equal(snapshot.current, null);
  assert.equal(snapshot.next, null);
  assert.deepEqual(snapshot.today, []);
  assert.deepEqual(snapshot.grid, []);
  assert.deepEqual(snapshot.exams, []);
});

test('正在上课时快照给出 current 与剩余时间', () => {
  const snapshot = buildWidgetSnapshot(
    appData({ currentLesson: lesson, nextLesson: { ...lesson, courseName: '大学物理' } }),
    DEFAULT_SETTINGS,
    9,
  );
  assert.equal(snapshot.current?.title, '高等数学');
  assert.equal(snapshot.current?.endsAt, lesson.endAt);
  assert.equal(snapshot.next?.title, '大学物理');
});

test('有课时快照包含下一节、今日列表与周网格', () => {
  const data = appData({
    todayLessons: [lesson, { ...lesson, scheduleId: 's-2', courseName: '大学物理', room: null }],
    nextLesson: lesson,
    grid: new Map([['1:1', [cell]]]),
  });
  const snapshot = buildWidgetSnapshot(data, { ...DEFAULT_SETTINGS, widgetBackground: 'transparent' }, 7);

  assert.equal(snapshot.next?.title, '高等数学');
  assert.equal(snapshot.next?.room, '教三-201');
  assert.equal(snapshot.next?.startsAt, lesson.startAt);
  assert.equal(snapshot.today.length, 2);
  assert.equal(snapshot.today[1]?.room, null);
  assert.equal(snapshot.background, 'transparent');
  assert.equal(snapshot.grid.length, 1);
  assert.equal(snapshot.grid[0]?.title, '高数');
  assert.equal(snapshot.grid[0]?.periodEnd, 2);
  assert.equal(snapshot.grid[0]?.cancelled, false);
});

test('考试写入快照', () => {
  const data = appData({
    exams: [
      {
        id: 'e-1',
        user_id: 'u1',
        semester_id: 'sem-1',
        parent_id: null,
        type: 'exam',
        title: '高等数学期末',
        on_date: '2027-01-05',
        start_at: 1790000000000,
        end_at: null,
        all_day: 0,
        location: '教三-201',
        note: null,
        done: 0,
        priority: null,
        due_at: null,
        subject: '高等数学',
        seat_no: null,
        ref_schedule_id: null,
        action: null,
        new_date: null,
        new_period_start: null,
        new_period_end: null,
        new_room: null,
        as_day_of_week: null,
        source: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
        rev: 0,
        dirty: 0,
      },
    ],
  });
  const snapshot = buildWidgetSnapshot(data, DEFAULT_SETTINGS, 1);
  assert.equal(snapshot.exams.length, 1);
  assert.equal(snapshot.exams[0]?.title, '高等数学期末');
  assert.equal(snapshot.exams[0]?.date, '2027-01-05');
});

test('快照可被 JSON 序列化并原样还原', () => {
  const data = appData({ todayLessons: [lesson], nextLesson: lesson, grid: new Map([['1:1', [cell]]]) });
  const snapshot = buildWidgetSnapshot(data, DEFAULT_SETTINGS, 1);
  const restored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  assert.deepEqual(restored, snapshot);
});

test('不显示周末时一周概览的快照不含周六日课程', () => {
  const saturday: LessonCell = { ...cell, scheduleId: 's-6', dayOfWeek: 6, date: '2026-09-26' };
  const sunday: LessonCell = { ...cell, scheduleId: 's-7', dayOfWeek: 7, date: '2026-09-27' };
  const data = appData({
    grid: new Map([
      ['2026-09-21:1', [cell]],
      ['2026-09-26:1', [saturday]],
      ['2026-09-27:1', [sunday]],
    ]),
  });

  const hidden = buildWidgetSnapshot(data, { ...DEFAULT_SETTINGS, hideWeekends: true }, 1);
  assert.deepEqual([...new Set(hidden.grid.map((item) => item.dayOfWeek))].sort(), [1]);

  // 关掉「不显示周末」后周末课程照常进快照（默认值已改为开，这里显式关掉）
  const shown = buildWidgetSnapshot(data, { ...DEFAULT_SETTINGS, hideWeekends: false }, 1);
  assert.equal(shown.grid.length, 3);
});

test('快照携带设计令牌语义色（含卡面底色与强调色）', () => {
  const snapshot = buildWidgetSnapshot(appData(), DEFAULT_SETTINGS, 1);
  assert.deepEqual(snapshot.colors, {
    ink: PRESETS.vivid.light.text,
    muted: PRESETS.vivid.light.muted,
    surface: PRESETS.vivid.light.surface,
    accent: PRESETS.vivid.light.primaryStrong,
    danger: PRESETS.vivid.light.dangerStrong,
  });
});

test('深色底取暗色令牌、浅色底取亮色令牌', () => {
  const dark = buildWidgetSnapshot(appData(), { ...DEFAULT_SETTINGS, widgetBackground: 'dark' }, 1);
  assert.equal(dark.colors?.ink, PRESETS.vivid.dark.text);
  assert.equal(dark.colors?.muted, PRESETS.vivid.dark.muted);
  assert.equal(dark.colors?.surface, PRESETS.vivid.dark.surface);
  assert.equal(dark.colors?.accent, PRESETS.vivid.dark.primaryStrong);

  const light = buildWidgetSnapshot(
    appData(),
    { ...DEFAULT_SETTINGS, widgetBackground: 'light', theme: 'dark' },
    1,
  );
  assert.equal(light.colors?.ink, PRESETS.vivid.light.text);
  assert.equal(light.colors?.surface, PRESETS.vivid.light.surface);
});

test('透明底与主题预设都会影响快照配色', () => {
  const transparent = buildWidgetSnapshot(
    appData(),
    { ...DEFAULT_SETTINGS, widgetBackground: 'transparent', theme: 'dark' },
    1,
  );
  assert.equal(transparent.colors?.ink, PRESETS.vivid.dark.text);
  // 透明底只在预设 surface 上降低不透明度，色相仍随主题
  assert.equal(
    transparent.colors?.surface,
    withAlpha(PRESETS.vivid.dark.surface, WIDGET_TRANSPARENT_ALPHA),
  );

  const mono = buildWidgetSnapshot(appData(), { ...DEFAULT_SETTINGS, themePreset: 'mono' }, 1);
  assert.equal(mono.colors?.ink, PRESETS.mono.light.text);
  assert.equal(mono.colors?.surface, PRESETS.mono.light.surface);
  assert.equal(mono.colors?.accent, PRESETS.mono.light.primaryStrong);
});

test('四套主题预设的卡面与强调色都来自各自令牌', () => {
  for (const preset of ['vivid', 'fresh', 'mono', 'muted'] as const) {
    const colors = buildWidgetColors({ ...DEFAULT_SETTINGS, themePreset: preset });
    const tokens = PRESETS[preset].light;
    assert.equal(colors.surface, tokens.surface, `${preset} surface`);
    assert.equal(colors.ink, tokens.text, `${preset} ink`);
    assert.equal(colors.muted, tokens.muted, `${preset} muted`);
    assert.equal(colors.accent, tokens.primaryStrong, `${preset} accent`);
    assert.equal(colors.danger, tokens.dangerStrong, `${preset} danger`);
  }
});

test('透明底 surface 补 alpha，产出 Android 可解析的 #AARRGGBB', () => {
  assert.equal(buildWidgetSurface('light', '#FFFFFF'), '#FFFFFF');
  assert.equal(buildWidgetSurface('dark', '#1E1A26'), '#1E1A26');
  assert.equal(buildWidgetSurface('transparent', '#FFFFFF'), '#8CFFFFFF');
  assert.match(buildWidgetSurface('transparent', '#1E1A26'), /^#8C1E1A26$/);
  assert.equal(withAlpha('#FF6B4A', 1), '#FFFF6B4A');
  assert.equal(withAlpha('#FF6B4A', 0), '#00FF6B4A');
});

/**
 * Kotlin 无法在 Node 侧编译，这里对渲染器的取色顺序做静态断言：
 * 快照色优先、旧快照只有 danger 时按同一槽位回退、整组缺失时回退内置常量。
 */
test('Kotlin 渲染器优先快照色，缺失 colors 时回退常量', () => {
  const renderer = readFileSync(
    new URL(
      '../../mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetRenderer.kt',
      import.meta.url,
    ),
    'utf8',
  );
  const store = readFileSync(
    new URL(
      '../../mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetStore.kt',
      import.meta.url,
    ),
    'utf8',
  );

  // 快照字段齐全：正文/次要/强调/卡面都从快照读
  assert.match(renderer, /parseColor\(colors\?\.ink\) \?: fallback\.ink/);
  assert.match(renderer, /parseColor\(colors\?\.muted\) \?: fallback\.muted/);
  assert.match(renderer, /parseColor\(colors\?\.accent\) \?: parseColor\(colors\?\.danger\) \?: fallback\.accent/);
  assert.match(renderer, /val surface = parseColor\(colors\?\.surface\) \?: fallback\.surface/);
  assert.match(renderer, /views\.setInt\(R\.id\.widget_surface, "setBackgroundColor", surface\)/);
  // RemoteViews 没有 setBackgroundResource：旧快照也走 setBackgroundColor + 回退色
  assert.ok(!/views\.setBackgroundResource\(/.test(renderer), 'RemoteViews 不支持 setBackgroundResource');
  // 回退常量仍在
  for (const constant of [
    'INK_LIGHT',
    'MUTED_LIGHT',
    'ACCENT_LIGHT',
    'INK_DARK',
    'MUTED_DARK',
    'ACCENT_DARK',
    'SURFACE_LIGHT',
    'SURFACE_DARK',
  ]) {
    assert.ok(renderer.includes(constant), `缺少回退常量 ${constant}`);
  }
  // Kotlin 读取端与 TS 契约同名
  for (const key of ['ink', 'muted', 'surface', 'accent', 'danger']) {
    assert.match(store, new RegExp(`optString\\("${key}"\\)`), `WidgetStore 未读取 ${key}`);
  }
});
