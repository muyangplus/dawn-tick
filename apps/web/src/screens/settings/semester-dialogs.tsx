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
import { semestersCopy } from '../../copy/settings-semesters.ts';
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
      scope: 'timetable',
      label: semestersCopy.creatingLabel,
      ok: semestersCopy.createdToast,
      fail: semestersCopy.createFailed,
      task: async () => {
        await createSemester(storage, {
          userId,
          name: semesterName.trim(),
          startDate: semesterStart,
          totalWeeks: semesterWeeks,
          timeZone: settings.timeZone,
        });
        logInfo('timetable', '学期已新建', {
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
        {semestersCopy.newSummary}
      </summary>
      <div className="flex flex-col gap-2 pt-2">
        <Field label={semestersCopy.nameLabel}>
          <Input value={semesterName} onChange={(event) => setSemesterName(event.target.value)} />
        </Field>
        <Field label={semestersCopy.startLabel}>
          <Input type="date" value={semesterStart} onChange={(event) => setSemesterStart(event.target.value)} />
        </Field>
        <Field label={semestersCopy.weeksLabel}>
          <Input
            type="number"
            min={1}
            max={30}
            value={semesterWeeks}
            onChange={(event) => setSemesterWeeks(Number(event.target.value))}
          />
        </Field>
        <Button variant="primary" size="sm" loading={busy} onClick={() => void addSemester()}>
          {semestersCopy.createButton}
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
      toast.error(semestersCopy.editInvalid);
      return;
    }
    await run({
      scope: 'timetable',
      label: semestersCopy.savingLabel,
      ok: semestersCopy.savedToast,
      fail: semestersCopy.saveFailed,
      task: async () => {
        await updateSemester(storage, semester.id, {
          name: editName.trim(),
          start_date: editStart,
          total_weeks: Math.min(30, Math.max(1, editWeeks)),
          time_zone: editZone,
        });
        logInfo('timetable', '学期已修改', {
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
      title={semestersCopy.editTitle}
      description={semestersCopy.editDescription}
      submitLabel={semestersCopy.saveButton}
      submitting={busy}
      onSubmit={() => void saveEdit()}
    >
      <Field label={semestersCopy.nameLabel}>
        <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
      </Field>
      <Field label={semestersCopy.startLabel} hint={semestersCopy.startHint}>
        <Input type="date" value={editStart} onChange={(event) => setEditStart(event.target.value)} />
      </Field>
      <Field label={semestersCopy.weeksLabel}>
        <Input
          type="number"
          min={1}
          max={30}
          value={editWeeks}
          onChange={(event) => setEditWeeks(Number(event.target.value))}
        />
      </Field>
      <Field label={semestersCopy.timeZoneLabel} error={!isValidTimeZone(editZone) ? semestersCopy.timeZoneInvalid : undefined}>
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
      scope: 'timetable',
      label: semestersCopy.deletingLabel,
      fail: semestersCopy.deleteFailed,
      task: async () => {
        const report = await deleteSemesterDeep(storage, semester.id);
        logInfo('timetable', '学期已删除', { id: semester.id, ...report });
        toast.success(semestersCopy.deletedToast(semester.name, report));
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
      title={semestersCopy.deleteTitle}
      confirmLabel={semestersCopy.deleteConfirm}
      description={semestersCopy.deleteDescription(semester.name, {
        courses: removeCounts?.courses ?? 0,
        schedules: removeCounts?.schedules ?? 0,
        slots: removeCounts?.slots ?? 0,
        events: removeCounts?.events ?? 0,
        reminders: removeCounts?.reminders ?? 0,
      })}
      submitting={busy}
      onConfirm={() => void confirmRemove()}
    />
  );
}
