import type { AppData } from '../../data.ts';
import { Field, Input } from '../ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/controls.tsx';
import type { AdjustSectionProps } from './section-props.ts';
import { adjustCopy } from '../../copy/timetable-adjust.ts';

/** 改为考试：考试日期、节次与备注；日期与节次复用改期的字段。 */
export function AdjustExamFields({ form, update }: AdjustSectionProps) {
  const { newDate, newStart, newEnd, examNote } = form;
  return (
    <div className="flex flex-col gap-3">
      <Field label={adjustCopy.examDateLabel} hint={adjustCopy.examDateHint}>
        <Input
          type="date"
          value={newDate}
          aria-label={adjustCopy.examDateLabel}
          onChange={(event) => update({ newDate: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={adjustCopy.periodStartLabel}>
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label={adjustCopy.examStartAria}
            value={newStart}
            onChange={(event) => update({ newStart: event.target.value })}
          />
        </Field>
        <Field label={adjustCopy.periodEndLabel}>
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label={adjustCopy.examEndAria}
            value={newEnd}
            onChange={(event) => update({ newEnd: event.target.value })}
          />
        </Field>
      </div>
      <Field label={adjustCopy.examNoteLabel}>
        <Input
          value={examNote}
          aria-label={adjustCopy.examNoteAria}
          placeholder={adjustCopy.examNotePlaceholder}
          onChange={(event) => update({ examNote: event.target.value })}
        />
      </Field>
      <span className="text-xs text-muted">{adjustCopy.examFootnote}</span>
    </div>
  );
}

/** 调休：原日期课表整体搬到目标上课日。 */
export function AdjustSwapFields({ form, update }: AdjustSectionProps) {
  const { restFrom, restTo } = form;
  return (
    <div className="flex flex-col gap-3">
      <Field label={adjustCopy.swapFromLabel}>
        <Input
          type="date"
          value={restFrom}
          aria-label={adjustCopy.swapFromLabel}
          onChange={(event) => update({ restFrom: event.target.value })}
        />
      </Field>
      <Field label={adjustCopy.swapToLabel} help={adjustCopy.swapToHelp}>
        <Input
          type="date"
          value={restTo}
          aria-label={adjustCopy.swapToLabel}
          onChange={(event) => update({ restTo: event.target.value })}
        />
      </Field>
    </div>
  );
}

/** 临时加课：选已有课程或填新课程名，再定日期与节次。 */
export function AdjustExtraFields({ form, update, data }: AdjustSectionProps & { data: AppData }) {
  const { extraCourse, extraName, extraDate, extraStart, extraEnd } = form;
  return (
    <div className="flex flex-col gap-3">
      <Field label={adjustCopy.extraCourseLabel}>
        <Select value={extraCourse} onValueChange={(value) => update({ extraCourse: value })}>
          <SelectTrigger aria-label={adjustCopy.extraCourseLabel}>
            {data.courses.find((item) => item.id === extraCourse)?.name ?? adjustCopy.coursePlaceholder}
          </SelectTrigger>
          <SelectContent>
            {data.courses.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={adjustCopy.extraNameLabel} hint={adjustCopy.extraNameHint}>
        <Input
          value={extraName}
          aria-label={adjustCopy.extraNameLabel}
          placeholder={adjustCopy.extraNamePlaceholder}
          onChange={(event) => update({ extraName: event.target.value })}
        />
      </Field>
      <Field label={adjustCopy.extraDateLabel}>
        <Input
          type="date"
          value={extraDate}
          aria-label={adjustCopy.extraDateLabel}
          onChange={(event) => update({ extraDate: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={adjustCopy.periodStartLabel}>
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label={adjustCopy.periodStartLabel}
            value={extraStart}
            onChange={(event) => update({ extraStart: event.target.value })}
          />
        </Field>
        <Field label={adjustCopy.periodEndLabel}>
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label={adjustCopy.periodEndLabel}
            value={extraEnd}
            onChange={(event) => update({ extraEnd: event.target.value })}
          />
        </Field>
      </div>
      <span className="text-xs text-muted">{adjustCopy.extraFootnote}</span>
    </div>
  );
}
