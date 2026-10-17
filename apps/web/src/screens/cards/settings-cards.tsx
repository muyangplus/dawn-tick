import { BadgeCheck, Bell, Database, Info, Palette, RefreshCw, type LucideIcon } from 'lucide-react';
import { defineCard, type CardZone } from './registry.ts';

export interface SettingsSectionCardDef {
  id: string;
  title: string;
  icon: LucideIcon;
  badge?: string;
  order: number;
  defaultZone: CardZone;
}

/** 设置页的 6 张卡片：显隐、顺序与区域由注册表管，内容由 settings-view 按相同 id 填入。 */
export const SETTINGS_SECTIONS: readonly SettingsSectionCardDef[] = [
  { id: 'semesters', title: '学期设置', icon: BadgeCheck, order: 0, defaultZone: 'main' },
  { id: 'reminders', title: '提醒设置', icon: Bell, order: 1, defaultZone: 'main' },
  { id: 'appearance', title: '外观', icon: Palette, order: 2, defaultZone: 'main' },
  { id: 'data', title: '同步与数据', icon: Database, order: 3, defaultZone: 'main' },
  { id: 'maintenance', title: '更新与维护', icon: RefreshCw, order: 4, defaultZone: 'main' },
  { id: 'about', title: '关于', icon: Info, order: 5, defaultZone: 'main' },
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
