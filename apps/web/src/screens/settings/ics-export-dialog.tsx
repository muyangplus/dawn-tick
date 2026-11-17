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
