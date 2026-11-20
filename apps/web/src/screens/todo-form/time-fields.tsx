import { plusMinutesText } from '@dawn-tick/core';
import { Field, Input } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';
import { ADVANCE_OPTIONS } from '../todo-form-model.ts';
import type { TodoSectionProps } from './section-props.ts';

/** 日期、时间（或自定义起止时间）、提前提醒，以及「自定义时间」开关。 */
export function TodoTimeFields({ form, update }: TodoSectionProps) {
  const { kind: current, dueDate, dueTime, advance, customTime, startTime, endTime } = form;
  const isExam = current === 'exam';
  const isLab = current === 'lab';
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Field label={isExam ? '考试日期' : isLab ? '首次日期' : '日期'}>
          <Input
            type="date"
            value={dueDate}
            aria-label={isExam ? '考试日期' : isLab ? '首次日期' : '日期'}
            onChange={(event) => update({ dueDate: event.target.value })}
          />
        </Field>
        {!isLab && !customTime && (
          <Field label={isExam ? '开考时间' : '时间'}>
            <Input
              type="time"
              value={dueTime}
              aria-label={isExam ? '开考时间' : '时间'}
              onChange={(event) => update({ dueTime: event.target.value })}
            />
          </Field>
        )}
        {customTime && (
          <>
            <Field label="开始时间">
              <Input
                type="time"
                value={startTime}
                aria-label="开始时间"
                onChange={(event) => {
                  const start = event.target.value;
                  update({ startTime: start, endTime: endTime <= start ? plusMinutesText(start, 90) : endTime });
                }}
              />
            </Field>
            <Field label="结束时间">
              <Input
                type="time"
                value={endTime}
                aria-label="结束时间"
                onChange={(event) => update({ endTime: event.target.value })}
              />
            </Field>
          </>
        )}
        <Field label="提前提醒">
          <Select value={advance} onValueChange={(value) => update({ advance: value })}>
            <SelectTrigger aria-label={isExam ? '考试提前提醒' : '待办提前提醒'}>
              {ADVANCE_OPTIONS.find((item) => item.id === advance)?.label ?? '提前 1 天'}
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
        label="自定义时间"
        description="按真实起止时间显示"
        checked={customTime}
        onCheckedChange={(checked) => update({ customTime: checked })}
        ariaLabel="自定义时间"
      />
    </>
  );
}
