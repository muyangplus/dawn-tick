import type { Storage } from '@dawn-tick/core';
import type { AppData } from './data.ts';
import { detectPlatform } from './platform-detect.ts';

export const WIDGET_SNAPSHOT_KEY = 'widget_snapshot';

export interface WidgetLesson {
  title: string;
  room: string | null;
  startsAt: number;
  endsAt: number;
}

export interface WidgetSnapshot {
  updatedAt: number;
  week: number;
  timeZone: string;
  next: WidgetLesson | null;
  today: WidgetLesson[];
}

/** Android 主屏小组件读取的快照，避免小组件侧重复实现课表逻辑。 */
export function buildWidgetSnapshot(data: AppData, now: number = Date.now()): WidgetSnapshot {
  const toLesson = (item: AppData['todayLessons'][number]): WidgetLesson => ({
    title: item.courseName,
    room: item.room,
    startsAt: item.startAt,
    endsAt: item.endAt,
  });

  return {
    updatedAt: now,
    week: data.week,
    timeZone: data.timeZone,
    next: data.nextLesson === undefined ? null : toLesson(data.nextLesson),
    today: data.todayLessons.map(toLesson),
  };
}

export async function writeWidgetSnapshot(storage: Storage, data: AppData): Promise<void> {
  await storage.writeMeta(WIDGET_SNAPSHOT_KEY, JSON.stringify(buildWidgetSnapshot(data)));
  if (detectPlatform() !== 'capacitor') return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin<{ refresh(): Promise<void> }>('WidgetRefresh');
    await plugin.refresh();
  } catch {
    // 插件未注册时跳过，快照仍会在系统周期刷新时生效
  }
}
