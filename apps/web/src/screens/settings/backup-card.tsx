import type { AppSettings, Storage } from '@dawn-tick/core';
import { BackupBlock } from './backup-block.tsx';
import { TransferBlock } from './transfer-block.tsx';
import { useSnapshots } from './use-snapshots.ts';

export interface BackupCardProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
  /** 别处（WebDAV 下载前）建过快照后递增，让本卡重读快照列表 */
  snapshotsRevision: number;
}

/**
 * 备份与恢复卡：自动快照设置、新建快照与快照列表（恢复 / 删除），以及诊断日志动作。
 *
 * 导出/导入备份与 ICS 已移到「本地存储」分组，这里只保留快照相关动作与诊断日志入口，
 * 避免重复入口；开发者特性开关控制诊断日志按钮是否出现。
 */
export function BackupCard({ storage, settings, onPatch, onChanged, snapshotsRevision }: BackupCardProps) {
  const snapshots = useSnapshots(storage, snapshotsRevision);

  return (
    <>
      <BackupBlock storage={storage} settings={settings} onPatch={onPatch} snapshots={snapshots} onChanged={onChanged} />
      <span className="text-xs text-muted">导出/导入备份与课表文件在「本地存储」分组</span>
      <TransferBlock settings={settings} />
    </>
  );
}
