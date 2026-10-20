import { Database, Info, RefreshCw, type LucideIcon } from 'lucide-react';
import { defineCard, type CardZone } from './registry.ts';

export interface DevicesSectionCardDef {
  id: string;
  title: string;
  icon: LucideIcon;
  order: number;
  defaultZone: CardZone;
}

/** 设备与同步页的 3 张卡片：显隐、顺序与区域由注册表管，内容由 devices-view 按相同 id 填入。 */
export const DEVICES_SECTIONS: readonly DevicesSectionCardDef[] = [
  { id: 'data', title: '存储与同步', icon: Database, order: 0, defaultZone: 'main' },
  { id: 'maintenance', title: '更新与维护', icon: RefreshCw, order: 1, defaultZone: 'main' },
  { id: 'about', title: '关于', icon: Info, order: 2, defaultZone: 'main' },
];

export function devicesSection(id: string): DevicesSectionCardDef | undefined {
  return DEVICES_SECTIONS.find((item) => item.id === id);
}

for (const section of DEVICES_SECTIONS) {
  defineCard({
    id: section.id,
    scope: 'devices',
    title: section.title,
    defaultZone: section.defaultZone,
    defaultOrder: section.order,
    defaultVisible: true,
    // 卡片骨架由设备与同步页组装，注册表只负责显隐、顺序与区域
    render: () => null,
  });
}
