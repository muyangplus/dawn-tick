import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Pencil, Trash2 } from 'lucide-react';
import {
  deleteCourse,
  listManagedCourses,
  type ManagedCourse,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { CourseForm } from './course-form.tsx';
import { logInfo } from '../log.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function weeksLabel(weeks: readonly number[]): string {
  if (weeks.length === 0) return '未标注周次';
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
  return `${ranges.join(',')}周`;
}

function summarize(course: ManagedCourse): string {
  if (course.schedules.length === 0) return '未排课';
  return course.schedules
    .slice(0, 3)
    .map((schedule) => {
      const periods =
        schedule.periodStart === schedule.periodEnd
          ? `${schedule.periodStart}`
          : `${schedule.periodStart}-${schedule.periodEnd}`;
      const room = schedule.room === null ? '' : ` ${schedule.room}`;
      return `${WEEKDAYS[schedule.dayOfWeek - 1]} ${periods}节${room} ${weeksLabel(schedule.weeks)}`;
    })
    .join(' ｜ ');
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
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setCourses(await listManagedCourses(storage, semesterId));
  }, [storage, semesterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function confirmRemove(): Promise<void> {
    if (removing === null) return;
    setBusy(true);
    try {
      await deleteCourse(storage, removing.id);
      logInfo('course', '删除课程', { id: removing.id, schedules: removing.schedules.length });
      toast.success(`已删除课程「${removing.name}」`);
      setRemoving(null);
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <CollapsibleCard id="courses" title="课程管理" icon={BookOpen} badge={`${courses.length} 门`}>
      {courses.length === 0 ? (
        <span className="text-xs text-muted">当前学期还没有课程，可在导入页添加或导入</span>
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
                  {[course.teacher, course.location].filter((item) => item !== null).join(' · ') || '未填写教师与地点'}
                </span>
                <span className="truncate text-xs text-muted">{summarize(course)}</span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`编辑课程 ${course.name}`}
                disabled={busy}
                onClick={() => setEditing(course)}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`删除课程 ${course.name}`}
                disabled={busy}
                onClick={() => setRemoving(course)}
              >
                <Trash2 className="size-4 text-danger-strong" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CourseForm
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
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
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogContent
          title="删除课程"
          description={
            removing === null
              ? ''
              : `将删除「${removing.name}」及其 ${removing.schedules.length} 条排课与相关提醒，本操作不可撤销`
          }
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollapsibleCard>
  );
}
