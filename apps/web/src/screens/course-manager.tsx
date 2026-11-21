import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { GroupVisibleContext } from '../components/grouped-settings.tsx';
import { BookOpen, Copy, Pencil, Trash2 } from 'lucide-react';
import {
  createCourse,
  createSchedule,
  deleteCourse,
  listManagedCourses,
  WEEKDAY_LABELS,
  type ManagedCourse,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { SectionCard } from '../components/ui/collapsible-card.tsx';
import { DangerDialog, Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { COUNT, DELETE } from '../copy/common.ts';
import { countForCourse, type CourseCounts } from '../delete-counts.ts';
import { useAction } from '../lib/action.ts';
import { CourseForm } from './course-form.tsx';
import { ImportFlow } from './import-flow.tsx';
import { logInfo } from '../log.ts';
import { courseManagerCopy } from '../copy/timetable-course-manager.ts';

export function weeksLabel(weeks: readonly number[]): string {
  if (weeks.length === 0) return courseManagerCopy.weeksUnmarked;
  const sorted = [...weeks].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sorted[0] ?? 1;
  let previous = start;
  for (const week of sorted.slice(1)) {
    if (week === previous + 1) {
      previous = week;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = week;
    previous = week;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return courseManagerCopy.weeks(ranges.join(','));
}

function summarize(course: ManagedCourse): string {
  if (course.schedules.length === 0) return courseManagerCopy.unscheduled;
  return course.schedules
    .slice(0, 3)
    .map((schedule) => {
      const periods =
        schedule.periodStart === schedule.periodEnd
          ? `${schedule.periodStart}`
          : `${schedule.periodStart}-${schedule.periodEnd}`;
      const room = schedule.room === null ? '' : ` ${schedule.room}`;
      return courseManagerCopy.scheduleSummary(WEEKDAY_LABELS[schedule.dayOfWeek - 1] ?? '', periods, room, weeksLabel(schedule.weeks));
    })
    .join(courseManagerCopy.summarySeparator);
}

export interface CourseManagerProps {
  storage: Storage;
  semesterId: string;
  preset: ThemePreset;
  slots: readonly TimeSlotRow[];
  semesterStart: string;
  totalWeeks: number;
  onChanged: () => void;
}

export function CourseManager({
  storage,
  semesterId,
  preset,
  slots,
  semesterStart,
  totalWeeks,
  onChanged,
}: CourseManagerProps) {
  const [courses, setCourses] = useState<ManagedCourse[]>([]);
  const [editing, setEditing] = useState<ManagedCourse | null>(null);
  const [removing, setRemoving] = useState<ManagedCourse | null>(null);
  /** 删除课程确认句里的排课与提醒条数 */
  const [removeCounts, setRemoveCounts] = useState<CourseCounts | null>(null);
  /** 复制课程：先选只复制课程信息，还是连排课一起复制 */
  const [copying, setCopying] = useState<ManagedCourse | null>(null);
  const { busy, run } = useAction();
  /** 新建课程：导入子项里的「手动添加」也会用它打开表单 */
  const [creating, setCreating] = useState(false);
  /** 导入课表折叠区：「完成」要把它收起 */
  const importRef = useRef<HTMLDetailsElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const groupVisible = useContext(GroupVisibleContext);

  const reload = useCallback(async () => {
    setCourses(await listManagedCourses(storage, semesterId));
  }, [storage, semesterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 删除前先数一遍排课与提醒，确认句里给数量 */
  async function requestRemove(course: ManagedCourse): Promise<void> {
    setRemoveCounts(await countForCourse(storage, course.id));
    setRemoving(course);
  }

  /** 复制课程：可选只复制课程信息，或连同全部排课一起复制。 */
  async function confirmCopy(withSchedules: boolean): Promise<void> {
    if (copying === null) return;
    const source = copying;
    await run({
      scope: 'timetable',
      label: courseManagerCopy.copying,
      ok: withSchedules
        ? courseManagerCopy.copiedWithSchedules(source.name, source.schedules.length)
        : courseManagerCopy.copied(source.name),
      fail: courseManagerCopy.copyFail,
      task: async () => {
        const created = await createCourse(storage, {
          semesterId,
          name: courseManagerCopy.copyName(source.name),
          shortName: source.shortName,
          teacher: source.teacher,
          location: source.location,
          color: source.color,
          note: source.note,
        });
        const id = String(created['id']);
        if (withSchedules) {
          for (const schedule of source.schedules) {
            await createSchedule(storage, {
              courseId: id,
              dayOfWeek: schedule.dayOfWeek,
              periodStart: schedule.periodStart,
              periodEnd: schedule.periodEnd,
              weeks: schedule.weeks,
              room: schedule.room,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
            });
          }
        }
        logInfo('timetable', '课程已复制', { id: source.id, schedules: withSchedules ? source.schedules.length : 0 });
        setCopying(null);
        await reload();
        onChanged();
      },
    });
  }

  async function confirmRemove(): Promise<void> {
    if (removing === null) return;
    const target = removing;
    await run({
      scope: 'timetable',
      label: courseManagerCopy.removing,
      ok: courseManagerCopy.removed(target.name),
      fail: courseManagerCopy.removeFail,
      task: async () => {
        await deleteCourse(storage, target.id);
        logInfo('timetable', '课程已删除', { id: target.id, schedules: target.schedules.length });
        setRemoving(null);
        await reload();
        onChanged();
      },
    });
  }

  return (
    <SectionCard title={courseManagerCopy.title} icon={BookOpen} badge={courseManagerCopy.badge(courses.length)}>
      {courses.length === 0 ? (
        <EmptyState size="sm" tone="muted" title={courseManagerCopy.empty} />
      ) : (
        <ul className="flex flex-col gap-2">
          {courses.map((course) => (
            <li key={course.id} className="flex items-center gap-3 rounded-md border border-line bg-surface p-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: course.color }}
                aria-hidden
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-ink">
                  {course.name}
                  {course.shortName !== null && <span className="ml-1 text-xs text-muted">{course.shortName}</span>}
                </span>
                <span className="truncate text-xs text-muted">
                  {[course.teacher, course.location].filter((item) => item !== null).join(' · ') || courseManagerCopy.noTeacherOrLocation}
                </span>
                <span className="truncate text-xs text-muted">{summarize(course)}</span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={courseManagerCopy.copyAria(course.name)}
                disabled={busy}
                onClick={() => setCopying(course)}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={courseManagerCopy.editAria(course.name)}
                disabled={busy}
                onClick={() => setEditing(course)}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={courseManagerCopy.removeAria(course.name)}
                disabled={busy}
                onClick={() => void requestRemove(course)}
              >
                <Trash2 className="size-4 text-danger-strong" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 导入课表是课程管理的子项：展开后走同一套导入流程 */}
      <details
        ref={importRef}
        className="rounded-md border border-line bg-surface p-2"
        data-role="course-import"
        onToggle={(event) => setImportOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm font-medium text-ink" aria-label={courseManagerCopy.importTitle}>
          {courseManagerCopy.importTitle}
          <span className="text-xs text-muted">{courseManagerCopy.importFormats}</span>
        </summary>
        <div className="pt-3">
          <ImportFlow
            storage={storage}
            semesterId={semesterId}
            visible={importOpen && groupVisible}
            onManual={() => setCreating(true)}
            onDone={() => {
              void (async () => {
                await reload();
                onChanged();
              })();
            }}
            onClose={() => {
              // 「完成」= 收起导入区并刷新列表，用户不必再手动收起
              if (importRef.current !== null) importRef.current.open = false;
              void (async () => {
                await reload();
                onChanged();
              })();
            }}
          />
        </div>
      </details>

      <CourseForm
        open={editing !== null || creating}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setCreating(false);
          }
        }}
        storage={storage}
        semesterId={semesterId}
        semesterStart={semesterStart}
        totalWeeks={totalWeeks}
        preset={preset}
        slots={slots}
        course={editing}
        onCreated={() => {
          void (async () => {
            await reload();
            onChanged();
          })();
        }}
      />

      <Dialog
        open={copying !== null}
        onOpenChange={(open) => {
          if (!open) setCopying(null);
        }}
      >
        <DialogContent
          title={courseManagerCopy.copyTitle}
          description={
            copying === null
              ? ''
              : courseManagerCopy.copyDescription(copying.name, copying.schedules.length)
          }
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} onClick={() => void confirmCopy(false)}>
              {courseManagerCopy.copyInfoOnly}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void confirmCopy(true)}>
              {courseManagerCopy.copyWithSchedules}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCopying(null)}>
              {courseManagerCopy.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DangerDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={courseManagerCopy.removeTitle}
        description={
          removing === null
            ? ''
            : DELETE(removing.name, [
                `${courseManagerCopy.schedulesPart} ${COUNT('schedule', removeCounts?.schedules ?? removing.schedules.length)}`,
                `${courseManagerCopy.remindersPart} ${COUNT('reminder', removeCounts?.reminders ?? 0)}`,
              ])
        }
        submitting={busy}
        onConfirm={() => void confirmRemove()}
      />
    </SectionCard>
  );
}
