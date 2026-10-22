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
import { fail } from '../../copy/zh.ts';
import { Button } from '../../components/ui/button.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { ExportEncryptionFields, exportPasswordIssue } from './backup-encryption.tsx';
import { saveText, toastSaved } from './file-export.ts';

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
        toast.error(fail('加密', issue, '请修改口令后重试'));
        return;
      }
    }
    await exportAction.run({
      scope: 'backup',
      label: '正在导出备份…',
      fail: false,
      task: async () => {
        const modules = [...exportModules];
        if (modules.length === 0) {
          toast.error('请至少勾选一个模块');
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
          toast.info('已取消保存');
          return;
        }
        if (!outcome.ok) {
          toast.error(fail('导出', outcome.error, '请重试或换一个保存位置'));
          return;
        }
        const label = modules.map((module) => BACKUP_MODULE_LABEL[module]).join('、');
        if (exportFormat === 'base64' && outcome.text !== null) {
          setExportText(outcome.text);
          toast.success(
            encryptExport ? `已生成加密 Base64 文本（${label}）` : `已生成 Base64 文本（${label}）`,
          );
          return;
        }
        toastSaved(
          outcome.path === null
            ? `已下载 ${outcome.name}`
            : `已${encryptExport ? '加密' : ''}导出备份（${label}）`,
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
    const result = await saveText(`DawnTick-backup-${day}.base64.txt`, exportText, 'txt', 'Base64 文本');
    if (!result.saved) return;
    toastSaved('已保存 Base64 文本', result.path);
    closeDialog();
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
        else onOpenChange(next);
      }}
      title="导出备份"
      description="勾选要导出的模块，并选择导出格式"
      submitLabel={exportFormat === 'base64' ? '生成文本' : '导出'}
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
              aria-label={`导出 ${BACKUP_MODULE_LABEL[module]}`}
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
          全选
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExportModules(new Set())}>
          清空
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={exportFormat === 'json' ? 'primary' : 'secondary'}
          aria-label="导出为 JSON 文件"
          onClick={() => setExportFormat('json')}
        >
          JSON 文件
        </Button>
        <Button
          type="button"
          size="sm"
          variant={exportFormat === 'base64' ? 'primary' : 'secondary'}
          aria-label="导出为 Base64 文本"
          onClick={() => setExportFormat('base64')}
        >
          Base64 文本
        </Button>
        <Button
          type="button"
          size="sm"
          variant={exportFormat === 'zip' ? 'primary' : 'secondary'}
          aria-label="导出为整包 zip"
          onClick={() => setExportFormat('zip')}
        >
          整包 zip
        </Button>
      </div>
      {exportFormat === 'zip' && (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              aria-label="整包包含预设"
              checked={bundlePresets}
              onChange={(event) => setBundlePresets(event.target.checked)}
            />
            一并打包预设
          </label>
          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              aria-label="整包包含日志文件"
              checked={bundleLogs}
              onChange={(event) => setBundleLogs(event.target.checked)}
            />
            一并打包日志文件
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
          <span className="text-xs text-muted">复制下面这段文本，或保存成文件后传输。</span>
          <textarea
            readOnly
            data-role="export-base64"
            aria-label="Base64 备份文本"
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
                    toast.success('已复制 Base64 文本');
                    return;
                  }
                  toast.error(fail('复制', null, '请手动选中文本复制'));
                });
              }}
            >
              复制文本
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void saveBase64Backup()}>
              保存为文件
            </Button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}
