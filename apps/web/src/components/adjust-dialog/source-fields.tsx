import { WEEKDAY_LABELS } from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import { formatPeriodRange } from '../../lib/format.ts';
import { EmptyState } from '../ui/empty-state.tsx';
import { Field, Input } from '../ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/controls.tsx';
import type { AdjustCourse, AdjustSchedule, AdjustSectionProps } from './section-props.ts';

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
      <Field label="课程">
        <Select value={courseId} onValueChange={(value) => update({ courseId: value })}>
          <SelectTrigger aria-label="课程">{course?.name ?? '选择课程'}</SelectTrigger>
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
        <EmptyState size="sm" tone="muted" title="这门课还没有排课，请在课程管理中添加排课" />
      ) : (
        <Field label="课次">
          <Select value={scheduleId} onValueChange={(value) => update({ scheduleId: value })}>
            <SelectTrigger aria-label="课次">
              {schedule === undefined
                ? '选择课次'
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
        label="原日期"
        hint={mode === 'exam' ? '这一天的这节课会被移除' : '这一天的那节课次被调整'}
      >
        <Input
          type="date"
          value={sourceDate}
          aria-label="原日期"
          onChange={(event) => update({ sourceDate: event.target.value })}
        />
      </Field>
    </div>
  );
}
