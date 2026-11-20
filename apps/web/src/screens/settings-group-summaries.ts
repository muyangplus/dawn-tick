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
import { settingsSummaryCopy } from '../copy/settings-page.ts';
import { aiCopy } from '../copy/settings-ai.ts';

/** 设置页的分组 id：顺序与分组清单一致，摘要按同一份 id 返回。 */
export const SETTINGS_GROUP_IDS = [
  'semesters',
  'reminders',
  'appearance',
  'timetable',
  'slots',
  'widget',
  'time',
  'ai',
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

const THEME_MODE_LABEL: Record<ThemeMode, string> = settingsSummaryCopy.themeMode;

const TODO_SORT_LABEL: Record<TodoSort, string> = settingsSummaryCopy.todoSort;

/** 悬浮窗样式的短名：完整名太长，清单里只留一句能认出样式的话。 */
const WIDGET_VARIANT_SHORT_LABEL: Record<WidgetVariant, string> = settingsSummaryCopy.widgetVariantShort;

const WIDGET_BACKGROUND_LABEL: Record<WidgetBackground, string> = settingsSummaryCopy.widgetBackground;

/**
 * 设置页分组清单的一行摘要（纯函数）。
 *
 * 摘要只描述「现在是什么」，不负责跳转或落库；组件只把它塞进 `SettingsGroup.summary`，
 * 从而避免在 JSX 里堆一层层三元。示例：`青春活力 · 跟随系统`、`5 天 · 隐藏周末`。
 */
export function summarizeSettings(input: SettingsSummaryInput): SettingsGroupSummaries {
  const { settings, semesters, activeSemesterId, slots } = input;
  const activeSemester = semesters.find((semester) => semester.id === activeSemesterId);

  const copy = settingsSummaryCopy;
  return {
    semesters: activeSemester?.name ?? copy.noSemester,
    reminders: settings.classReminderEnabled
      ? copy.classReminderOn(settings.classReminderMinutes)
      : copy.classReminderOff,
    appearance: copy.pair(PRESETS[settings.themePreset].label, THEME_MODE_LABEL[settings.theme]),
    timetable: copy.timetable(settings.viewDays, settings.hideWeekends),
    slots: copy.slots(slots.length),
    widget: copy.pair(
      WIDGET_VARIANT_SHORT_LABEL[settings.widgetVariant],
      WIDGET_BACKGROUND_LABEL[settings.widgetBackground],
    ),
    time: copy.pair(settings.timeZone, TODO_SORT_LABEL[settings.todoSort]),
    ai: settings.aiBaseUrl.trim() !== '' && settings.aiModel.trim() !== '' ? aiCopy.summaryOn(settings.aiModel.trim()) : aiCopy.summaryOff,
  };
}
