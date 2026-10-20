import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createSemester,
  deleteSemesterDeep,
  isValidTimeZone,
  updateSemester,
  type AppSettings,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { logInfo } from '../../log.ts';
import { useAction } from '../../lib/action.ts';
import { PeriodSettings } from '../../components/period-settings.tsx';
import { Button } from '../../components/ui/button.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { DangerDialog, FormDialog } from '../../components/ui/dialog.tsx';
import { COUNT, DELETE } from '../../copy/zh.ts';
import { countForSemester, type SemesterCounts } from '../../delete-counts.ts';
import { Field, Input } from '../../components/ui/input.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { CourseManager } from '../course-manager.tsx';
import { SchoolTimetableCard } from '../school-timetable-card.tsx';

export interface SemestersCardProps {
  storage: Storage;
  userId: string;
  settings: AppSettings;
  semesters: readonly SemesterRow[];
  activeSemesterId: string | null;
  activeStartDate: string;
  totalWeeks: number;
  slots: readonly TimeSlotRow[];
  onChanged: () => void;
}

/**
 * 学期卡：学期列表（切换 / 编辑 / 删除）、新建学期、作息设置、选校作息与课程管理。
 *
 * 表单与两个确认对话框都随卡走；学期增删改后统一 `onChanged` 让上层重读数据。
 */
export function SemestersCard({
  storage,
  userId,
  settings,
  semesters,
  activeSemesterId,
  activeStartDate,
  totalWeeks,
  slots,
  onChanged,
}: SemestersCardProps) {
  const { busy, run } = useAction();
  const [semesterName, setSemesterName] = useState('');
  const [semesterStart, setSemesterStart] = useState('');
  const [semesterWeeks, setSemesterWeeks] = useState(20);
  const [editing, setEditing] = useState<SemesterRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editWeeks, setEditWeeks] = useState(20);
  const [editZone, setEditZone] = useState('');
  const [removing, setRemoving] = useState<SemesterRow | null>(null);
  /** 删除学期确认句里的逐类行数 */
  const [removeCounts, setRemoveCounts] = useState<SemesterCounts | null>(null);

  async function requestRemoveSemester(semester: SemesterRow): Promise<void> {
    setRemoveCounts(await countForSemester(storage, semester.id));
    setRemoving(semester);
  }

  function startEdit(semester: SemesterRow): void {
    setEditing(semester);
    setEditName(semester.name);
    setEditStart(semester.start_date);
    setEditWeeks(semester.total_weeks);
    setEditZone(semester.time_zone);
  }

  async function saveEdit(): Promise<void> {
    if (editing === null) return;
    if (editName.trim().length === 0 || editStart.length === 0 || !isValidTimeZone(editZone)) {
      toast.error('请检查学期名称、开学日期与时区');
      return;
    }
    const target = editing;
    await run({
      scope: 'semester',
      label: '正在保存学期设置…',
      ok: '已保存学期设置',
      fail: { what: '保存学期设置失败', next: '请重试；仍失败请重开应用后再改。' },
      task: async () => {
        await updateSemester(storage, target.id, {
          name: editName.trim(),
          start_date: editStart,
          total_weeks: Math.min(30, Math.max(1, editWeeks)),
          time_zone: editZone,
        });
        logInfo('semester', '修改学期', {
          id: target.id,
          startDate: editStart,
          totalWeeks: editWeeks,
          timeZone: editZone,
        });
        setEditing(null);
        onChanged();
      },
    });
  }

  async function confirmRemove(): Promise<void> {
    if (removing === null) return;
    const target = removing;
    await run({
      scope: 'semester',
      label: '正在删除学期…',
      fail: { what: '删除学期失败', next: '请重试；仍失败请重开应用后再删。' },
      task: async () => {
        const report = await deleteSemesterDeep(storage, target.id);
        logInfo('semester', '删除学期', { id: target.id, ...report });
        toast.success(
          `已删除「${target.name}」：课程 ${COUNT('course', report.courses)}、排课 ${COUNT('schedule', report.schedules)}、节次 ${COUNT('period', report.slots)}、日程 ${COUNT('event', report.events)}、提醒 ${COUNT('reminder', report.reminders)}`,
        );
        setRemoving(null);
        onChanged();
      },
    });
  }

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

  async function activate(id: string): Promise<void> {
    await run({
      scope: 'semester',
      label: '正在切换当前学期…',
      ok: '已切换当前学期',
      fail: { what: '切换学期失败', next: '请重试；仍失败请重开应用后再试。' },
      task: async () => {
        for (const semester of semesters) {
          if (semester.is_active === 1 && semester.id !== id) {
            await updateSemester(storage, semester.id, { is_active: 0 });
          }
        }
        await updateSemester(storage, id, { is_active: 1 });
        onChanged();
      },
    });
  }

  return (
    <>
      {semesters.length === 0 ? (
        <EmptyState size="sm" tone="muted" title="还没有学期，先在上面新建一个" />
      ) : (
        <ul className="flex flex-col gap-1">
          {semesters.map((semester) => (
            <li key={semester.id} className="flex min-h-tap items-center justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-ink">{semester.name}</span>
                <span className="tabular truncate text-xs text-muted">
                  {semester.start_date} 起 · {semester.total_weeks} 周 · {semester.time_zone}
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {semester.id === activeSemesterId ? (
                  <span className="text-xs text-primary-strong">当前</span>
                ) : (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void activate(semester.id)}>
                    切换
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`编辑学期 ${semester.name}`}
                  disabled={busy}
                  onClick={() => startEdit(semester)}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`删除学期 ${semester.name}`}
                  disabled={busy}
                  onClick={() => void requestRemoveSemester(semester)}
                >
                  <Trash2 className="size-4 text-danger-strong" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
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
      <PeriodSettings storage={storage} semesterId={activeSemesterId ?? ''} onChanged={onChanged} />
      {/* 选校体验与导入流程统一：同一个 SchoolPicker，选中后套用该校作息或通用作息 */}
      <SchoolTimetableCard storage={storage} semesterId={activeSemesterId ?? ''} onChanged={onChanged} />
      {activeSemesterId !== null && (
        <CourseManager
          storage={storage}
          semesterId={activeSemesterId}
          preset={settings.themePreset}
          slots={slots}
          semesterStart={activeStartDate}
          totalWeeks={totalWeeks}
          onChanged={onChanged}
        />
      )}

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
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

      <DangerDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="删除学期"
        description={
          removing === null
            ? ''
            : DELETE(removing.name, [
                `课程 ${COUNT('course', removeCounts?.courses ?? 0)}`,
                `排课 ${COUNT('schedule', removeCounts?.schedules ?? 0)}`,
                `节次 ${COUNT('period', removeCounts?.slots ?? 0)}`,
                `日程 ${COUNT('event', removeCounts?.events ?? 0)}`,
                `提醒 ${COUNT('reminder', removeCounts?.reminders ?? 0)}`,
              ])
        }
        submitting={busy}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
