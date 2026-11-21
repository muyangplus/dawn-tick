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
import { fail } from '../../copy/common.ts';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { ShareExportAction, TimetableExportActions } from './export-actions.tsx';
import { said } from './format.ts';
import { storageCopy as copy } from '../../copy/backup-storage.ts';
import { transferCopy } from '../../copy/backup-transfer.ts';
import { HelpLink } from '../../components/help-link.tsx';

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
      label: copy.saving,
      fail: false,
      task: async () => {
        const saved = await saveStoragePath(path);
        if (saved.info === null) {
          toast.error(fail(copy.saveWhat, saved.error, copy.saveNext));
          return;
        }
        setStorageInfo(saved.info);
        setStoragePathInput(saved.info.customPath);
        const copied = saved.info.copied.length;
        setStorageMessage(said(copy.saved(copied)));
        toast.success(copy.savedTo(saved.info.dir, copied));
        // 存储位置要重启才生效：只登记，不在这里渲染提示与按钮
        registerPendingRestart('storage-path');
      },
    });
    if (!result.ok && result.error !== null) setStorageError(result.error);
  }

  /** 日志模式存在库里，下次打开数据库时套用。 */
  async function toggleWal(next: boolean): Promise<void> {
    await onPatch({ walMode: next ? 'on' : 'off' });
    setStorageMessage(said(copy.walSaved));
    toast.success(copy.walSaved);
    registerPendingRestart('wal');
  }

  return (
    <>
      <span className="text-xs text-muted">{copy.storageKind(storageKind)}</span>
      {isWebApp() && (
        <span className="text-xs text-muted">
          {copy.persistence(
            persistent === null
              ? copy.persistenceNotRequested
              : persistent
                ? copy.persistenceGranted
                : copy.persistenceDenied,
          )}
        </span>
      )}
      {canConfigureStorage() ? (
        <>
          <div className="flex flex-col gap-1" data-role="storage-location">
            <span className="text-xs text-muted" data-role="storage-dir">
              {storageInfo === null
                ? copy.location(copy.locationReading, '')
                : copy.location(storageInfo.dir, storageInfo.portable ? copy.editionPortable : copy.editionInstalled)}
            </span>
            <Field label={copy.customLabel} hint={copy.customHint} help={copy.customHelp}>
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
                aria-label={copy.saveLabel}
                loading={storageAction.busy}
                onClick={() => void saveStorage(storagePathInput)}
              >
                {copy.saveButton}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={copy.resetLabel}
                loading={storageAction.busy}
                onClick={() => void saveStorage('')}
              >
                {copy.resetButton}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={copy.openDataDir}
                onClick={() =>
                  void openDataDirectory().then((dir) => {
                    if (dir === null) toast.error(fail(copy.openDataDir, null, copy.openDataDirNext));
                  })
                }
              >
                {copy.openDataDir}
              </Button>
            </div>
            {storageInfo !== null && (
              <span className="text-xs text-muted" data-role="storage-detail">
                {copy.dbDetail(
                  storageInfo.dbFile,
                  storageInfo.dbExists ? Math.round(storageInfo.dbBytes / 1024) : null,
                  storageInfo.sidecars,
                )}
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
        <span className="text-xs text-muted">{copy.locationAndroid}</span>
      ) : null}
      {/* 导出/导入/ICS 从页面顶部下沉到这里：本组是数据与文件的统一入口 */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-role="storage-transfer-actions">
        <span className="text-sm font-medium text-ink">{copy.transferTitle}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onOpenExport}>
            {transferCopy.exportBackup}
          </Button>
          <Button size="sm" variant="secondary" aria-label={transferCopy.importBackup} onClick={onOpenImport}>
            {transferCopy.importBackup}
          </Button>
          <Button size="sm" variant="secondary" data-role="export-ics" onClick={onOpenIcs}>
            {transferCopy.exportIcs}
          </Button>
          <TimetableExportActions storage={storage} settings={settings} />
          <ShareExportAction storage={storage} />
        </div>
      </div>
      {!isWebApp() && (
        <div className="flex flex-col gap-1" data-role="wal-setting">
          <SwitchField
            label={copy.walLabel}
            checked={walOn}
            onCheckedChange={(checked) => void toggleWal(checked)}
            ariaLabel={copy.walLabel}
            dataRole="wal-switch"
          />
          <span className="text-xs text-muted" data-role="wal-hint">
            {settings.walMode === 'auto'
              ? copy.walAuto(walOn)
              : settings.walMode === 'on'
                ? copy.walOn
                : copy.walOff}
          </span>
        </div>
      )}
    </>
  );
}
