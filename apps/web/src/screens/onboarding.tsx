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

export interface OnboardingProps {
  storage: Storage;
  userId: string;
  timeZone: string;
  onDone: () => void;
}

/** 跳过引导时用的默认学期。 */
const DEFAULT_SEMESTER_NAME = '我的学期';
const DEFAULT_WEEKS = 20;

export function Onboarding({ storage, userId, timeZone, onDone }: OnboardingProps) {
  const today = formatDate(Date.now(), timeZone);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => weekStart(today));
  const [totalWeeks, setTotalWeeks] = useState(20);
  const [error, setError] = useState<string | null>(null);
  /** 导入自己的错误：显示在导入分区里，不跟建学期的错误混在一起 */
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      setImportError(readError ?? '读取备份文件失败');
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
      setImportError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function clearPending(): void {
    setPending(null);
    setPendingExtras(null);
    setImportError(null);
  }

  async function applyImport(): Promise<void> {
    if (pending === null) return;
    const ok = await confirmAction({
      title: '覆盖现有数据',
      description: '将覆盖设备上的现有数据，不可撤销',
      confirmLabel: '确认覆盖',
    });
    if (!ok) return;
    setBusy(true);
    setImportError(null);
    try {
      const modules = presentModules(pending);
      // 整包可能只带预设快照、没有设置行：补上 settings 才会写回预设
      const hasPresets =
        pendingExtras !== null &&
        (pendingExtras.presets.snapshot !== null || pendingExtras.presets.content !== null);
      if (hasPresets && !modules.includes('settings')) modules.push('settings');
      const result = await importConfig(storage, pending, {
        mode: 'overwrite',
        modules,
        extras: pendingExtras,
      });
      toast.success(`已导入 ${result.imported} 条记录${result.presets ? '，已恢复预设' : ''}`);
      onDone();
    } catch (cause: unknown) {
      setImportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /** 建学期：跳过引导与「创建并开始」共用这一段，只有取值来源不同。 */
  async function createSemesterWith(
    semesterName: string,
    start: string,
    weeks: number,
    picked: School | null,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
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
          const result = await applySchoolTimetable(storage, String(semester['id']), picked);
          toast.success(`已按 ${picked.name} 排好节次（${result.periods} 节）`);
        } catch (cause: unknown) {
          // 套用作息失败不影响学期创建，用户可在作息设置里重来
          setError(`学期已创建，但套用作息失败：${cause instanceof Error ? cause.message : String(cause)}`);
        }
      } else {
        toast.success('学期已创建');
      }
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
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
            <CardTitle>欢迎使用晓刻 DawnTick</CardTitle>
            <span className="text-xs text-muted">先创建学期；课表按周次计算</span>
          </div>
          <Field label="学期名称">
            <Input
              value={name}
              placeholder="2026-2027 第一学期"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="开学日期" hint="该周记为第 1 周">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="总周数">
            <Input
              type="number"
              min={1}
              max={30}
              value={totalWeeks}
              onChange={(event) => setTotalWeeks(Number(event.target.value))}
            />
          </Field>
          {error !== null && <p className="text-xs text-danger-strong">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              创建并开始
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStartDate(addDays(weekStart(formatDate(Date.now(), timeZone)), 7))}
            >
              下周一开学
            </Button>
            <Button
              variant="ghost"
              aria-label="跳过引导"
              disabled={busy}
              onClick={() => void skip()}
            >
              跳过，先用默认学期
            </Button>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted">
            跳过会建一个「{DEFAULT_SEMESTER_NAME}」（本周一开学、{DEFAULT_WEEKS} 周）
            <HelpHint label="跳过引导">使用内置默认作息，之后可在设置里修改</HelpHint>
          </span>

          <details className="flex flex-col gap-2 border-t border-line pt-4" data-role="onboarding-advanced">
            <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
              高级设置：按学校套用作息{school === null ? '' : `（已选 ${school.name}）`}
            </summary>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted" data-role="onboarding-school-picked">
                {school === null
                  ? '未选学校：作息可在设置里套用'
                  : `已选：${school.name}`}
              </span>
              <Button
                size="sm"
                variant="secondary"
                aria-label="选择学校"
                onClick={() => setSchoolOpen(true)}
              >
                选择学校
              </Button>
              {school !== null && (
                <Button variant="ghost" size="sm" aria-label="取消选择学校" onClick={() => setSchool(null)}>
                  取消选择
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
            <span className="text-xs font-semibold text-ink">已有数据：直接导入</span>
            <span className="text-xs text-muted">选择备份文件，或直接粘贴 JSON / Base64 文本</span>
            <span className="text-xs text-muted" data-role="onboarding-import-formats">
              支持晓刻导出的 JSON、Base64 文本与整包 zip
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,text/plain,application/zip,.json,.txt,.zip"
              className="hidden"
              aria-label="选择备份文件"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file !== undefined) void pickFile(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" aria-label="选择备份文件" disabled={busy} onClick={() => fileRef.current?.click()}>
                选择备份文件
              </Button>
            </div>
            <textarea
              data-role="onboarding-import-text"
              aria-label="备份文本"
              placeholder="或在此粘贴 JSON / Base64 备份文本"
              className="h-20 w-full rounded-md border border-line bg-surface p-2 text-[11px] text-ink"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                aria-label="从文本导入"
                disabled={busy || importText.trim().length === 0}
                onClick={pickText}
              >
                从文本导入
              </Button>
            </div>
            {pending !== null && (
              <>
                <span className="text-xs text-muted">
                  {summarizeBackup(pending)
                    .map((item) => `${BACKUP_MODULE_LABEL[item.module]} ${item.rows}`)
                    .join('、')}
                </span>
                <span className="text-xs text-danger-strong" data-role="onboarding-overwrite-hint">
                  将覆盖设备上的现有数据，不可撤销
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" aria-label="确认导入" disabled={busy} onClick={() => void applyImport()}>
                    确认导入
                  </Button>
                  <Button variant="ghost" aria-label="取消导入" disabled={busy} onClick={clearPending}>
                    取消
                  </Button>
                </div>
                <span className="text-xs text-muted">
                  导入模块：{pending.modules === undefined ? '全部' : pending.modules.map((item) => BACKUP_MODULE_LABEL[item]).join('、')}
                </span>
              </>
            )}
            {importError !== null && (
              <p className="text-xs text-danger-strong" data-role="onboarding-import-error">
                {importError}
              </p>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
