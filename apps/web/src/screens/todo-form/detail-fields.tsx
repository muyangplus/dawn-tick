import { Field, Input, Textarea } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import type { TodoSectionProps } from './section-props.ts';
import { todoFormCopy } from '../../copy/todo-form.ts';

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
          <Field label={todoFormCopy.locationLabel}>
            <Input
              value={location}
              aria-label={isLab ? todoFormCopy.locationAriaLab : todoFormCopy.locationAriaExam}
              onChange={(event) => update({ location: event.target.value })}
            />
          </Field>
          {isExam && (
            <Field label={todoFormCopy.seatLabel}>
              <Input value={seatNo} aria-label={todoFormCopy.seatAria} onChange={(event) => update({ seatNo: event.target.value })} />
            </Field>
          )}
        </div>
      )}
      <SwitchField
        label={todoFormCopy.countdownLabel}
        description={todoFormCopy.countdownDescription}
        checked={switches.countdown}
        onCheckedChange={(checked) => update({ countdown: checked })}
        ariaLabel={todoFormCopy.countdownLabel}
      />
      <SwitchField
        label={todoFormCopy.timetableLabel}
        description={todoFormCopy.timetableDescription}
        checked={showInTimetable}
        onCheckedChange={(checked) => update({ showInTimetable: checked })}
        ariaLabel={todoFormCopy.timetableLabel}
      />
      <SwitchField
        label={todoFormCopy.manualDoneLabel}
        description={todoFormCopy.manualDoneDescription}
        checked={switches.manualDone}
        onCheckedChange={(checked) => update({ manualDone: checked })}
        ariaLabel={todoFormCopy.manualDoneLabel}
      />
      <Field label={todoFormCopy.noteLabel}>
        <Textarea value={note} aria-label={todoFormCopy.noteLabel} onChange={(event) => update({ note: event.target.value })} />
      </Field>
    </>
  );
}
