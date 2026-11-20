import { Field, Input, Textarea } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import type { TodoSectionProps } from './section-props.ts';

/** 地点/座位号（考试、实验）、三个开关与备注。 */
export function TodoDetailFields({ form, update }: TodoSectionProps) {
  const { kind: current, location, seatNo, showInTimetable, note } = form;
  const switches = { countdown: form.countdown, manualDone: form.manualDone };
  const isExam = current === 'exam';
  const isLab = current === 'lab';
  return (
    <>
      {(isExam || isLab) && (
        <div className="flex flex-wrap gap-3">
          <Field label="地点（可选）">
            <Input
              value={location}
              aria-label={isLab ? '实验地点' : '考试地点'}
              onChange={(event) => update({ location: event.target.value })}
            />
          </Field>
          {isExam && (
            <Field label="座位号（可选）">
              <Input value={seatNo} aria-label="座位号" onChange={(event) => update({ seatNo: event.target.value })} />
            </Field>
          )}
        </div>
      )}
      <SwitchField
        label="开启倒计时"
        description="在倒计时卡片里显示剩余天数"
        checked={switches.countdown}
        onCheckedChange={(checked) => update({ countdown: checked })}
        ariaLabel="开启倒计时"
      />
      <SwitchField
        label="显示在课表上"
        description="占用课表格子"
        checked={showInTimetable}
        onCheckedChange={(checked) => update({ showInTimetable: checked })}
        ariaLabel="显示在课表上"
      />
      <SwitchField
        label="需要手动确认完成"
        description="打开后不会自动完成，过期仍留在待办列表"
        checked={switches.manualDone}
        onCheckedChange={(checked) => update({ manualDone: checked })}
        ariaLabel="需要手动确认完成"
      />
      <Field label="备注">
        <Textarea value={note} aria-label="备注" onChange={(event) => update({ note: event.target.value })} />
      </Field>
    </>
  );
}
