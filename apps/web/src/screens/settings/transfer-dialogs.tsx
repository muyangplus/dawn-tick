import { useState } from 'react';
import {
  BACKUP_MODULES,
  BACKUP_MODULE_LABEL,
  type BackupModule,
  type Storage,
} from '@dawn-tick/core';
import { exportConfig, type ExportFormat } from '../../data-management.ts';
import { dayStampUtc } from '../../lib/dates.ts';
import { copyText } from '../../system-actions.ts';
import { useAction } from '../../lib/action.ts';
import { fail } from '../../copy/common.ts';
import { Button } from '../../components/ui/button.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { ExportEncryptionFields, exportPasswordIssue } from './backup-encryption.tsx';
import { saveText, toastSaved } from './file-export.ts';
import { transferCopy as copy } from '../../copy/backup-transfer.ts';

export { ImportDialog, type ImportDialogProps } from './import-dialog.tsx';
export { IcsExportDialog, type IcsExportDialogProps } from './ics-export-dialog.tsx';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
}

/** 导出备份对话框：选模块与格式，Base64 文本可在框内复制或另存。 */
export function ExportDialog({ open, onOpenChange, storage }: ExportDialogProps) {
  const exportAction = useAction();
  /** 导出格式：JSON 文件、Base64 文本，或带预设与日志的整包 zip */
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [bundlePresets, setBundlePresets] = useState(true);
  const [bundleLogs, setBundleLogs] = useState(false);
  const [encryptExport, setEncryptExport] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('');
  const [exportText, setExportText] = useState('');
  const [exportModules, setExportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));

  /** 口令相关状态只活在对话框里：关闭、改口令或改加密开关都清空已生成文本。 */
  function resetEncryption(): void {
    setEncryptExport(false);
    setExportPassword('');
    setExportPasswordConfirm('');
  }

  function closeDialog(): void {
    setExportText('');
    resetEncryption();
    onOpenChange(false);
  }

  async function downloadBackup(): Promise<void> {
    if (encryptExport) {
      const issue = exportPasswordIssue(exportPassword, exportPasswordConfirm);
      if (issue !== null) {
        toast.error(fail(copy.encryptWhat, issue, copy.encryptNext));
        return;
      }
    }
    await exportAction.run({
      scope: 'backup',
      label: copy.exportingBackup,
      fail: false,
      task: async () => {
        const modules = [...exportModules];
        if (modules.length === 0) {
          toast.error(copy.moduleRequired);
          return;
        }
        const outcome = await exportConfig(storage, {
          modules,
          format: exportFormat,
          bundlePresets,
          bundleLogs,
          password: encryptExport ? exportPassword : undefined,
        });
        if (outcome.cancelled) {
          toast.info(copy.saveCancelled);
          return;
        }
        if (!outcome.ok) {
          // 损坏时 outcome.error 已是恢复引导文案；「换保存位置」提示保持不变
          toast.error(
            fail(copy.exportWhat, outcome.error, outcome.corrupt ? copy.exportNextCorrupt : copy.exportNext),
          );
          return;
        }
        const label = modules.map((module) => BACKUP_MODULE_LABEL[module]).join(copy.moduleSeparator);
        if (exportFormat === 'base64' && outcome.text !== null) {
          setExportText(outcome.text);
          toast.success(copy.base64Generated(label, encryptExport));
          return;
        }
        toastSaved(
          outcome.path === null
            ? copy.downloaded(outcome.name)
            : copy.backupExported(label, encryptExport),
          outcome.path,
        );
        closeDialog();
      },
    });
  }

  /** 导出 Base64 文本到文件：内容与文本框一致（加密时就是信封文本）。 */
  async function saveBase64Backup(): Promise<void> {
    if (exportText === '') return;
    const day = dayStampUtc(Date.now());
    const result = await saveText(`DawnTick-backup-${day}.base64.txt`, exportText, 'txt', copy.base64Filter);
    if (!result.saved) return;
    toastSaved(copy.base64Saved, result.path);
    closeDialog();
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
        else onOpenChange(next);
      }}
      title={copy.exportTitle}
      description={copy.exportDescription}
      submitLabel={exportFormat === 'base64' ? copy.exportSubmitText : copy.exportSubmit}
      submitting={exportAction.busy}
      submitDisabled={exportModules.size === 0}
      onSubmit={() => void downloadBackup()}
    >
      <div className="flex flex-col gap-1">
        {BACKUP_MODULES.map((module) => (
          <label key={module} className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              checked={exportModules.has(module)}
              aria-label={copy.exportModuleLabel(BACKUP_MODULE_LABEL[module])}
              onChange={(event) =>
                setExportModules((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(module);
                  else next.delete(module);
                  return next;
                })
              }
            />
            {BACKUP_MODULE_LABEL[module]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setExportModules(new Set(BACKUP_MODULES))}
        >
          {copy.selectAll}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExportModules(new Set())}>
          {copy.selectNone}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={exportFormat === 'json' ? 'primary' : 'secondary'}
          aria-label={copy.formatJsonLabel}
          onClick={() => setExportFormat('json')}
        >
          {copy.formatJson}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={exportFormat === 'base64' ? 'primary' : 'secondary'}
          aria-label={copy.formatBase64Label}
          onClick={() => setExportFormat('base64')}
        >
          {copy.formatBase64}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={exportFormat === 'zip' ? 'primary' : 'secondary'}
          aria-label={copy.formatZipLabel}
          onClick={() => setExportFormat('zip')}
        >
          {copy.formatZip}
        </Button>
      </div>
      {exportFormat === 'zip' && (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              aria-label={copy.bundlePresetsLabel}
              checked={bundlePresets}
              onChange={(event) => setBundlePresets(event.target.checked)}
            />
            {copy.bundlePresets}
          </label>
          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              aria-label={copy.bundleLogsLabel}
              checked={bundleLogs}
              onChange={(event) => setBundleLogs(event.target.checked)}
            />
            {copy.bundleLogs}
          </label>
        </div>
      )}
      <ExportEncryptionFields
        enabled={encryptExport}
        password={exportPassword}
        confirm={exportPasswordConfirm}
        onEnabledChange={(next) => {
          setEncryptExport(next);
          setExportText('');
        }}
        onPasswordChange={(next) => {
          setExportPassword(next);
          setExportText('');
        }}
        onConfirmChange={(next) => {
          setExportPasswordConfirm(next);
          setExportText('');
        }}
      />
      {exportFormat === 'base64' && exportText !== '' && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted">{copy.base64Hint}</span>
          <textarea
            readOnly
            data-role="export-base64"
            aria-label={copy.base64TextLabel}
            className="h-32 w-full rounded-md border border-line bg-surface-muted p-2 text-[11px] text-muted"
            value={exportText}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void copyText(exportText).then((ok) => {
                  if (ok) {
                    toast.success(copy.base64Copied);
                    return;
                  }
                  toast.error(fail(copy.copyWhat, null, copy.copyNext));
                });
              }}
            >
              {copy.copyText}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void saveBase64Backup()}>
              {copy.saveAsFile}
            </Button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}
