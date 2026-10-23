import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  createSemester,
  deleteSemesterDeep,
  isValidTimeZone,
  updateSemester,
  type AppSettings,
  type SemesterRow,
  type Storage,
} from '@dawn-tick/core';
import { logInfo } from '../../log.ts';
import { useAction } from '../../lib/action.ts';
import { Button } from '../../components/ui/button.tsx';
import { DangerDialog, FormDialog } from '../../components/ui/dialog.tsx';
import { COUNT, DELETE } from '../../copy/zh.ts';
import { countForSemester, type SemesterCounts } from '../../delete-counts.ts';
import { Field, Input } from '../../components/ui/input.tsx';
import { toast } from '../../components/ui/toaster.tsx';

export interface NewSemesterFormProps {
  storage: Storage;
  userId: string;
  settings: AppSettings;
  onChanged: () => void;
}

/** 新建学期：沿用原来「学期设置」卡里的折叠表单，成功后清空名称等待下一次新建。 */
export function NewSemesterForm({ storage, userId, settings, onChanged }: NewSemesterFormProps) {
  const [semesterName, setSemesterName] = useState('');
  const [semesterStart, setSemesterStart] = useState('');
  const [semesterWeeks, setSemesterWeeks] = useState(20);
  const { busy, run } = useAction();

  async function addSemester(): Promise<void> {
    if (semesterName.trim().length === 0 || semesterStart.length === 0) return;
    await run({
      scope: 'semester',
      label: '正在新建学期…',
      ok: '已新建学期并设为当前学期',
      fail: { what: '新建学期失败', next: '请重试；仍失败请重开应用后再试。' },
      task: async () => {
        await createSemester(storage, {
          userId,
          name: semesterName.trim(),
          startDate: semesterStart,
          totalWeeks: semesterWeeks,
          timeZone: settings.timeZone,
        });
        logInfo('semester', '新建学期', {
          name: semesterName.trim(),
          startDate: semesterStart,
          totalWeeks: semesterWeeks,
        });
        setSemesterName('');
        onChanged();
      },
    });
  }

  return (
    <details className="flex flex-col gap-2">
      <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm text-ink">
        <Plus className="size-4" aria-hidden />
        新建学期
      </summary>
      <div className="flex flex-col gap-2 pt-2">
        <Field label="学期名称">
          <Input value={semesterName} onChange={(event) => setSemesterName(event.target.value)} />
        </Field>
        <Field label="开学日期">
          <Input type="date" value={semesterStart} onChange={(event) => setSemesterStart(event.target.value)} />
        </Field>
        <Field label="总周数">
          <Input
            type="number"
            min={1}
            max={30}
            value={semesterWeeks}
            onChange={(event) => setSemesterWeeks(Number(event.target.value))}
          />
        </Field>
        <Button variant="primary" size="sm" loading={busy} onClick={() => void addSemester()}>
          创建并切换
        </Button>
      </div>
    </details>
  );
}

export interface EditSemesterDialogProps {
  semester: SemesterRow;
  storage: Storage;
  onClose: () => void;
  onChanged: () => void;
}

/** 编辑学期：表单状态随对话框走，保存后关闭并让上层重读数据。 */
export function EditSemesterDialog({ semester, storage, onClose, onChanged }: EditSemesterDialogProps) {
  const [editName, setEditName] = useState(semester.name);
  const [editStart, setEditStart] = useState(semester.start_date);
  const [editWeeks, setEditWeeks] = useState(semester.total_weeks);
  const [editZone, setEditZone] = useState(semester.time_zone);
  const { busy, run } = useAction();

  async function saveEdit(): Promise<void> {
    if (editName.trim().length === 0 || editStart.length === 0 || !isValidTimeZone(editZone)) {
      toast.error('请检查学期名称、开学日期与时区');
      return;
    }
    await run({
      scope: 'semester',
      label: '正在保存学期设置…',
      ok: '已保存学期设置',
      fail: { what: '保存学期设置失败', next: '请重试；仍失败请重开应用后再改。' },
      task: async () => {
        await updateSemester(storage, semester.id, {
          name: editName.trim(),
          start_date: editStart,
          total_weeks: Math.min(30, Math.max(1, editWeeks)),
          time_zone: editZone,
        });
        logInfo('semester', '修改学期', {
          id: semester.id,
          startDate: editStart,
          totalWeeks: editWeeks,
          timeZone: editZone,
        });
        onClose();
        onChanged();
      },
    });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="编辑学期"
      description="修改会立即影响周次与课表计算"
      submitLabel="保存"
      submitting={busy}
      onSubmit={() => void saveEdit()}
    >
      <Field label="学期名称">
        <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
      </Field>
      <Field label="开学日期" hint="该周记为第 1 周">
        <Input type="date" value={editStart} onChange={(event) => setEditStart(event.target.value)} />
      </Field>
      <Field label="总周数">
        <Input
          type="number"
          min={1}
          max={30}
          value={editWeeks}
          onChange={(event) => setEditWeeks(Number(event.target.value))}
        />
      </Field>
      <Field label="时区" error={!isValidTimeZone(editZone) ? '时区名无效' : undefined}>
        <Input value={editZone} onChange={(event) => setEditZone(event.target.value)} />
      </Field>
    </FormDialog>
  );
}

export interface DeleteSemesterDialogProps {
  semester: SemesterRow;
  storage: Storage;
  onClose: () => void;
  onChanged: () => void;
}

/** 删除学期：确认句里的逐类行数由对话框自己数，删除成功后关闭并让上层重读数据。 */
export function DeleteSemesterDialog({ semester, storage, onClose, onChanged }: DeleteSemesterDialogProps) {
  /** 删除学期确认句里的逐类行数 */
  const [removeCounts, setRemoveCounts] = useState<SemesterCounts | null>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const counts = await countForSemester(storage, semester.id);
      if (!cancelled) setRemoveCounts(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage, semester.id]);

  async function confirmRemove(): Promise<void> {
    await run({
      scope: 'semester',
      label: '正在删除学期…',
      fail: { what: '删除学期失败', next: '请重试；仍失败请重开应用后再删。' },
      task: async () => {
        const report = await deleteSemesterDeep(storage, semester.id);
        logInfo('semester', '删除学期', { id: semester.id, ...report });
        toast.success(
          `已删除「${semester.name}」：课程 ${COUNT('course', report.courses)}、排课 ${COUNT('schedule', report.schedules)}、节次 ${COUNT('period', report.slots)}、日程 ${COUNT('event', report.events)}、提醒 ${COUNT('reminder', report.reminders)}`,
        );
        onClose();
        onChanged();
      },
    });
  }

  return (
    <DangerDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="删除学期"
      description={DELETE(semester.name, [
        `课程 ${COUNT('course', removeCounts?.courses ?? 0)}`,
        `排课 ${COUNT('schedule', removeCounts?.schedules ?? 0)}`,
        `节次 ${COUNT('period', removeCounts?.slots ?? 0)}`,
        `日程 ${COUNT('event', removeCounts?.events ?? 0)}`,
        `提醒 ${COUNT('reminder', removeCounts?.reminders ?? 0)}`,
      ])}
      submitting={busy}
      onConfirm={() => void confirmRemove()}
    />
  );
}
