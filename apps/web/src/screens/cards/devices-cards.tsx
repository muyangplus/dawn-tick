import { Archive, Cloud, Database, Info, RefreshCw, Wifi, Wrench, type LucideIcon } from 'lucide-react';
import { defineCard, type CardZone } from './registry.ts';

export interface DevicesSectionCardDef {
  id: string;
  title: string;
  icon: LucideIcon;
  order: number;
  defaultZone: CardZone;
}

/**
 * 设备与同步页的 7 张配置卡片：显隐、顺序与区域由注册表管，内容由 devices-view 按相同 id 填入。
 *
 * 本地存储 / 备份恢复 / 更新是核心流程，留在主列；WebDAV 与局域网同步也是宽带表单，
 * 放主列；诊断维护与关于属于低频信息，默认放右侧栏。
 */
export const DEVICES_SECTIONS: readonly DevicesSectionCardDef[] = [
  { id: 'storage', title: '本地存储', icon: Database, order: 0, defaultZone: 'main' },
  { id: 'backup', title: '备份与恢复', icon: Archive, order: 1, defaultZone: 'main' },
  { id: 'update', title: '更新', icon: RefreshCw, order: 2, defaultZone: 'main' },
  { id: 'webdav', title: 'WebDAV 同步', icon: Cloud, order: 3, defaultZone: 'main' },
  { id: 'lan', title: '局域网同步', icon: Wifi, order: 4, defaultZone: 'main' },
  { id: 'maintenance', title: '诊断与维护', icon: Wrench, order: 5, defaultZone: 'side' },
  { id: 'about', title: '关于', icon: Info, order: 6, defaultZone: 'side' },
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
