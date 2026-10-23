import {
  BadgeCheck,
  Bell,
  CalendarClock,
  CalendarDays,
  Clock,
  MonitorSmartphone,
  Palette,
  type LucideIcon,
} from 'lucide-react';
import { defineCard, type CardZone } from './registry.ts';

export interface SettingsSectionCardDef {
  id: string;
  title: string;
  icon: LucideIcon;
  badge?: string;
  order: number;
  defaultZone: CardZone;
}

/** 设置页的 7 张偏好卡片：显隐、顺序与区域由注册表管，内容由 settings-view 按相同 id 填入。
 *  主力四张（学期、提醒、外观、课表显示）默认主列；作息与选校、悬浮窗与小组件、时间与日程默认侧列。
 *  设备、同步、更新与关于类卡片在 devices-cards.tsx（设备与同步页）。 */
export const SETTINGS_SECTIONS: readonly SettingsSectionCardDef[] = [
  { id: 'semesters', title: '学期设置', icon: BadgeCheck, order: 0, defaultZone: 'main' },
  { id: 'reminders', title: '提醒设置', icon: Bell, order: 1, defaultZone: 'main' },
  { id: 'appearance', title: '外观与动效', icon: Palette, order: 2, defaultZone: 'main' },
  { id: 'timetable', title: '课表显示', icon: CalendarDays, order: 3, defaultZone: 'main' },
  { id: 'slots', title: '作息与选校', icon: CalendarClock, order: 4, defaultZone: 'side' },
  { id: 'widget', title: '悬浮窗与小组件', icon: MonitorSmartphone, order: 5, defaultZone: 'side' },
  { id: 'time', title: '时间与日程', icon: Clock, order: 6, defaultZone: 'side' },
];

export function settingsSection(id: string): SettingsSectionCardDef | undefined {
  return SETTINGS_SECTIONS.find((item) => item.id === id);
}

for (const section of SETTINGS_SECTIONS) {
  defineCard({
    id: section.id,
    scope: 'settings',
    title: section.title,
    defaultZone: section.defaultZone,
    defaultOrder: section.order,
    defaultVisible: true,
    // 卡片骨架由设置页组装，注册表只负责显隐、顺序与区域
    render: () => null,
  });
}
