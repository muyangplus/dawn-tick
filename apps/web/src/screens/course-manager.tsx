import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Copy, Pencil, Trash2 } from 'lucide-react';
import {
  createCourse,
  createSchedule,
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
import { DELETE } from '../copy/zh.ts';
import { countForCourse, type CourseCounts } from '../delete-counts.ts';
import { CourseForm } from './course-form.tsx';
import { ImportFlow } from './import-flow.tsx';
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
  /** 删除课程确认句里的排课与提醒条数 */
  const [removeCounts, setRemoveCounts] = useState<CourseCounts | null>(null);
  /** 复制课程：先选只复制课程信息，还是连排课一起复制 */
  const [copying, setCopying] = useState<ManagedCourse | null>(null);
  const [busy, setBusy] = useState(false);
  /** 新建课程：导入子项里的「手动添加」也会用它打开表单 */
  const [creating, setCreating] = useState(false);
  /** 导入课表折叠区：「完成」要把它收起 */
  const importRef = useRef<HTMLDetailsElement>(null);

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
    setBusy(true);
    try {
      const source = copying;
      const created = await createCourse(storage, {
        semesterId,
        name: `${source.name} 副本`,
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
      logInfo('course', '复制课程', { id: source.id, schedules: withSchedules ? source.schedules.length : 0 });
      toast.success(
        withSchedules ? `已复制「${source.name}」及 ${source.schedules.length} 段排课` : `已复制「${source.name}」`,
      );
      setCopying(null);
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

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
        <span className="text-xs text-muted">当前学期没有课程，可在导入页添加或导入</span>
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
                aria-label={`复制课程 ${course.name}`}
                disabled={busy}
                onClick={() => setCopying(course)}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
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
                onClick={() => void requestRemove(course)}
              >
                <Trash2 className="size-4 text-danger-strong" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 导入课表是课程管理的子项：展开后走同一套导入流程 */}
      <details ref={importRef} className="rounded-md border border-line bg-surface p-2" data-role="course-import">
        <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm font-medium text-ink" aria-label="导入课表">
          导入课表
          <span className="text-xs text-muted">网页课表 / 教务窗口 / ICS / CSV / Excel</span>
        </summary>
        <div className="pt-3">
          <ImportFlow
            storage={storage}
            semesterId={semesterId}
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
          title="复制课程"
          description={
            copying === null
              ? ''
              : `「${copying.name}」有 ${copying.schedules.length} 段排课，选择复制范围`
          }
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void confirmCopy(false)}>
              只复制课程信息
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void confirmCopy(true)}>
              连排课一起复制
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCopying(null)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              : DELETE(removing.name, [
                  `${removeCounts?.schedules ?? removing.schedules.length} 条排课`,
                  `${removeCounts?.reminders ?? 0} 条提醒`,
                ])
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
