import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { updateSemester, type AppSettings, type SemesterRow, type Storage, type TimeSlotRow } from '@dawn-tick/core';
import { useAction } from '../../lib/action.ts';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { Button } from '../../components/ui/button.tsx';
import { CourseManager } from '../course-manager.tsx';
import { DeleteSemesterDialog, EditSemesterDialog, NewSemesterForm } from './semester-dialogs.tsx';

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
 * 学期设置卡：学期列表（切换 / 编辑 / 删除）、新建学期与课程管理。
 *
 * 表单、编辑与删除确认都拆到 `semester-dialogs.tsx`；卡内只留列表与课程管理，
 * 学期增删改后统一 `onChanged` 让上层重读数据。
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
  const [editing, setEditing] = useState<SemesterRow | null>(null);
  const [removing, setRemoving] = useState<SemesterRow | null>(null);

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
                  onClick={() => setEditing(semester)}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`删除学期 ${semester.name}`}
                  disabled={busy}
                  onClick={() => setRemoving(semester)}
                >
                  <Trash2 className="size-4 text-danger-strong" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <NewSemesterForm storage={storage} userId={userId} settings={settings} onChanged={onChanged} />
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

      {editing !== null && (
        <EditSemesterDialog
          key={editing.id}
          semester={editing}
          storage={storage}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      )}
      {removing !== null && (
        <DeleteSemesterDialog
          key={removing.id}
          semester={removing}
          storage={storage}
          onClose={() => setRemoving(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
