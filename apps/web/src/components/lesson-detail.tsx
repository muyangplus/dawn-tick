import { MapPin, Trash2, User } from 'lucide-react';
import { deleteCourse, deleteSchedule, type Storage } from '@dawn-tick/core';
import type { CourseDetail, LessonCell } from '../data.ts';
import { Button } from './ui/button.tsx';
import { ReminderForm } from './reminder-form.tsx';
import { toast } from './ui/toaster.tsx';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export interface LessonDetailProps {
  storage: Storage;
  userId: string;
  cell: LessonCell;
  detail: CourseDetail;
  onChanged: () => void;
  onClose: () => void;
}

export function LessonDetail({ storage, userId, cell, detail, onChanged, onClose }: LessonDetailProps) {
  async function removeSchedule(id: string): Promise<void> {
    await deleteSchedule(storage, id);
    toast.success('已删除该排课');
    onChanged();
    onClose();
  }

  async function removeCourse(id: string): Promise<void> {
    await deleteCourse(storage, id);
    toast.success('已删除整门课');
    onChanged();
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
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
            <span>{detail.course.credits} 学分</span>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-2" aria-label="排课时段">
        <span className="text-sm font-medium text-ink">时段</span>
        {detail.schedules.map((row) => (
          <div
            key={row.id}
            className="flex min-h-tap items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
          >
            <div className="flex flex-col">
              <span className="tabular text-xs text-ink">
                {WEEKDAYS[row.day_of_week - 1]} 第 {row.period_start}-{row.period_end} 节
              </span>
              <span className="text-xs text-muted">{row.weeks_raw ?? '未标注周次'}</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="删除该排课"
              onClick={() => void removeSchedule(row.id)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
      </section>

      {detail.course !== undefined && (
        <ReminderForm storage={storage} userId={userId} courseId={detail.course.id} onChanged={onChanged} />
      )}

      {(detail.course?.note ?? '') !== '' && (
        <section className="flex flex-col gap-1" aria-label="备注">
          <span className="text-sm font-medium text-ink">备注</span>
          <p className="whitespace-pre-wrap text-xs text-muted">{detail.course?.note}</p>
        </section>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          onClick={() => void removeCourse(detail.course?.id ?? cell.courseId)}
        >
          <Trash2 className="size-4" aria-hidden />
          删除整门课
        </Button>
      </div>
    </div>
  );
}
