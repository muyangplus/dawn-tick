import { useEffect, useState } from 'react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { canUseWidget, hasMobileWidgets, isWebApp } from '../../lib/capabilities.ts';
import { detectPlatform } from '../../platform-detect.ts';
import {
  canConfigureStorage,
  openDataDirectory,
  readStorageInfo,
  saveStoragePath,
  type StorageInfo,
} from '../../storage-config.ts';
import { walEnabledByDefault } from '../../db/journal.ts';
import { registerPendingRestart } from '../../pending-restart.ts';
import { useAction } from '../../lib/action.ts';
import { fail } from '../../copy/zh.ts';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { BackupBlock } from './backup-block.tsx';
import { LanSyncBlock } from './lan-sync-block.tsx';
import { TransferBlock } from './transfer-block.tsx';
import { WebdavBlock } from './webdav-block.tsx';
import { useSnapshots } from './use-snapshots.ts';
import { said } from './format.ts';

export interface DataCardProps {
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
  /** 导出/导入对话框挂在设备页（顶部快捷动作也要打开导出） */
  onOpenExport: () => void;
  onOpenImport: () => void;
}

/**
 * 存储与同步卡：本地存储位置与 WAL，下面挂备份、WebDAV、导出导入三块。
 *
 * 存储信息与快照列表是卡内共享状态（WebDAV 下载前会建快照，备份块要能刷新），
 * 其余每个子块只消费 settings/onPatch 与自己的动作接口。
 */
export function DataCard({
  storage,
  settings,
  persistent,
  storageKind,
  onPatch,
  onChanged,
  onSettingsReplaced,
  onOpenExport,
  onOpenImport,
}: DataCardProps) {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storagePathInput, setStoragePathInput] = useState('');
  const [storageMessage, setStorageMessage] = useState<StatusMessage | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const storageAction = useAction();
  const snapshots = useSnapshots(storage);
  const platform = detectPlatform();
  const portableStorage = storageInfo?.portable === true;
  const walDefaultOn = walEnabledByDefault(portableStorage, platform);
  const walOn = settings.walMode === 'on' || (settings.walMode === 'auto' && walDefaultOn);

  useEffect(() => {
    if (!canConfigureStorage()) return;
    void (async () => {
      const info = await readStorageInfo();
      if (info === null) return;
      setStorageInfo(info);
      setStoragePathInput(info.customPath);
      if (info.fallbackReason !== null) setStorageError(info.fallbackReason);
    })();
  }, []);

  /** 保存存储位置：成功后要重启才生效。 */
  async function saveStorage(path: string): Promise<void> {
    setStorageError(null);
    setStorageMessage(null);
    const result = await storageAction.run({
      scope: 'storage',
      label: '正在保存存储位置…',
      fail: false,
      task: async () => {
        const saved = await saveStoragePath(path);
        if (saved.info === null) {
          toast.error(fail('保存存储位置', saved.error, '请检查路径后重试'));
          return;
        }
        setStorageInfo(saved.info);
        setStoragePathInput(saved.info.customPath);
        const copied = saved.info.copied.length;
        setStorageMessage(said(copied > 0 ? `已保存存储位置，复制了 ${copied} 个数据文件` : '已保存存储位置'));
        toast.success(`已写入 ${saved.info.dir}${copied > 0 ? `，复制了 ${copied} 个数据文件` : ''}`);
        // 存储位置要重启才生效：只登记，不在这里渲染提示与按钮
        registerPendingRestart('storage-path');
      },
    });
    if (!result.ok && result.error !== null) setStorageError(result.error);
  }

  /** 日志模式存在库里，下次打开数据库时套用。 */
  async function toggleWal(next: boolean): Promise<void> {
    await onPatch({ walMode: next ? 'on' : 'off' });
    setStorageMessage(said('已保存 WAL 日志模式'));
    toast.success('已保存 WAL 日志模式');
    registerPendingRestart('wal');
  }

  return (
    <>
      <span className="text-xs text-muted">本地存储：{storageKind}</span>
      {isWebApp() && (
        <span className="text-xs text-muted">
          浏览器持久化：{persistent === null ? '未申请' : persistent ? '已授权' : '未授权'}
        </span>
      )}
      {canConfigureStorage() ? (
        <>
          <div className="flex flex-col gap-1" data-role="storage-location">
            <span className="text-xs text-muted" data-role="storage-dir">
              存储位置：{storageInfo === null ? '读取中' : storageInfo.dir}
              {storageInfo === null ? '' : storageInfo.portable ? '（便携版）' : '（安装版）'}
            </span>
            <Field label="自定义存储位置" hint="留空用默认" help="相对路径相对程序目录；改完重启生效">
              <Input
                data-role="storage-path"
                value={storagePathInput}
                placeholder={storageInfo?.defaultDir ?? ''}
                onChange={(event) => setStoragePathInput(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-label="保存存储位置"
                loading={storageAction.busy}
                onClick={() => void saveStorage(storagePathInput)}
              >
                保存位置
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="恢复默认存储位置"
                loading={storageAction.busy}
                onClick={() => void saveStorage('')}
              >
                恢复默认
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="打开数据目录"
                onClick={() =>
                  void openDataDirectory().then((dir) => {
                    if (dir === null) toast.error(fail('打开数据目录', null, '请手动到程序目录查看'));
                  })
                }
              >
                打开数据目录
              </Button>
            </div>
            {storageInfo !== null && (
              <span className="text-xs text-muted" data-role="storage-detail">
                数据库文件：{storageInfo.dbFile}（
                {storageInfo.dbExists ? `${Math.round(storageInfo.dbBytes / 1024)} KB` : '尚未创建'}）
                {storageInfo.sidecars.length > 0 ? `，附带 ${storageInfo.sidecars.join(' / ')}` : '，无附带文件'}
              </span>
            )}
            {storageError !== null && (
              <StatusLine dataRole="storage-error" tone="danger">
                {storageError}
              </StatusLine>
            )}
            {storageMessage !== null && (
              <StatusLine dataRole="storage-message" at={storageMessage.at}>
                {storageMessage.text}
              </StatusLine>
            )}
          </div>
        </>
      ) : hasMobileWidgets() ? (
        <span className="text-xs text-muted">存储位置：应用私有目录（不可改）</span>
      ) : null}
      {!isWebApp() && (
        <div className="flex flex-col gap-1" data-role="wal-setting">
          <SwitchField
            label="启用 WAL 日志模式"
            checked={walOn}
            onCheckedChange={(checked) => void toggleWal(checked)}
            ariaLabel="启用 WAL 日志模式"
            dataRole="wal-switch"
          />
          <span className="text-xs text-muted" data-role="wal-hint">
            {settings.walMode === 'auto'
              ? `跟随默认：便携版关闭、安装版开启（当前${walOn ? '开启' : '关闭'}）`
              : settings.walMode === 'on'
                ? '已手动开启：数据库旁会有 -wal / -shm 两个文件'
                : '已手动关闭：数据库为单个文件，不产生 -wal / -shm'}
          </span>
        </div>
      )}
      <span className="text-xs text-muted">
        跨设备迁移用导出导入
      </span>
      <BackupBlock storage={storage} settings={settings} onPatch={onPatch} snapshots={snapshots} onChanged={onChanged} />
      <WebdavBlock
        storage={storage}
        settings={settings}
        onPatch={onPatch}
        onChanged={onChanged}
        onSettingsReplaced={onSettingsReplaced}
        onSnapshotsChanged={snapshots.refresh}
      />
      <LanSyncBlock storage={storage} onSettingsReplaced={onSettingsReplaced} onChanged={onChanged} />
      <TransferBlock settings={settings} onOpenExport={onOpenExport} onOpenImport={onOpenImport} />
    </>
  );
}
