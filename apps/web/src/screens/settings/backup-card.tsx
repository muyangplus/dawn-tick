import type { AppSettings, Storage } from '@dawn-tick/core';
import { BackupBlock } from './backup-block.tsx';
import { TransferBlock } from './transfer-block.tsx';
import { useSnapshots } from './use-snapshots.ts';

export interface BackupCardProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
  /** 导出/导入对话框挂在设备页（顶部快捷动作也要打开导出） */
  onOpenExport: () => void;
  onOpenImport: () => void;
  /** 别处（WebDAV 下载前）建过快照后递增，让本卡重读快照列表 */
  snapshotsRevision: number;
}

/**
 * 备份与恢复卡：自动快照设置、立即创建、快照列表（恢复 / 删除）与导出导入入口。
 *
 * 快照列表由本卡持有并传给 `BackupBlock`；WebDAV 在下载前也会建快照，
 * 因此设备页在那边完成后递增 `snapshotsRevision`，这里只负责重读，不共享动作状态。
 */
export function BackupCard({
  storage,
  settings,
  onPatch,
  onChanged,
  onOpenExport,
  onOpenImport,
  snapshotsRevision,
}: BackupCardProps) {
  const snapshots = useSnapshots(storage, snapshotsRevision);

  return (
    <>
      <BackupBlock storage={storage} settings={settings} onPatch={onPatch} snapshots={snapshots} onChanged={onChanged} />
      <span className="text-xs text-muted">跨设备迁移用导出导入</span>
      <TransferBlock settings={settings} onOpenExport={onOpenExport} onOpenImport={onOpenImport} />
    </>
  );
}
