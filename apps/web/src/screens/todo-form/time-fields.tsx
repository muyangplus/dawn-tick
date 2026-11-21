import { plusMinutesText } from '@dawn-tick/core';
import { Field, Input } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';
import { ADVANCE_OPTIONS } from '../todo-form-model.ts';
import type { TodoSectionProps } from './section-props.ts';
import { todoFormCopy } from '../../copy/todo-form.ts';

/** 日期、时间（或自定义起止时间）、提前提醒，以及「自定义时间」开关。 */
export function TodoTimeFields({ form, update }: TodoSectionProps) {
  const { kind: current, dueDate, dueTime, advance, customTime, startTime, endTime } = form;
  const isExam = current === 'exam';
  const isLab = current === 'lab';
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Field label={todoFormCopy.dateLabel[current]}>
          <Input
            type="date"
            value={dueDate}
            aria-label={todoFormCopy.dateLabel[current]}
            onChange={(event) => update({ dueDate: event.target.value })}
          />
        </Field>
        {!isLab && !customTime && (
          <Field label={isExam ? todoFormCopy.examTimeLabel : todoFormCopy.timeLabel}>
            <Input
              type="time"
              value={dueTime}
              aria-label={isExam ? todoFormCopy.examTimeLabel : todoFormCopy.timeLabel}
              onChange={(event) => update({ dueTime: event.target.value })}
            />
          </Field>
        )}
        {customTime && (
          <>
            <Field label={todoFormCopy.startTimeLabel}>
              <Input
                type="time"
                value={startTime}
                aria-label={todoFormCopy.startTimeLabel}
                onChange={(event) => {
                  const start = event.target.value;
                  update({ startTime: start, endTime: endTime <= start ? plusMinutesText(start, 90) : endTime });
                }}
              />
            </Field>
            <Field label={todoFormCopy.endTimeLabel}>
              <Input
                type="time"
                value={endTime}
                aria-label={todoFormCopy.endTimeLabel}
                onChange={(event) => update({ endTime: event.target.value })}
              />
            </Field>
          </>
        )}
        <Field label={todoFormCopy.advanceLabel}>
          <Select value={advance} onValueChange={(value) => update({ advance: value })}>
            <SelectTrigger aria-label={isExam ? todoFormCopy.advanceAriaExam : todoFormCopy.advanceAria}>
              {ADVANCE_OPTIONS.find((item) => item.id === advance)?.label ?? todoFormCopy.advance.day}
            </SelectTrigger>
            <SelectContent>
              {ADVANCE_OPTIONS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <SwitchField
        label={todoFormCopy.customTimeLabel}
        description={todoFormCopy.customTimeDescription}
        checked={customTime}
        onCheckedChange={(checked) => update({ customTime: checked })}
        ariaLabel={todoFormCopy.customTimeLabel}
      />
    </>
  );
}
