import { useEffect, useMemo, useState } from 'react';
import {
  activeSemester,
  listCourses,
  listSchedules,
  listTimeSlots,
  type EventRow,
  type Storage,
} from '@dawn-tick/core';
import { buildIcsExport, type IcsExportInput } from '../../lib/ics-export.ts';
import { useAction } from '../../lib/action.ts';
import { errorMessage } from '../../lib/errors.ts';
import { isCorruptDatabase } from '../../db/health.ts';
import { DATABASE_CORRUPT_MESSAGE } from '../../db/corrupt-guard.ts';
import { Button } from '../../components/ui/button.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { saveText, toastSaved } from './file-export.ts';
import { transferCopy as copy } from '../../copy/backup-transfer.ts';

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
          // 损坏不再展示原始 sqlx 文案：统一换成恢复引导（对话框由守卫弹出）
          setLoadError(isCorruptDatabase(cause) ? DATABASE_CORRUPT_MESSAGE : errorMessage(cause));
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
      scope: 'backup',
      label: copy.icsExporting,
      fail: false,
      task: async () => {
        const saved = await saveText(plan.fileName, plan.text, 'ics', copy.icsFilter, 'text/calendar');
        if (!saved.saved) return;
        toastSaved(copy.icsExported(plan.counts.courses), saved.path);
        onOpenChange(false);
      },
    });
  }

  const empty = plan !== null && plan.counts.lessons === 0 && plan.counts.events === 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.icsTitle}
      description={copy.icsDescription}
      submitLabel={copy.icsSubmit}
      submitting={exportAction.busy}
      submitDisabled={plan === null || empty || loading}
      onSubmit={() => void saveIcs()}
      contentAttrs={{ 'data-role': 'ics-export-dialog' }}
    >
      {loading && <span className="text-sm text-muted">{copy.icsLoading}</span>}
      {!loading && loadError !== null && (
        <span className="text-sm text-danger">{copy.icsLoadFailed(loadError)}</span>
      )}
      {!loading && loadError === null && built.error !== null && (
        <span className="text-sm text-danger">{copy.icsBuildFailed(built.error)}</span>
      )}
      {!loading && loadError === null && built.error === null && source === null && (
        <span className="text-sm text-muted">{copy.icsNoSemester}</span>
      )}
      {plan !== null && source !== null && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink" data-role="ics-semester">
              {copy.icsSemester(source.semester.name)}
            </span>
            <span className="text-xs text-muted" data-role="ics-counts">
              {copy.icsCounts(plan.counts.courses, plan.counts.schedules, plan.counts.lessons)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="size-4"
                checked
                disabled
                aria-label={copy.icsTimetableLabel}
              />
              {copy.icsTimetable}
            </label>
            <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="size-4"
                checked={includeEvents}
                disabled={plan.counts.events === 0}
                aria-label={copy.icsEventsLabel}
                onChange={(event) => setIncludeEvents(event.target.checked)}
              />
              {copy.icsEvents}
              <span className="text-xs text-muted">
                {plan.counts.events === 0 ? copy.icsEventsNone : copy.icsEventsCount(plan.counts.events)}
              </span>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted" data-role="ics-policy">
              {copy.icsPolicy}
            </span>
            {plan.notes.length > 0 && (
              <span className="text-xs text-muted" data-role="ics-notes">
                {copy.icsNotes(plan.notes)}
              </span>
            )}
            {empty && <span className="text-xs text-muted">{copy.icsEmpty}</span>}
          </div>
        </>
      )}
    </FormDialog>
  );
}
