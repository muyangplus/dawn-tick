import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
import { Card } from '../components/ui/card.tsx';
import { GroupedSettings, type SettingsGroup } from '../components/grouped-settings.tsx';
import { HelpNavItem } from '../components/help-nav-item.tsx';
import { canConfigureStorage, readStorageInfo } from '../storage-config.ts';
import { davConfigured } from '../webdav.ts';
import type { ScannedPairRequest } from '../lib/scan.ts';
import { AboutCard } from './settings/about-card.tsx';
import { BackupCard } from './settings/backup-card.tsx';
import { LanSyncBlock } from './settings/lan-sync-block.tsx';
import { MaintenanceCard } from './settings/maintenance-card.tsx';
import { StorageCard } from './settings/storage-card.tsx';
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
  /** 通用扫一扫交来的配对请求：进入本页时自动展开「局域网同步」并配对一次 */
  pendingPair?: ScannedPairRequest | null;
  onPendingPairHandled?: () => void;
  /** 外部请求打开某个分组（帮助页「去设置」直达），与内部扫码请求共用同一套开组机制 */
  openRequest?: { id: string; nonce: number } | null;
  /** 移动端从设置/设备列表进入帮助页 */
  onOpenHelp?: () => void;
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
 * 页面顶部不再放快捷动作行：导出 / 导入 / ICS 归「本地存储」，快照归「备份与恢复」，
 * 检查更新归「更新」，各分组内保留唯一入口。
 */
export function DevicesView({
  storage,
  settings,
  persistent,
  storageKind,
  onPatch,
  onChanged,
  onSettingsReplaced,
  pendingPair = null,
  onPendingPairHandled,
  openRequest = null,
  onOpenHelp,
}: DevicesViewProps) {
  /** 版本检查由「更新」组使用，页面只持有同一份进行中状态 */
  const update = useUpdateCheck(settings);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);
  /** 外部请求打开的分组：扫码配对与帮助页「去设置」都落到这里 */
  const [groupRequest, setGroupRequest] = useState<{ id: string; nonce: number } | null>(null);
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

  // 扫一扫的配对请求：先落到「局域网同步」子页，再交给局域网块自动填入并发起配对
  useEffect(() => {
    if (pendingPair === null) return;
    setGroupRequest({ id: 'lan', nonce: pendingPair.id });
  }, [pendingPair]);

  // 帮助页「去设置」等外部请求：换页后由本页接住并打开对应分组
  useEffect(() => {
    if (openRequest !== null) setGroupRequest(openRequest);
  }, [openRequest]);

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

  const contents: Record<string, ReactNode> = {
    storage: (
      <StorageCard
        storage={storage}
        settings={settings}
        persistent={persistent}
        storageKind={storageKind}
        onPatch={onPatch}
        onOpenExport={() => setExportOpen(true)}
        onOpenImport={() => setImportOpen(true)}
        onOpenIcs={() => setIcsOpen(true)}
      />
    ),

    backup: (
      <BackupCard
        storage={storage}
        settings={settings}
        onPatch={onPatch}
        onChanged={onChanged}
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

    lan: (
      <LanSyncBlock
        storage={storage}
        onSettingsReplaced={onSettingsReplaced}
        onChanged={onChanged}
        pendingPair={pendingPair}
        onPendingPairHandled={onPendingPairHandled}
      />
    ),

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
      {/* 页面顶部不放快捷动作行：导出/导入/ICS 在「本地存储」，快照在「备份与恢复」，检查更新在「更新」 */}
      <GroupedSettings
        pageTitle="设备与同步"
        ariaLabel="设备与同步分组"
        groups={groups}
        openRequest={groupRequest}
        extraNav={onOpenHelp === undefined ? undefined : <HelpNavItem onOpenHelp={onOpenHelp} />}
      />

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} storage={storage} />
      <IcsExportDialog open={icsOpen} onOpenChange={setIcsOpen} storage={storage} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} storage={storage} onChanged={onChanged} />
    </div>
  );
}
