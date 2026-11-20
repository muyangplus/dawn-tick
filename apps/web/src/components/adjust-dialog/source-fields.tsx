import { WEEKDAY_LABELS } from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import { formatPeriodRange } from '../../lib/format.ts';
import { EmptyState } from '../ui/empty-state.tsx';
import { Field, Input } from '../ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/controls.tsx';
import type { AdjustCourse, AdjustSchedule, AdjustSectionProps } from './section-props.ts';
import { adjustCopy } from '../../copy/timetable-adjust.ts';

interface SourceFieldsProps extends AdjustSectionProps {
  data: AppData;
  course: AdjustCourse | undefined;
  schedules: readonly AdjustSchedule[];
  schedule: AdjustSchedule | undefined;
}

/** 改期 / 停课 / 改为考试共用的「哪门课、哪个课次、哪一天」。 */
export function AdjustSourceFields({ form, update, data, course, schedules, schedule }: SourceFieldsProps) {
  const { mode, courseId, scheduleId, sourceDate } = form;
  return (
    <div className="flex flex-col gap-3">
      <Field label={adjustCopy.courseLabel}>
        <Select value={courseId} onValueChange={(value) => update({ courseId: value })}>
          <SelectTrigger aria-label={adjustCopy.courseLabel}>{course?.name ?? adjustCopy.coursePlaceholder}</SelectTrigger>
          <SelectContent>
            {data.courses.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {schedules.length === 0 ? (
        <EmptyState size="sm" tone="muted" title={adjustCopy.noSchedules} />
      ) : (
        <Field label={adjustCopy.scheduleLabel}>
          <Select value={scheduleId} onValueChange={(value) => update({ scheduleId: value })}>
            <SelectTrigger aria-label={adjustCopy.scheduleLabel}>
              {schedule === undefined
                ? adjustCopy.schedulePlaceholder
                : `${WEEKDAY_LABELS[schedule.dayOfWeek - 1] ?? ''} ${formatPeriodRange(
                    schedule.periodStart,
                    schedule.periodEnd,
                  )}`}
            </SelectTrigger>
            <SelectContent>
              {schedules.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {`${WEEKDAY_LABELS[item.dayOfWeek - 1] ?? ''} ${formatPeriodRange(item.periodStart, item.periodEnd)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field
        label={adjustCopy.sourceDateLabel}
        hint={mode === 'exam' ? adjustCopy.sourceDateHintExam : adjustCopy.sourceDateHintMove}
      >
        <Input
          type="date"
          value={sourceDate}
          aria-label={adjustCopy.sourceDateLabel}
          onChange={(event) => update({ sourceDate: event.target.value })}
        />
      </Field>
    </div>
  );
}
