import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type SemesterRow,
  type TimeSlotRow,
} from '@dawn-tick/core';
import {
  SETTINGS_GROUP_IDS,
  summarizeSettings,
  type SettingsGroupSummaries,
} from '../src/screens/settings-group-summaries.ts';

const SEMESTERS = [
  { id: 'sem-1', name: '2026-2027 第一学期' },
  { id: 'sem-2', name: '2026-2027 第二学期' },
] as unknown as SemesterRow[];

/** 用默认设置拼摘要；`slots` 只关心条数，占位行足够验证「N 个节次」。 */
function summarize(
  settings: Partial<AppSettings> = {},
  overrides: { activeSemesterId?: string | null; slotCount?: number } = {},
): SettingsGroupSummaries {
  const slotCount = overrides.slotCount ?? 12;
  const slots = Array.from({ length: slotCount }, (_, index) => ({
    id: `slot-${index}`,
  })) as unknown as TimeSlotRow[];
  return summarizeSettings({
    settings: { ...DEFAULT_SETTINGS, ...settings },
    semesters: SEMESTERS,
    activeSemesterId: overrides.activeSemesterId === undefined ? 'sem-1' : overrides.activeSemesterId,
    slots,
  });
}

test('默认设置的分组摘要与产品文案一致', () => {
  assert.deepEqual(summarize(), {
    semesters: '2026-2027 第一学期',
    reminders: '课前 20 分钟',
    appearance: '青春活力 · 跟随系统',
    timetable: '5 天 · 隐藏周末',
    slots: '12 个节次',
    widget: '条形 · 浅色',
    time: 'Asia/Shanghai · 按开始时间',
  });
});

test('分组摘要随设置实时变化', () => {
  const next = summarize(
    {
      themePreset: 'mono',
      theme: 'dark',
      viewDays: 7,
      hideWeekends: false,
      todoSort: 'type',
      classReminderEnabled: false,
      widgetVariant: 'exam',
      widgetBackground: 'transparent',
      timeZone: 'Asia/Tokyo',
    },
    { activeSemesterId: 'sem-2', slotCount: 14 },
  );
  assert.equal(next.semesters, '2026-2027 第二学期');
  assert.equal(next.reminders, '课前提醒已关闭');
  assert.equal(next.appearance, '极简墨色 · 深色');
  assert.equal(next.timetable, '7 天 · 显示周末');
  assert.equal(next.slots, '14 个节次');
  assert.equal(next.widget, '考试倒计时 · 透明');
  assert.equal(next.time, 'Asia/Tokyo · 按类型');
});

test('调整提醒分钟数与浅色主题时摘要跟着改', () => {
  const next = summarize({ classReminderMinutes: 30, theme: 'light' });
  assert.equal(next.reminders, '课前 30 分钟');
  assert.equal(next.appearance, '青春活力 · 浅色');
});

test('没有当前学期或节次时给出可读的空态摘要', () => {
  const next = summarize({}, { activeSemesterId: null, slotCount: 0 });
  assert.equal(next.semesters, '还没有学期');
  assert.equal(next.slots, '0 个节次');
});

test('七个分组 id 都有非空摘要', () => {
  const summaries = summarize();
  for (const id of SETTINGS_GROUP_IDS) {
    assert.ok(summaries[id].trim().length > 0, `${id} 的摘要不能为空`);
  }
  assert.deepEqual(Object.keys(summaries), [...SETTINGS_GROUP_IDS]);
});
