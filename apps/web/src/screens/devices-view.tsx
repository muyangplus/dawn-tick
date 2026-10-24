import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  Cloud,
  Database,
  Info,
  RefreshCw,
  Wifi,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../channel.ts';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { GroupedSettings, type SettingsGroup } from '../components/grouped-settings.tsx';
import { canConfigureStorage, readStorageInfo } from '../storage-config.ts';
import { davConfigured } from '../webdav.ts';
import { AboutCard } from './settings/about-card.tsx';
import { BackupCard } from './settings/backup-card.tsx';
import { LanSyncBlock } from './settings/lan-sync-block.tsx';
import { MaintenanceCard } from './settings/maintenance-card.tsx';
import { StorageCard } from './settings/storage-card.tsx';
import { TimetableExportActions } from './settings/export-actions.tsx';
import { ExportDialog, IcsExportDialog, ImportDialog } from './settings/transfer-dialogs.tsx';
import { UpdateCard } from './settings/update-card.tsx';
import { useSnapshots } from './settings/use-snapshots.ts';
import { useUpdateCheck } from './settings/use-update-check.ts';
import { WebdavBlock } from './settings/webdav-block.tsx';
import {
  deviceGroupSummaries,
  type StorageLocationKind,
} from './devices-group-summaries.ts';

export interface DevicesViewProps {
  storage: Storage;
  settings: AppSettings;
  /** 浏览器持久化权限：已申请 / 已授权 / 未授权 */
  persistent: boolean | null;
  /** 存储类型的可读文案，如 IndexedDB / SQLite */
  storageKind: string;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
  /** 从库外写入设置后（如 WebDAV 只应用设置）重新读取设置并热加载 */
  onSettingsReplaced: () => Promise<void>;
}

/** 七个分组的固定顺序与图标：与原来的卡片顺序、图标一一对应，方便老用户找得到。 */
const GROUP_META: ReadonlyArray<{ id: string; title: string; icon: LucideIcon }> = [
  { id: 'storage', title: '本地存储', icon: Database },
  { id: 'backup', title: '备份与恢复', icon: Archive },
  { id: 'update', title: '更新', icon: RefreshCw },
  { id: 'webdav', title: 'WebDAV 同步', icon: Cloud },
  { id: 'lan', title: '局域网同步', icon: Wifi },
  { id: 'maintenance', title: '诊断与维护', icon: Wrench },
  { id: 'about', title: '关于', icon: Info },
];

/**
 * 设备与同步页：分组导航 + 下钻，页面只持有跨分组共享的状态。
 *
 * 页面级状态（导出 / 导入 / ICS 对话框、版本检查、快照版本号、数据目录）留在这里，
 * 各分组内容由原有组件挂载：一次只显示一组，切组即卸载上一组，页面高度不随展开跳动。
 * 顶部快捷动作仍与分组内容联动：检查更新复用同一份 `useUpdateCheck`，
 * WebDAV 下载前建快照会递增版本号让备份组重读列表。
 */
export function DevicesView({
  storage,
  settings,
  persistent,
  storageKind,
  onPatch,
  onChanged,
  onSettingsReplaced,
}: DevicesViewProps) {
  /** 版本检查：顶部快捷动作与「更新」组共用同一份进行中状态 */
  const update = useUpdateCheck(settings);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);
  /** WebDAV 下载前会建快照：递增版本号让备份组重读列表 */
  const [snapshotsRevision, setSnapshotsRevision] = useState(0);
  const refreshSnapshots = useCallback(async (): Promise<void> => {
    setSnapshotsRevision((value) => value + 1);
  }, []);
  /** 清单摘要里的快照份数；分组内容里的备份卡另有自己的列表状态 */
  const snapshots = useSnapshots(storage, snapshotsRevision);
  /** 原生端数据目录类型；浏览器 / 安卓读不到时保持 null */
  const [storageLocation, setStorageLocation] = useState<StorageLocationKind>(null);

  useEffect(() => {
    if (!canConfigureStorage()) return;
    let cancelled = false;
    void (async () => {
      const info = await readStorageInfo();
      if (cancelled || info === null) return;
      setStorageLocation(info.customPath === '' ? 'default' : 'custom');
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const summaries = deviceGroupSummaries({
    storageKind,
    storageLocation,
    persistent,
    snapshotCount: snapshots.snapshots.length,
    version: appVersion(),
    channelLabel: CHANNEL_LABEL[CHANNEL],
    webdavConfigured: davConfigured(settings),
    logLevel: settings.logLevel,
    logEnabled: settings.logEnabled,
  });

  /** 分组清单由 GroupedSettings 自己持有选中项；顶部快捷动作按它公开的 data 契约跳组。 */
  const shellRef = useRef<HTMLDivElement>(null);
  const openGroup = useCallback((id: string): void => {
    shellRef.current
      ?.querySelector<HTMLElement>(`[data-role="settings-nav-item"][data-group="${id}"]`)
      ?.click();
  }, []);

  const contents: Record<string, ReactNode> = {
    storage: (
      <StorageCard
        settings={settings}
        persistent={persistent}
        storageKind={storageKind}
        onPatch={onPatch}
      />
    ),

    backup: (
      <BackupCard
        storage={storage}
        settings={settings}
        onPatch={onPatch}
        onChanged={onChanged}
        onOpenExport={() => setExportOpen(true)}
        onOpenImport={() => setImportOpen(true)}
        snapshotsRevision={snapshotsRevision}
      />
    ),

    update: <UpdateCard storage={storage} settings={settings} onPatch={onPatch} update={update} />,

    webdav: (
      <WebdavBlock
        storage={storage}
        settings={settings}
        onPatch={onPatch}
        onChanged={onChanged}
        onSettingsReplaced={onSettingsReplaced}
        onSnapshotsChanged={refreshSnapshots}
      />
    ),

    lan: <LanSyncBlock storage={storage} onSettingsReplaced={onSettingsReplaced} onChanged={onChanged} />,

    maintenance: <MaintenanceCard storage={storage} settings={settings} onPatch={onPatch} />,

    about: <AboutCard />,
  };

  const groups: SettingsGroup[] = GROUP_META.map((meta) => ({
    id: meta.id,
    title: meta.title,
    icon: meta.icon,
    summary: summaries[meta.id as keyof typeof summaries],
    content: <Card className="p-4">{contents[meta.id]}</Card>,
  }));

  return (
    <div className="flex flex-col gap-3" data-role="devices-view" aria-label="设备与同步">
      {/* 数据类快捷动作固定在顶部，与设置页的导入课表分开，避免两处重复入口 */}
      <div className="flex flex-wrap items-center gap-2" data-role="devices-actions">
        <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
          导出备份
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setIcsOpen(true)}>
          导出课表（ICS）
        </Button>
        <TimetableExportActions storage={storage} settings={settings} />
        {/* 恢复快照沿用旧行为：直接落到「备份与恢复」分组看快照列表 */}
        <Button size="sm" variant="secondary" onClick={() => openGroup('backup')}>
          恢复快照
        </Button>
        <Button size="sm" variant="secondary" loading={update.busy} onClick={() => void update.run()}>
          检查更新
        </Button>
      </div>

      <div ref={shellRef}>
        <GroupedSettings pageTitle="设备与同步" ariaLabel="设备与同步分组" groups={groups} />
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} storage={storage} />
      <IcsExportDialog open={icsOpen} onOpenChange={setIcsOpen} storage={storage} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} storage={storage} onChanged={onChanged} />
    </div>
  );
}
