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
  importConfig,
  importPastedText,
  importResultText,
  presentModules,
  readImportFile,
  type ImportFileResult,
  type PackageExtras,
} from '../../data-management.ts';
import { fail } from '../../copy/zh.ts';
import { useAction } from '../../lib/action.ts';
import { Button } from '../../components/ui/button.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { UnlockBackupDialog } from './backup-encryption.tsx';

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  onChanged: () => void;
}

/** 需要口令才能继续的导入来源：文件要能重新读，粘贴文本原样留在内存里。 */
type LockedSource = { kind: 'file'; file: File } | { kind: 'text'; text: string };

/**
 * 导入备份对话框：文件与粘贴两种入口，解析后在同一组件里选模块与冲突处理。
 *
 * 加密信封先识别再要口令；明文备份完全不弹口令框，历史流程不变。
 */
export function ImportDialog({ open, onOpenChange, storage, onChanged }: ImportDialogProps) {
  const importAction = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importText, setImportText] = useState('');
  const [pendingImport, setPendingImport] = useState<BackupPayload | null>(null);
  /** 整包里带出的预设与日志：导入时随设置一起恢复，JSON 粘贴输入为 null */
  const [pendingImportExtras, setPendingImportExtras] = useState<PackageExtras | null>(null);
  const [importModules, setImportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));
  const [importMode, setImportMode] = useState<ImportMode>('skip');
  const [lockedSource, setLockedSource] = useState<LockedSource | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  /** 读到了可用备份：关掉入口对话框，交给下面的模块选择框。 */
  function acceptResult(result: ImportFileResult, successToast: string | null): void {
    if (result.payload === null) {
      toast.error(fail('读取备份', result.error, '请检查备份文件或文本是否完整'));
      return;
    }
    setPendingImport(result.payload);
    setPendingImportExtras(result.extras);
    setImportModules(new Set(presentModules(result.payload)));
    setImportMode('skip');
    onOpenChange(false);
    if (successToast !== null) toast.success(successToast);
  }

  /** 识别到加密信封：关掉入口框，换口令框等输入。 */
  function startUnlock(source: LockedSource): void {
    setLockedSource(source);
    setUnlockPassword('');
    setUnlockError(null);
    onOpenChange(false);
  }

  /** 导入对话框里粘贴的文本：JSON、Base64 与加密信封都接受。 */
  async function parsePastedBackup(): Promise<void> {
    const text = importText.trim();
    if (text === '') {
      toast.error('请先粘贴备份文本');
      return;
    }
    const result = await importPastedText(text);
    if (result.locked) {
      startUnlock({ kind: 'text', text });
      return;
    }
    acceptResult(result, '已解析粘贴的备份文本');
  }

  async function chooseBackupFile(file: File): Promise<void> {
    const result = await readImportFile(file);
    if (result.locked) {
      startUnlock({ kind: 'file', file });
      return;
    }
    acceptResult(result, null);
  }

  /** 用输入的口令重试解密；错误留在口令框里，可以继续改。 */
  async function unlockBackup(): Promise<void> {
    if (lockedSource === null || unlockPassword === '') return;
    setUnlocking(true);
    setUnlockError(null);
    const result =
      lockedSource.kind === 'file'
        ? await readImportFile(lockedSource.file, unlockPassword)
        : await importPastedText(lockedSource.text, unlockPassword);
    setUnlocking(false);
    if (result.payload === null) {
      setUnlockError(result.error ?? '口令错误，请重试');
      return;
    }
    setLockedSource(null);
    setUnlockPassword('');
    acceptResult(result, '已解密备份');
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
        onSubmit={() => void parsePastedBackup()}
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
          <span className="text-xs text-muted">
            支持晓刻导出的 JSON、Base64 文本与整包 zip；加密备份会提示输入口令
          </span>
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

      <UnlockBackupDialog
        open={lockedSource !== null}
        password={unlockPassword}
        error={unlockError}
        busy={unlocking}
        onPasswordChange={(value) => {
          setUnlockPassword(value);
          if (unlockError !== null) setUnlockError(null);
        }}
        onSubmit={() => void unlockBackup()}
        onOpenChange={(next) => {
          if (next) return;
          setLockedSource(null);
          setUnlockPassword('');
          setUnlockError(null);
        }}
      />

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
