import type { AppSettings, Storage } from '@dawn-tick/core';
import type { AppData } from './data.ts';
import { parseHex } from './design/contrast.ts';
import { resolveTokens } from './design/tokens.ts';
import { writeMetaJson } from './lib/meta.ts';
import { WIDGET_SNAPSHOT_META_KEY } from './lib/meta-keys.ts';
import { isDesktopApp } from './lib/capabilities.ts';
import { PLUGIN_NAMES, loadPlugin, type WidgetRefreshPlugin } from './lib/plugins.ts';

export const WIDGET_SNAPSHOT_KEY = WIDGET_SNAPSHOT_META_KEY;

/**
 * 小组件配色：取设计令牌的语义色，与悬浮窗同一口径；Kotlin 侧缺失时回退内置常量。
 * 字段名即 Kotlin `WidgetStore.kt` 的 JSON 键名，由 `check-widget-contract.mjs` 双向校验。
 */
export interface WidgetColors {
  /** 正文色，对应 `ColorTokens.text`。 */
  ink: string;
  /** 次要文字色，对应 `ColorTokens.muted`。 */
  muted: string;
  /** 卡面底色，对应 `ColorTokens.surface`；透明背景为带 alpha 的 `#AARRGGBB`。 */
  surface: string;
  /** 强调色（倒计时/天数），取 AA 达标的 `ColorTokens.primaryStrong`，与悬浮窗倒计时一致。 */
  accent: string;
  /** A-15 旧字段：`ColorTokens.dangerStrong`；新快照继续携带，旧版 APK 仍能读到强调色。 */
  danger: string;
}

export interface WidgetLesson {
  title: string;
  room: string | null;
  startsAt: number;
  endsAt: number;
}

export interface WidgetGridLesson {
  title: string;
  room: string | null;
  color: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  /** 该课所在日期被停课：小组件在课名后标注 */
  cancelled: boolean;
}

export interface WidgetExam {
  title: string;
  date: string;
  startAt: number;
}

export interface WidgetSnapshot {
  updatedAt: number;
  week: number;
  timeZone: string;
  background: AppSettings['widgetBackground'];
  /** 主题语义色（含卡面底色与强调色）；旧版快照可能没有该字段，Android 侧回退内置常量。 */
  colors?: WidgetColors | null;
  /** 正在上的那一节课：有它时前端显示剩余时间，没有时看 next */
  current: WidgetLesson | null;
  next: WidgetLesson | null;
  today: WidgetLesson[];
  grid: WidgetGridLesson[];
  exams: WidgetExam[];
}

function prefersDark(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/**
 * 小组件取色模式：深色底固定用暗色令牌、浅色底固定用亮色令牌；
 * 透明底跟随应用主题（`system` 时看系统偏好）。底色与令牌背景色接近，保证文字对比度。
 */
function widgetColorMode(settings: AppSettings): 'light' | 'dark' {
  if (settings.widgetBackground === 'dark') return 'dark';
  if (settings.widgetBackground === 'light') return 'light';
  if (settings.theme === 'system') return prefersDark() ? 'dark' : 'light';
  return settings.theme;
}

/** 透明底的不透明度：与悬浮窗 `.mini-bg-transparent` 的 55% 保持一致。 */
export const WIDGET_TRANSPARENT_ALPHA = 0.55;

/** 给 `#RRGGBB` 补 alpha，产出 Android `Color.parseColor` 支持的 `#AARRGGBB`。 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(alpha * 255)}${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** 卡面底色：透明背景按统一不透明度叠在桌面上，其余直接用预设的 surface。 */
export function buildWidgetSurface(
  background: AppSettings['widgetBackground'],
  surface: string,
): string {
  return background === 'transparent' ? withAlpha(surface, WIDGET_TRANSPARENT_ALPHA) : surface;
}

/** 快照配色：预设与模式都来自设置，保证小组件与悬浮窗的配色随主题一致。 */
export function buildWidgetColors(settings: AppSettings): WidgetColors {
  const tokens = resolveTokens(settings.themePreset, widgetColorMode(settings));
  return {
    ink: tokens.text,
    muted: tokens.muted,
    surface: buildWidgetSurface(settings.widgetBackground, tokens.surface),
    accent: tokens.primaryStrong,
    danger: tokens.dangerStrong,
  };
}

/** Android 主屏小组件读取的快照，避免小组件侧重复实现课表逻辑。 */
export function buildWidgetSnapshot(
  data: AppData,
  settings: AppSettings,
  now: number = Date.now(),
): WidgetSnapshot {
  const toLesson = (item: AppData['todayLessons'][number]): WidgetLesson => ({
    title: item.courseName,
    room: item.room,
    startsAt: item.startAt,
    endsAt: item.endAt,
  });

  const grid: WidgetGridLesson[] = [];
  for (const lessons of data.grid.values()) {
    for (const lesson of lessons) {
      // 「始终不显示周末」也作用于一周概览：周末课不进快照
      if (settings.hideWeekends && lesson.dayOfWeek >= 6) continue;
      grid.push({
        title: lesson.name,
        room: lesson.room,
        color: lesson.color,
        dayOfWeek: lesson.dayOfWeek,
        periodStart: lesson.periodStart,
        periodEnd: lesson.periodEnd,
        cancelled: lesson.cancelled,
      });
    }
  }

  return {
    updatedAt: now,
    week: data.week,
    timeZone: data.timeZone,
    background: settings.widgetBackground,
    colors: buildWidgetColors(settings),
    current: data.currentLesson === undefined ? null : toLesson(data.currentLesson),
    next: data.nextLesson === undefined ? null : toLesson(data.nextLesson),
    today: data.todayLessons.map(toLesson),
    grid,
    exams: data.exams.map((exam) => ({
      title: exam.title,
      date: exam.on_date ?? '',
      startAt: exam.start_at ?? 0,
    })),
  };
}

export async function writeWidgetSnapshot(
  storage: Storage,
  data: AppData,
  settings: AppSettings,
): Promise<void> {
  await writeMetaJson(storage, WIDGET_SNAPSHOT_KEY, buildWidgetSnapshot(data, settings), { scope: 'widget' });
  try {
    const plugin = await loadPlugin<WidgetRefreshPlugin>(PLUGIN_NAMES.widgetRefresh);
    if (plugin !== null) await plugin.refresh();
  } catch {
    // 插件未注册时跳过，快照仍会在系统周期刷新时生效
  }
}

/** 主窗口数据变更后广播给悬浮窗的事件名。 */
export const WIDGET_DATA_CHANGED_EVENT = 'widget-data-changed';

/** 通知悬浮窗重新读课表：主窗口每次数据加载完成后调用，悬浮窗不必等自己的轮询间隔。 */
export async function notifyWidgetWindows(): Promise<void> {
  if (!isDesktopApp()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(WIDGET_DATA_CHANGED_EVENT);
  } catch {
    // 事件不可用时，悬浮窗仍会按轮询间隔刷新
  }
}
