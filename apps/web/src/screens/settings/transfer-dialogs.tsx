import { useRef, useState } from 'react';
import {
  BACKUP_MODULES,
  BACKUP_MODULE_LABEL,
  IMPORT_MODE_LABEL,
  IMPORT_MODES,
  summarizeBackup,
  type BackupModule,
  type BackupPayload,
  type ImportMode,
  type Storage,
} from '@dawn-tick/core';
import {
  exportConfig,
  importConfig,
  importResultText,
  parseImportText,
  presentModules,
  readImportFile,
  type ExportFormat,
  type PackageExtras,
} from '../../data-management.ts';
import { dayStampUtc } from '../../lib/dates.ts';
import { copyText } from '../../system-actions.ts';
import { useAction } from '../../lib/action.ts';
import { errorMessage } from '../../lib/errors.ts';
import { fail } from '../../copy/zh.ts';
import { Button } from '../../components/ui/button.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { saveText, toastSaved } from './file-export.ts';

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
  const [exportText, setExportText] = useState('');
  const [exportModules, setExportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));

  async function downloadBackup(): Promise<void> {
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
          toast.success(`已生成 Base64 文本（${label}）`);
          return;
        }
        toastSaved(outcome.path === null ? `已下载 ${outcome.name}` : `已导出备份（${label}）`, outcome.path);
        onOpenChange(false);
      },
    });
  }

  /** 导出 Base64 文本到文件：内容与文本框一致。 */
  async function saveBase64Backup(): Promise<void> {
    if (exportText === '') return;
    const day = dayStampUtc(Date.now());
    const result = await saveText(`DawnTick-backup-${day}.base64.txt`, exportText, 'txt', 'Base64 文本');
    if (!result.saved) return;
    toastSaved('已保存 Base64 文本', result.path);
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setExportText('');
        onOpenChange(next);
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

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  onChanged: () => void;
}

/** 导入备份对话框：文件与粘贴两种入口，解析后在同一组件里选模块与冲突处理。 */
export function ImportDialog({ open, onOpenChange, storage, onChanged }: ImportDialogProps) {
  const importAction = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importText, setImportText] = useState('');
  const [pendingImport, setPendingImport] = useState<BackupPayload | null>(null);
  /** 整包里带出的预设与日志：导入时随设置一起恢复，JSON 粘贴输入为 null */
  const [pendingImportExtras, setPendingImportExtras] = useState<PackageExtras | null>(null);
  const [importModules, setImportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));
  const [importMode, setImportMode] = useState<ImportMode>('skip');

  /** 导入对话框里粘贴的文本：JSON 与 Base64 都接受。 */
  function parsePastedBackup(): void {
    const text = importText.trim();
    if (text === '') {
      toast.error('请先粘贴备份文本');
      return;
    }
    try {
      const payload = parseImportText(text);
      setPendingImport(payload);
      setPendingImportExtras(null);
      setImportModules(new Set(presentModules(payload)));
      setImportMode('skip');
      onOpenChange(false);
      toast.success('已解析粘贴的备份文本');
    } catch (cause: unknown) {
      toast.error(fail('解析备份文本', errorMessage(cause), '请检查文本是否完整'));
    }
  }

  async function chooseBackupFile(file: File): Promise<void> {
    const { payload, extras, error } = await readImportFile(file);
    if (payload === null) {
      toast.error(fail('读取备份文件', error, '请换一个文件重试'));
      return;
    }
    setPendingImport(payload);
    setPendingImportExtras(extras);
    setImportModules(new Set(presentModules(payload)));
    setImportMode('skip');
    onOpenChange(false);
  }

  async function confirmImport(): Promise<void> {
    if (pendingImport === null) return;
    const target = pendingImport;
    await importAction.run({
      scope: 'backup',
      label: '正在导入备份…',
      fail: { what: '导入备份失败', next: '请检查备份文件与勾选模块后重试。' },
      task: async () => {
        const modules = [...importModules];
        if (modules.length === 0) {
          toast.error('请至少勾选一个模块');
          return;
        }
        const result = await importConfig(storage, target, {
          mode: importMode,
          modules,
          extras: pendingImportExtras,
        });
        toast.success(importResultText(result, importMode));
        setPendingImport(null);
        setPendingImportExtras(null);
        onChanged();
      },
    });
  }

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
          else onOpenChange(next);
        }}
        title="导入备份"
        description="选择备份文件，或直接粘贴 JSON / Base64 文本"
        submitLabel="从文本导入"
        submitDisabled={importText.trim().length === 0}
        onSubmit={parsePastedBackup}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="选择备份文件"
            disabled={importAction.busy}
            onClick={() => fileInput.current?.click()}
          >
            选择备份文件
          </Button>
          <span className="text-xs text-muted">支持晓刻导出的 JSON、Base64 文本与整包 zip</span>
        </div>
        <textarea
          data-role="import-text"
          aria-label="备份文本"
          placeholder="或在此粘贴 JSON / Base64 备份文本"
          className="h-32 w-full rounded-md border border-line bg-surface p-2 text-[11px] text-ink"
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
        />
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json,.zip,.txt"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void chooseBackupFile(file);
            event.target.value = '';
          }}
        />
      </FormDialog>

      <FormDialog
        open={pendingImport !== null}
        onOpenChange={(next) => {
          if (!next) setPendingImport(null);
        }}
        title="导入备份"
        description="选模块与冲突处理"
        submitLabel="导入"
        submitting={importAction.busy}
        submitDisabled={importModules.size === 0}
        onSubmit={() => void confirmImport()}
      >
        <div className="flex flex-col gap-1">
          {summarizeBackup(pendingImport ?? { format: 'dawn-tick-backup', version: 1, exportedAt: 0, stores: {}, meta: {} })
            .filter((item) => item.rows > 0)
            .map((item) => (
              <label key={item.module} className="flex min-h-tap items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={importModules.has(item.module)}
                  aria-label={`导入 ${BACKUP_MODULE_LABEL[item.module]}`}
                  onChange={(event) =>
                    setImportModules((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(item.module);
                      else next.delete(item.module);
                      return next;
                    })
                  }
                />
                {BACKUP_MODULE_LABEL[item.module]}
                <span className="text-xs text-muted">{item.rows} 条</span>
              </label>
            ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {IMPORT_MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={importMode === mode ? 'primary' : 'secondary'}
              aria-label={`导入方式：${IMPORT_MODE_LABEL[mode]}`}
              onClick={() => setImportMode(mode)}
            >
              {IMPORT_MODE_LABEL[mode]}
            </Button>
          ))}
        </div>
      </FormDialog>
    </>
  );
}
