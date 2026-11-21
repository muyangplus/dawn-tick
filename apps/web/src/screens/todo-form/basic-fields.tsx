import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/controls.tsx';
import type { EventFormKind } from '../todo-form-model.ts';
import { KIND_LABEL, type TodoSectionProps } from './section-props.ts';
import { todoFormCopy } from '../../copy/todo-form.ts';

interface BasicFieldsProps extends TodoSectionProps {
  courses: ReadonlyArray<{ id: string; name: string }>;
  onChangeKind: (next: EventFormKind) => void;
}

/** 类型、标题与关联课程。 */
export function TodoBasicFields({ form, update, courses, onChangeKind }: BasicFieldsProps) {
  const { kind: current, title, courseId } = form;
  const isExam = current === 'exam';
  const isLab = current === 'lab';
  return (
    <>
      <Field label={todoFormCopy.typeLabel}>
        <div className="flex flex-wrap gap-2">
          {(['todo', 'homework', 'exam', 'lab'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={current === item ? 'primary' : 'secondary'}
              aria-label={todoFormCopy.typeButton(KIND_LABEL[item])}
              aria-pressed={current === item}
              onClick={() => onChangeKind(item)}
            >
              {KIND_LABEL[item]}
            </Button>
          ))}
        </div>
      </Field>
      <Field label={todoFormCopy.titleLabel[current]}>
        <Input
          value={title}
          aria-label={todoFormCopy.titleLabel[current]}
          onChange={(event) => update({ title: event.target.value })}
        />
      </Field>
      {!isExam && (
        <Field label={todoFormCopy.courseLabel} {...(isLab ? { hint: todoFormCopy.courseHintLab } : {})}>
          <Select value={courseId} onValueChange={(value) => update({ courseId: value })}>
            <SelectTrigger aria-label={todoFormCopy.courseAria}>
              {courses.find((item) => item.id === courseId)?.name ?? todoFormCopy.noCourse}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{todoFormCopy.noCourse}</SelectItem>
              {courses.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </>
  );
}
