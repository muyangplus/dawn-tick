import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_MODULE_LABEL,
  addDays,
  createSemester,
  formatDate,
  summarizeBackup,
  weekStart,
  type BackupPayload,
  type Storage,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Card, CardTitle } from '../components/ui/card.tsx';
import { confirmAction } from '../components/ui/confirm-dialog.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { HelpHint } from '../components/ui/help-hint.tsx';
import { InlineError } from '../components/ui/inline-error.tsx';
import { SchoolPickerDialog } from '../components/school-picker-dialog.tsx';
import { toast } from '../components/ui/toaster.tsx';
import {
  importConfig,
  parseImportText,
  presentModules,
  readImportFile,
  type PackageExtras,
} from '../data-management.ts';
import { applySchoolTimetable, loadPresetContext, type PresetContext, type School } from './school-picker-model.ts';
import { readRecentSchool, writeRecentSchool } from '../school-recent.ts';
import { useAction } from '../lib/action.ts';
import { errorMessage } from '../lib/errors.ts';
import { onboardingCopy } from '../copy/onboarding.ts';

export interface OnboardingProps {
  storage: Storage;
  userId: string;
  timeZone: string;
  onDone: () => void;
}

/** 跳过引导时用的默认学期。 */
const DEFAULT_SEMESTER_NAME = onboardingCopy.defaultSemesterName;
const DEFAULT_WEEKS = 20;

export function Onboarding({ storage, userId, timeZone, onDone }: OnboardingProps) {
  const today = formatDate(Date.now(), timeZone);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => weekStart(today));
  const [totalWeeks, setTotalWeeks] = useState(20);
  const [error, setError] = useState<string | null>(null);
  /** 导入自己的错误：显示在导入分区里，不跟建学期的错误混在一起 */
  const [importError, setImportError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const [pending, setPending] = useState<BackupPayload | null>(null);
  /** 整包 zip 里的预设与日志；JSON / Base64 输入为 null */
  const [pendingExtras, setPendingExtras] = useState<PackageExtras | null>(null);
  const [importText, setImportText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** 首次使用时选的学校：创建学期后按该校作息排课次，之后在作息设置里可一键再套用 */
  const [school, setSchool] = useState<School | null>(null);
  const [context, setContext] = useState<PresetContext | null>(null);
  const [recent, setRecent] = useState<School | null>(null);
  /** 选校弹窗：与教务导入一样用弹窗挑，不再把长列表铺在页面上 */
  const [schoolOpen, setSchoolOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [presetContext, stored] = await Promise.all([loadPresetContext(storage), readRecentSchool(storage)]);
      if (cancelled) return;
      setContext(presetContext);
      setRecent(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  /** 读备份文件：JSON / Base64 文本 / 整包 zip 都走设置页同一套解析与错误文案。 */
  async function pickFile(file: File): Promise<void> {
    setImportError(null);
    const { payload, extras, error: readError } = await readImportFile(file);
    if (payload === null) {
      setImportError(readError ?? onboardingCopy.readFailed);
      return;
    }
    setPending(payload);
    setPendingExtras(extras);
  }

  /** 粘贴的文本：JSON 与 Base64 都接受；整包 zip 只能选文件。 */
  function pickText(): void {
    setImportError(null);
    try {
      setPending(parseImportText(importText));
      setPendingExtras(null);
    } catch (cause: unknown) {
      setImportError(errorMessage(cause));
    }
  }

  function clearPending(): void {
    setPending(null);
    setPendingExtras(null);
    setImportError(null);
  }

  async function applyImport(): Promise<void> {
    if (pending === null) return;
    const target = pending;
    setImportError(null);
    const result = await run({
      scope: 'app',
      label: onboardingCopy.importing,
      fail: { what: onboardingCopy.importFailed, next: onboardingCopy.importFailedNext },
      confirm: () =>
        confirmAction({
          title: onboardingCopy.overwriteTitle,
          description: onboardingCopy.overwriteWarning,
          confirmLabel: onboardingCopy.overwriteConfirmButton,
        }),
      task: async () => {
        const modules = presentModules(target);
        // 整包可能只带预设快照、没有设置行：补上 settings 才会写回预设
        const hasPresets =
          pendingExtras !== null &&
          (pendingExtras.presets.snapshot !== null || pendingExtras.presets.content !== null);
        if (hasPresets && !modules.includes('settings')) modules.push('settings');
        const imported = await importConfig(storage, target, {
          mode: 'overwrite',
          modules,
          extras: pendingExtras,
        });
        toast.success(onboardingCopy.imported(imported.imported, imported.presets));
        onDone();
      },
    });
    if (!result.ok && result.error !== null) setImportError(result.error);
  }

  /** 建学期：跳过引导与「创建并开始」共用这一段，只有取值来源不同。 */
  async function createSemesterWith(
    semesterName: string,
    start: string,
    weeks: number,
    picked: School | null,
  ): Promise<void> {
    setError(null);
    const result = await run({
      scope: 'app',
      label: onboardingCopy.creating,
      task: async () => {
        const semester = await createSemester(storage, {
          userId,
          name: semesterName,
          startDate: start,
          totalWeeks: weeks,
          timeZone,
        });
        if (picked !== null) {
          // 记录这次选择：作息设置里据此置顶「一键套用」
          await writeRecentSchool(storage, picked);
          try {
            const applied = await applySchoolTimetable(storage, String(semester['id']), picked);
            toast.success(onboardingCopy.schoolApplied(picked.name, applied.periods));
          } catch (cause: unknown) {
            // 套用作息失败不影响学期创建，用户可在作息设置里重来
            setError(onboardingCopy.schoolApplyFailed(errorMessage(cause)));
          }
        } else {
          toast.success(onboardingCopy.created);
        }
        onDone();
      },
    });
    if (!result.ok && result.error !== null) setError(result.error);
  }

  async function submit(): Promise<void> {
    await createSemesterWith(
      name.trim().length > 0 ? name.trim() : DEFAULT_SEMESTER_NAME,
      startDate,
      totalWeeks,
      school,
    );
  }

  /** 跳过引导：直接用默认值建学期（学期名、本周一开学、20 周、内置默认作息）。 */
  async function skip(): Promise<void> {
    await createSemesterWith(DEFAULT_SEMESTER_NAME, weekStart(today), DEFAULT_WEEKS, null);
  }

  return (
    <main
      className="flex h-full items-start justify-center overflow-y-auto overscroll-contain bg-page p-4"
      data-role="onboarding-scroll"
    >
      <div className="my-auto w-full max-w-md">
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{onboardingCopy.title}</CardTitle>
            <span className="text-xs text-muted">{onboardingCopy.subtitle}</span>
          </div>
          <Field label={onboardingCopy.nameLabel}>
            <Input
              value={name}
              placeholder={onboardingCopy.namePlaceholder}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={onboardingCopy.startLabel} hint={onboardingCopy.startHint}>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label={onboardingCopy.weeksLabel}>
            <Input
              type="number"
              min={1}
              max={30}
              value={totalWeeks}
              onChange={(event) => setTotalWeeks(Number(event.target.value))}
            />
          </Field>
          {error !== null && <InlineError>{error}</InlineError>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              {onboardingCopy.createButton}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStartDate(addDays(weekStart(formatDate(Date.now(), timeZone)), 7))}
            >
              {onboardingCopy.nextMondayButton}
            </Button>
            <Button
              variant="ghost"
              aria-label={onboardingCopy.skipLabel}
              disabled={busy}
              onClick={() => void skip()}
            >
              {onboardingCopy.skipButton}
            </Button>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted">
            {onboardingCopy.skipNote(DEFAULT_SEMESTER_NAME, DEFAULT_WEEKS)}
            <HelpHint label={onboardingCopy.skipLabel}>{onboardingCopy.skipHelp}</HelpHint>
          </span>

          <details className="flex flex-col gap-2 border-t border-line pt-4" data-role="onboarding-advanced">
            <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
              {onboardingCopy.advancedSummary(school?.name ?? null)}
            </summary>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted" data-role="onboarding-school-picked">
                {school === null ? onboardingCopy.noSchool : onboardingCopy.pickedSchool(school.name)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                aria-label={onboardingCopy.pickSchoolButton}
                onClick={() => setSchoolOpen(true)}
              >
                {onboardingCopy.pickSchoolButton}
              </Button>
              {school !== null && (
                <Button variant="ghost" size="sm" aria-label={onboardingCopy.unpickSchoolLabel} onClick={() => setSchool(null)}>
                  {onboardingCopy.unpickSchoolButton}
                </Button>
              )}
            </div>
          </details>

          <SchoolPickerDialog
            open={schoolOpen}
            onOpenChange={setSchoolOpen}
            context={context}
            selectedId={school?.id ?? recent?.id ?? null}
            pinned={recent}
            onPick={(picked) => setSchool(picked)}
          />

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="text-xs font-semibold text-ink">{onboardingCopy.importTitle}</span>
            <span className="text-xs text-muted" data-role="onboarding-import-formats">
              {onboardingCopy.importFormats}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,text/plain,application/zip,.json,.txt,.zip"
              className="hidden"
              aria-label={onboardingCopy.pickFileButton}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file !== undefined) void pickFile(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" aria-label={onboardingCopy.pickFileButton} disabled={busy} onClick={() => fileRef.current?.click()}>
                {onboardingCopy.pickFileButton}
              </Button>
            </div>
            <textarea
              data-role="onboarding-import-text"
              aria-label={onboardingCopy.textLabel}
              placeholder={onboardingCopy.textPlaceholder}
              className="h-20 w-full rounded-md border border-line bg-surface p-2 text-[11px] text-ink"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                aria-label={onboardingCopy.importTextButton}
                disabled={busy || importText.trim().length === 0}
                onClick={pickText}
              >
                {onboardingCopy.importTextButton}
              </Button>
            </div>
            {pending !== null && (
              <>
                <span className="text-xs text-muted">
                  {onboardingCopy.list(
                    summarizeBackup(pending).map((item) =>
                      onboardingCopy.moduleRows(BACKUP_MODULE_LABEL[item.module], item.rows),
                    ),
                  )}
                </span>
                <InlineError data-role="onboarding-overwrite-hint">
                  {onboardingCopy.overwriteWarning}
                </InlineError>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" aria-label={onboardingCopy.confirmImportButton} loading={busy} onClick={() => void applyImport()}>
                    {onboardingCopy.confirmImportButton}
                  </Button>
                  <Button variant="ghost" aria-label={onboardingCopy.cancelImportLabel} disabled={busy} onClick={clearPending}>
                    {onboardingCopy.cancel}
                  </Button>
                </div>
                <span className="text-xs text-muted">
                  {onboardingCopy.importModules(
                    pending.modules === undefined
                      ? null
                      : onboardingCopy.list(pending.modules.map((item) => BACKUP_MODULE_LABEL[item])),
                  )}
                </span>
              </>
            )}
            {importError !== null && (
              <InlineError data-role="onboarding-import-error">{importError}</InlineError>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
