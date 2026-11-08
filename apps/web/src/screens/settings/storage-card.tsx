import { useEffect, useState } from 'react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { hasMobileWidgets, isWebApp } from '../../lib/capabilities.ts';
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
import { TimetableExportActions } from './export-actions.tsx';
import { said } from './format.ts';

export interface StorageCardProps {
  storage: Storage;
  settings: AppSettings;
  /** 浏览器持久化权限：已申请 / 已授权 / 未授权 */
  persistent: boolean | null;
  /** 存储类型的可读文案，如 IndexedDB / SQLite */
  storageKind: string;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  /** 导出/导入/ICS 对话框挂在设备页，本卡只发开关意图 */
  onOpenExport: () => void;
  onOpenImport: () => void;
  onOpenIcs: () => void;
}

/**
 * 本地存储卡：存储类型与位置、自定义路径、WAL 日志模式与浏览器持久化状态，
 * 以及从页面顶部下沉到本组的导出 / 导入入口。
 *
 * 快照、WebDAV、局域网同步已各自独立成卡；页面顶部不再放快捷动作行。
 */
export function StorageCard({
  storage,
  settings,
  persistent,
  storageKind,
  onPatch,
  onOpenExport,
  onOpenImport,
  onOpenIcs,
}: StorageCardProps) {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storagePathInput, setStoragePathInput] = useState('');
  const [storageMessage, setStorageMessage] = useState<StatusMessage | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const storageAction = useAction();
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
      {/* 导出/导入/ICS 从页面顶部下沉到这里：本组是数据与文件的统一入口 */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-role="storage-transfer-actions">
        <span className="text-sm font-medium text-ink">导出与导入</span>
        <span className="text-xs text-muted">跨设备迁移用导出导入；课表可另存为 ICS、图片或 PDF</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onOpenExport}>
            导出备份
          </Button>
          <Button size="sm" variant="secondary" aria-label="导入备份" onClick={onOpenImport}>
            导入备份
          </Button>
          <Button size="sm" variant="secondary" data-role="export-ics" onClick={onOpenIcs}>
            导出课表（ICS）
          </Button>
          <TimetableExportActions storage={storage} settings={settings} />
        </div>
      </div>
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
    </>
  );
}
