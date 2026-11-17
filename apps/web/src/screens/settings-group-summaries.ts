import type {
  AppSettings,
  SemesterRow,
  TimeSlotRow,
  ThemeMode,
  TodoSort,
  WidgetBackground,
  WidgetVariant,
} from '@dawn-tick/core';
import { PRESETS } from '../design/tokens.ts';
import { COUNT } from '../copy/zh.ts';

/** 设置页的分组 id：顺序与分组清单一致，摘要按同一份 id 返回。 */
export const SETTINGS_GROUP_IDS = [
  'semesters',
  'reminders',
  'appearance',
  'timetable',
  'slots',
  'widget',
  'time',
] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number];

export type SettingsGroupSummaries = Record<SettingsGroupId, string>;

export interface SettingsSummaryInput {
  settings: AppSettings;
  semesters: readonly SemesterRow[];
  activeSemesterId: string | null;
  /** 当前学期的节次，用来概括作息 */
  slots: readonly TimeSlotRow[];
}

const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

const TODO_SORT_LABEL: Record<TodoSort, string> = {
  start: '按开始时间',
  type: '按类型',
};

/** 悬浮窗样式的短名：完整名太长，清单里只留一句能认出样式的话。 */
const WIDGET_VARIANT_SHORT_LABEL: Record<WidgetVariant, string> = {
  bar: '条形',
  today: '今日课表',
  minimal: '极简数字',
  combo: '组合卡',
  exam: '考试倒计时',
};

const WIDGET_BACKGROUND_LABEL: Record<WidgetBackground, string> = {
  light: '浅色',
  dark: '深色',
  transparent: '透明',
};

/**
 * 设置页分组清单的一行摘要（纯函数）。
 *
 * 摘要只描述「现在是什么」，不负责跳转或落库；组件只把它塞进 `SettingsGroup.summary`，
 * 从而避免在 JSX 里堆一层层三元。示例：`青春活力 · 跟随系统`、`5 天 · 隐藏周末`。
 */
export function summarizeSettings(input: SettingsSummaryInput): SettingsGroupSummaries {
  const { settings, semesters, activeSemesterId, slots } = input;
  const activeSemester = semesters.find((semester) => semester.id === activeSemesterId);

  return {
    semesters: activeSemester?.name ?? '还没有学期',
    reminders: settings.classReminderEnabled
      ? `课前 ${COUNT('minute', settings.classReminderMinutes)}`
      : '课前提醒已关闭',
    appearance: `${PRESETS[settings.themePreset].label} · ${THEME_MODE_LABEL[settings.theme]}`,
    timetable: `${settings.viewDays} 天 · ${settings.hideWeekends ? '隐藏周末' : '显示周末'}`,
    /** COUNT('period', 14) = 「14 个」，后面接「节次」组成「14 个节次」 */
    slots: `${COUNT('period', slots.length)}节次`,
    widget: `${WIDGET_VARIANT_SHORT_LABEL[settings.widgetVariant]} · ${WIDGET_BACKGROUND_LABEL[settings.widgetBackground]}`,
    time: `${settings.timeZone} · ${TODO_SORT_LABEL[settings.todoSort]}`,
  };
}
