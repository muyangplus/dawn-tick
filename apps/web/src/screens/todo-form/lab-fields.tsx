import { WEEKDAY_LABELS } from '@dawn-tick/core';
import { WeekPicker } from '../../components/week-picker.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { HelpHint } from '../../components/ui/help-hint.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';
import { formatPeriodRange } from '../../lib/format.ts';
import type { TodoSectionProps } from './section-props.ts';

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
        label="每周重复"
        description="关闭时只在这一天"
        checked={labRepeat}
        onCheckedChange={(checked) => update({ labRepeat: checked })}
        ariaLabel="实验每周重复"
      />
      {labRepeat && (
        <>
          <Field label="星期">
            <Select value={String(labWeekday)} onValueChange={(value) => update({ labWeekday: Number(value) })}>
              <SelectTrigger aria-label="实验星期">
                {WEEKDAY_LABELS[labWeekday - 1] ?? '周一'}
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
            每周重复按上面的「星期」
            <HelpHint label="每周重复">起始日期只决定首次上课日，之后按「星期」与所选周次重复</HelpHint>
          </span>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        {!customTime && (
          <>
            <Field label="起始节">
              <Input
                type="number"
                min={1}
                max={40}
                className="w-24"
                aria-label="实验起始节"
                value={labPeriodStart}
                onChange={(event) => update({ labPeriodStart: event.target.value })}
              />
            </Field>
            <Field label="结束节">
              <Input
                type="number"
                min={1}
                max={40}
                className="w-24"
                aria-label="实验结束节"
                value={labPeriodEnd}
                onChange={(event) => update({ labPeriodEnd: event.target.value })}
              />
            </Field>
          </>
        )}
        {customTime && (
          <span className="self-center text-xs text-muted">
            已按起止时间回填节次{clockPeriods === null
              ? ''
              : `（${formatPeriodRange(clockPeriods.periodStart, clockPeriods.periodEnd)}）`}
          </span>
        )}
      </div>
    </div>
  );
}
