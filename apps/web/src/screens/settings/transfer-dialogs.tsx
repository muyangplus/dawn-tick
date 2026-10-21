import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeSemester,
  BACKUP_MODULES,
  BACKUP_MODULE_LABEL,
  IMPORT_MODE_LABEL,
  IMPORT_MODES,
  listCourses,
  listSchedules,
  listTimeSlots,
  summarizeBackup,
  type BackupModule,
  type BackupPayload,
  type EventRow,
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
import { buildIcsExport, type IcsExportInput } from '../../lib/ics-export.ts';
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

export interface IcsExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
}

const ICS_USER_ID = 'u1';

/**
 * 导出课表为 ICS（R-01）：按 Q17 勾选模块（课表必选、日程可选），
 * 数据组装交给 `lib/ics-export.ts`，这里只做读取、选择与保存。
 */
export function IcsExportDialog({ open, onOpenChange, storage }: IcsExportDialogProps) {
  const exportAction = useAction();
  const [source, setSource] = useState<IcsExportInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 日程默认不勾：只导课表是大多数人的用法（Q17） */
  const [includeEvents, setIncludeEvents] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSource(null);
    setLoadError(null);
    setIncludeEvents(false);
    setLoading(true);
    void (async () => {
      try {
        const semester = await activeSemester(storage, ICS_USER_ID);
        if (semester === undefined) {
          if (!cancelled) setLoading(false);
          return;
        }
        const [slots, courses, schedules, events] = await Promise.all([
          listTimeSlots(storage, semester.id),
          listCourses(storage, semester.id),
          listSchedules(storage, semester.id),
          storage.collection<EventRow>('events').getAll(),
        ]);
        if (!cancelled) {
          setSource({ semester, slots, courses, schedules, events });
          setLoading(false);
        }
      } catch (cause: unknown) {
        if (!cancelled) {
          setLoadError(errorMessage(cause));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, storage]);

  const built = useMemo(() => {
    if (source === null) return { plan: null, error: null };
    try {
      return { plan: buildIcsExport(source, { includeEvents }), error: null };
    } catch (cause: unknown) {
      // 数据异常时留在对话框里给可读提示，不让整页渲染崩掉
      return { plan: null, error: errorMessage(cause) };
    }
  }, [source, includeEvents]);
  const plan = built.plan;

  async function saveIcs(): Promise<void> {
    if (plan === null) return;
    await exportAction.run({
      scope: 'export',
      label: '正在导出课表…',
      fail: false,
      task: async () => {
        const saved = await saveText(plan.fileName, plan.text, 'ics', 'ICS 日历', 'text/calendar');
        if (!saved.saved) return;
        toastSaved(`已导出课表（ICS，${plan.counts.courses} 门课程）`, saved.path);
        onOpenChange(false);
      },
    });
  }

  const empty = plan !== null && plan.counts.lessons === 0 && plan.counts.events === 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="导出课表（ICS）"
      description="勾选要导出的模块，生成 .ics 日历文件"
      submitLabel="导出"
      submitting={exportAction.busy}
      submitDisabled={plan === null || empty || loading}
      onSubmit={() => void saveIcs()}
      contentAttrs={{ 'data-role': 'ics-export-dialog' }}
    >
      {loading && <span className="text-sm text-muted">正在读取学期数据…</span>}
      {!loading && loadError !== null && (
        <span className="text-sm text-danger">读取学期数据失败：{loadError}</span>
      )}
      {!loading && loadError === null && built.error !== null && (
        <span className="text-sm text-danger">生成课表数据失败：{built.error}</span>
      )}
      {!loading && loadError === null && built.error === null && source === null && (
        <span className="text-sm text-muted">还没有学期，先在设置里创建学期再导出。</span>
      )}
      {plan !== null && source !== null && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink" data-role="ics-semester">
              学期：{source.semester.name}
            </span>
            <span className="text-xs text-muted" data-role="ics-counts">
              课程 {plan.counts.courses} 门 · 排课 {plan.counts.schedules} 条 · 上课 {plan.counts.lessons} 次
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="size-4"
                checked
                disabled
                aria-label="导出 课表"
              />
              课表（必选）
            </label>
            <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="size-4"
                checked={includeEvents}
                disabled={plan.counts.events === 0}
                aria-label="导出 日程"
                onChange={(event) => setIncludeEvents(event.target.checked)}
              />
              日程
              <span className="text-xs text-muted">
                {plan.counts.events === 0 ? '（没有可写入的日程）' : `（${plan.counts.events} 条）`}
              </span>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted" data-role="ics-policy">
              调课按调整后的时间和地点写入；停课不导出。
            </span>
            {plan.notes.length > 0 && (
              <span className="text-xs text-muted" data-role="ics-notes">
                {plan.notes.join('；')}
              </span>
            )}
            {empty && <span className="text-xs text-muted">当前学期没有可导出的课表条目。</span>}
          </div>
        </>
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
