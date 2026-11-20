import { CalendarClock, MapPin, PencilLine, Trash2, User, X } from 'lucide-react';
import { deleteCourse, deleteSchedule, WEEKDAY_LABELS, type Storage } from '@dawn-tick/core';
import type { CourseDetail, LessonCell } from '../data.ts';
import { Button } from './ui/button.tsx';
import { confirmAction } from './ui/confirm-dialog.tsx';
import { COUNT, DELETE } from '../copy/common.ts';
import { formatPeriodRange } from '../lib/format.ts';
import { ReminderForm } from './reminder-form.tsx';
import { toast } from './ui/toaster.tsx';
import { lessonCopy } from '../copy/timetable-lesson.ts';

export interface LessonDetailProps {
  storage: Storage;
  userId: string;
  cell: LessonCell;
  detail: CourseDetail;
  onChanged: () => void;
  onClose: () => void;
  /** 打开课程编辑（课程信息与排课时段都在同一个表单里） */
  onEditCourse?: (courseId: string) => void;
  /** 打开「调课」弹窗（改期／停课／调休／临时加课），目标就是当前这一课次 */
  onAdjust?: (cell: LessonCell) => void;
}

export function LessonDetail({
  storage,
  userId,
  cell,
  detail,
  onChanged,
  onClose,
  onEditCourse,
  onAdjust,
}: LessonDetailProps) {
  async function removeSchedule(id: string, label: string): Promise<void> {
    const ok = await confirmAction({
      title: lessonCopy.deleteScheduleTitle,
      description: DELETE(label),
      confirmLabel: lessonCopy.deleteScheduleConfirm,
    });
    if (!ok) return;
    await deleteSchedule(storage, id);
    toast.success(lessonCopy.scheduleDeleted);
    onChanged();
    onClose();
  }

  async function removeCourse(id: string, name: string): Promise<void> {
    const ok = await confirmAction({
      title: lessonCopy.deleteCourseTitle,
      description: DELETE(name, [
        `${lessonCopy.schedulesPart} ${COUNT('schedule', detail.schedules.length)}`,
        `${lessonCopy.remindersPart} ${COUNT('reminder', detail.reminder === undefined ? 0 : 1)}`,
      ]),
      confirmLabel: lessonCopy.deleteCourseConfirm,
    });
    if (!ok) return;
    await deleteCourse(storage, id);
    toast.success(lessonCopy.courseDeleted(name));
    onChanged();
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-semibold text-ink">{detail.course?.name ?? cell.name}</span>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            {(detail.course?.teacher ?? cell.teacher) !== null && (
              <span className="flex items-center gap-1">
                <User className="size-3" aria-hidden />
                {detail.course?.teacher ?? cell.teacher}
              </span>
            )}
            {(detail.course?.location ?? cell.room) !== null && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" aria-hidden />
                {detail.course?.location ?? cell.room}
              </span>
            )}
            {detail.course?.credits !== null && detail.course?.credits !== undefined && (
              <span>{lessonCopy.credits(detail.course.credits)}</span>
            )}
          </div>
        </div>
        <Button size="icon" variant="ghost" aria-label={lessonCopy.closeAria} onClick={onClose}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <section className="flex flex-col gap-2" aria-label={lessonCopy.schedulesAria}>
        <span className="text-sm font-medium text-ink">{lessonCopy.schedulesTitle}</span>
        {detail.schedules.map((row) => (
          <div
            key={row.id}
            className="flex min-h-tap items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
          >
            <div className="flex flex-col">
              <span className="tabular text-xs text-ink">
                {WEEKDAY_LABELS[row.day_of_week - 1] ?? ''} {formatPeriodRange(row.period_start, row.period_end)}
              </span>
              <span className="text-xs text-muted">{row.weeks_raw ?? lessonCopy.weeksUnmarked}</span>
            </div>
            <div className="flex items-center gap-1">
              {onEditCourse !== undefined && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={lessonCopy.editScheduleAria}
                  onClick={() => {
                    onClose();
                    onEditCourse(detail.course?.id ?? cell.courseId);
                  }}
                >
                  <PencilLine className="size-4" aria-hidden />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={lessonCopy.deleteScheduleAria}
                onClick={() =>
                  void removeSchedule(
                    row.id,
                    `${WEEKDAY_LABELS[row.day_of_week - 1] ?? ''} ${formatPeriodRange(row.period_start, row.period_end)}`,
                  )
                }
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </section>

      {detail.course !== undefined && (
        <ReminderForm storage={storage} userId={userId} courseId={detail.course.id} onChanged={onChanged} />
      )}

      {(detail.course?.note ?? '') !== '' && (
        <section className="flex flex-col gap-1" aria-label={lessonCopy.noteTitle}>
          <span className="text-sm font-medium text-ink">{lessonCopy.noteTitle}</span>
          <p className="whitespace-pre-wrap text-xs text-muted">{detail.course?.note}</p>
        </section>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {onAdjust !== undefined && (
          <Button variant="secondary" aria-label={lessonCopy.adjustButton} onClick={() => onAdjust(cell)}>
            <CalendarClock className="size-4" aria-hidden />
            {lessonCopy.adjustButton}
          </Button>
        )}
        {onEditCourse !== undefined && (
          <Button variant="secondary" onClick={() => onEditCourse(detail.course?.id ?? cell.courseId)}>
            <PencilLine className="size-4" aria-hidden />
            {lessonCopy.editButton}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() =>
            void removeCourse(
              detail.course?.id ?? cell.courseId,
              detail.course?.name ?? cell.name,
            )
          }
        >
          <Trash2 className="size-4" aria-hidden />
          {lessonCopy.deleteCourseButton}
        </Button>
      </div>
    </div>
  );
}
