import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_MODULES,
  BACKUP_MODULE_LABEL,
  IMPORT_MODE_LABEL,
  IMPORT_MODES,
  activeSemesterConflict,
  summarizeBackup,
  type ActiveSemesterChoice,
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
import { fail } from '../../copy/common.ts';
import { useAction } from '../../lib/action.ts';
import { Button } from '../../components/ui/button.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { UnlockBackupDialog } from './backup-encryption.tsx';
import { importShareText, looksLikeShare } from '../../lib/share-file.ts';
import { transferCopy as copy } from '../../copy/backup-transfer.ts';

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
  /** 备份与本机各有一个当前学期时让用户选保留哪个；没有冲突时为 null */
  const [semesterConflict, setSemesterConflict] = useState<{ local: string; incoming: string } | null>(null);
  const [activeChoice, setActiveChoice] = useState<ActiveSemesterChoice>('keep-local');

  useEffect(() => {
    let cancelled = false;
    setSemesterConflict(null);
    setActiveChoice('keep-local');
    if (pendingImport === null) return undefined;
    void activeSemesterConflict(storage, pendingImport).then((conflict) => {
      if (!cancelled) setSemesterConflict(conflict);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingImport, storage]);
  const [lockedSource, setLockedSource] = useState<LockedSource | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  /** 读到了可用备份：关掉入口对话框，交给下面的模块选择框。 */
  function acceptResult(result: ImportFileResult, successToast: string | null): void {
    if (result.payload === null) {
      toast.error(fail(copy.readWhat, result.error, copy.readNext));
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

  /** 课表分享文件：不进模块选择，直接导入为一个新学期。 */
  async function importShare(text: string): Promise<void> {
    await importAction.run({
      scope: 'backup',
      label: copy.importingShare,
      fail: { what: copy.importShareFailed, next: copy.importShareNext },
      task: async () => {
        const outcome = await importShareText(storage, text);
        toast.success(copy.shareImported(outcome.semesterName, outcome.skipped));
        setImportText('');
        onOpenChange(false);
        onChanged();
      },
    });
  }

  /** 导入对话框里粘贴的文本：JSON、Base64 与加密信封都接受。 */
  async function parsePastedBackup(): Promise<void> {
    const text = importText.trim();
    if (text === '') {
      toast.error(copy.pasteRequired);
      return;
    }
    if (looksLikeShare(text)) {
      await importShare(text);
      return;
    }
    const result = await importPastedText(text);
    if (result.locked) {
      startUnlock({ kind: 'text', text });
      return;
    }
    acceptResult(result, copy.pastedParsed);
  }

  async function chooseBackupFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      const text = await file.text();
      if (looksLikeShare(text)) {
        await importShare(text);
        return;
      }
    }
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
      setUnlockError(result.error ?? copy.passwordWrong);
      return;
    }
    setLockedSource(null);
    setUnlockPassword('');
    acceptResult(result, copy.decrypted);
  }

  async function confirmImport(): Promise<void> {
    if (pendingImport === null) return;
    const target = pendingImport;
    await importAction.run({
      scope: 'backup',
      label: copy.importingBackup,
      fail: { what: copy.importFailed, next: copy.importNext },
      task: async () => {
        const modules = [...importModules];
        if (modules.length === 0) {
          toast.error(copy.moduleRequired);
          return;
        }
        const result = await importConfig(storage, target, {
          mode: importMode,
          modules,
          extras: pendingImportExtras,
          ...(semesterConflict === null ? {} : { activeSemester: activeChoice }),
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
        title={copy.importTitle}
        description={copy.importDescription}
        submitLabel={copy.importFromText}
        submitDisabled={importText.trim().length === 0}
        onSubmit={() => void parsePastedBackup()}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={copy.chooseFile}
            disabled={importAction.busy}
            onClick={() => fileInput.current?.click()}
          >
            {copy.chooseFile}
          </Button>
          <span className="text-xs text-muted">
            {copy.importFormatsHint}
          </span>
        </div>
        <textarea
          data-role="import-text"
          aria-label={copy.importTextLabel}
          placeholder={copy.importTextPlaceholder}
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
        title={copy.moduleTitle}
        description={copy.moduleDescription}
        submitLabel={copy.moduleSubmit}
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
                  aria-label={copy.importModuleLabel(BACKUP_MODULE_LABEL[item.module])}
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
                <span className="text-xs text-muted">{copy.moduleRows(item.rows)}</span>
              </label>
            ))}
        </div>
        {semesterConflict !== null && importModules.has('semesters') ? (
          <div className="flex flex-col gap-1" data-role="import-active-semester">
            <span className="text-xs text-muted">{copy.activeSemester}</span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={activeChoice === 'keep-local' ? 'primary' : 'secondary'}
                aria-label={copy.keepLocalLabel(semesterConflict.local)}
                onClick={() => setActiveChoice('keep-local')}
              >
                {copy.keepLocal(semesterConflict.local)}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeChoice === 'use-incoming' ? 'primary' : 'secondary'}
                aria-label={copy.useIncomingLabel(semesterConflict.incoming)}
                onClick={() => setActiveChoice('use-incoming')}
              >
                {copy.useIncoming(semesterConflict.incoming)}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {IMPORT_MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={importMode === mode ? 'primary' : 'secondary'}
              aria-label={copy.importModeLabel(IMPORT_MODE_LABEL[mode])}
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
