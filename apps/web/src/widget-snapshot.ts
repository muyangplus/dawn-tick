import type { AppSettings, Storage } from '@dawn-tick/core';
import type { AppData } from './data.ts';
import { detectPlatform } from './platform-detect.ts';

export const WIDGET_SNAPSHOT_KEY = 'widget_snapshot';

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
  /** 正在上的那一节课：有它时前端显示剩余时间，没有时看 next */
  current: WidgetLesson | null;
  next: WidgetLesson | null;
  today: WidgetLesson[];
  grid: WidgetGridLesson[];
  exams: WidgetExam[];
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
  await storage.writeMeta(WIDGET_SNAPSHOT_KEY, JSON.stringify(buildWidgetSnapshot(data, settings)));
  if (detectPlatform() !== 'capacitor') return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin<{ refresh(): Promise<void> }>('WidgetRefresh');
    await plugin.refresh();
  } catch {
    // 插件未注册时跳过，快照仍会在系统周期刷新时生效
  }
}

/** 主窗口数据变更后广播给悬浮窗的事件名。 */
export const WIDGET_DATA_CHANGED_EVENT = 'widget-data-changed';

/**
 * 通知悬浮窗重新读课表：主窗口每次数据加载完成（新建/编辑/删除课程、排课与日程）后调用，
 * 悬浮窗据此立即刷新，不再等自己的轮询间隔。
 */
export async function notifyWidgetWindows(): Promise<void> {
  if (detectPlatform() !== 'tauri') return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(WIDGET_DATA_CHANGED_EVENT);
  } catch {
    // 事件不可用时，悬浮窗仍会按轮询间隔刷新
  }
}
