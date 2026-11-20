import { WEEKDAY_LABELS } from '@dawn-tick/core';
import { WeekPicker } from '../../components/week-picker.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { HelpHint } from '../../components/ui/help-hint.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';
import { formatPeriodRange } from '../../lib/format.ts';
import type { TodoSectionProps } from './section-props.ts';
import { todoFormCopy } from '../../copy/todo-form.ts';

interface LabFieldsProps extends TodoSectionProps {
  totalWeeks: number;
  /** 自定义时间按起止时间回填出的节次；算不出时为 null */
  clockPeriods: { periodStart: number; periodEnd: number } | null;
}

/** 实验专属：每周重复（星期 + 周次）与节次。 */
export function TodoLabFields({ form, update, totalWeeks, clockPeriods }: LabFieldsProps) {
  const { labRepeat, labWeekday, labWeeks, labPeriodStart, labPeriodEnd, customTime } = form;
  return (
    <div className="flex flex-col gap-2" data-role="lab-fields">
      <SwitchField
        label={todoFormCopy.repeatLabel}
        description={todoFormCopy.repeatDescription}
        checked={labRepeat}
        onCheckedChange={(checked) => update({ labRepeat: checked })}
        ariaLabel={todoFormCopy.repeatAria}
      />
      {labRepeat && (
        <>
          <Field label={todoFormCopy.weekdayLabel}>
            <Select value={String(labWeekday)} onValueChange={(value) => update({ labWeekday: Number(value) })}>
              <SelectTrigger aria-label={todoFormCopy.weekdayAria}>
                {WEEKDAY_LABELS[labWeekday - 1] ?? WEEKDAY_LABELS[0]}
              </SelectTrigger>
              <SelectContent>
                {WEEKDAY_LABELS.map((label, index) => (
                  <SelectItem key={label} value={String(index + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <WeekPicker
            totalWeeks={totalWeeks}
            value={labWeeks}
            onValueChange={(value) => update({ labWeeks: value })}
            showShortcuts={false}
            dataRole="lab-weeks"
          />
          <span className="flex items-center gap-1 text-xs text-muted">
            {todoFormCopy.repeatNote}
            <HelpHint label={todoFormCopy.repeatLabel}>{todoFormCopy.repeatHelp}</HelpHint>
          </span>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        {!customTime && (
          <>
            <Field label={todoFormCopy.periodStartLabel}>
              <Input
                type="number"
                min={1}
                max={40}
                className="w-24"
                aria-label={todoFormCopy.periodStartAria}
                value={labPeriodStart}
                onChange={(event) => update({ labPeriodStart: event.target.value })}
              />
            </Field>
            <Field label={todoFormCopy.periodEndLabel}>
              <Input
                type="number"
                min={1}
                max={40}
                className="w-24"
                aria-label={todoFormCopy.periodEndAria}
                value={labPeriodEnd}
                onChange={(event) => update({ labPeriodEnd: event.target.value })}
              />
            </Field>
          </>
        )}
        {customTime && (
          <span className="self-center text-xs text-muted">
            {todoFormCopy.clockPeriods(
              clockPeriods === null ? null : formatPeriodRange(clockPeriods.periodStart, clockPeriods.periodEnd),
            )}
          </span>
        )}
      </div>
    </div>
  );
}
