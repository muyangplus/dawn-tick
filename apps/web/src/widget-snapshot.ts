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
      });
    }
  }

  return {
    updatedAt: now,
    week: data.week,
    timeZone: data.timeZone,
    background: settings.widgetBackground,
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
