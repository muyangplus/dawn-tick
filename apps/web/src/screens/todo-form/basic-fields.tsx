import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/controls.tsx';
import type { EventFormKind } from '../todo-form-model.ts';
import { KIND_LABEL, type TodoSectionProps } from './section-props.ts';

interface BasicFieldsProps extends TodoSectionProps {
  courses: ReadonlyArray<{ id: string; name: string }>;
  onChangeKind: (next: EventFormKind) => void;
}

/** 类型、标题与关联课程。 */
export function TodoBasicFields({ form, update, courses, onChangeKind }: BasicFieldsProps) {
  const { kind: current, title, courseId } = form;
  const isExam = current === 'exam';
  const isLab = current === 'lab';
  const isHomework = current === 'homework';
  return (
    <>
      <Field label="类型">
        <div className="flex flex-wrap gap-2">
          {(['todo', 'homework', 'exam', 'lab'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={current === item ? 'primary' : 'secondary'}
              aria-label={`待办类型：${KIND_LABEL[item]}`}
              aria-pressed={current === item}
              onClick={() => onChangeKind(item)}
            >
              {KIND_LABEL[item]}
            </Button>
          ))}
        </div>
      </Field>
      <Field label={isExam ? '考试名称' : isLab ? '实验名称' : isHomework ? '作业名称' : '标题'}>
        <Input
          value={title}
          aria-label={isExam ? '考试名称' : isLab ? '实验名称' : isHomework ? '作业名称' : '标题'}
          onChange={(event) => update({ title: event.target.value })}
        />
      </Field>
      {!isExam && (
        <Field label="关联课程（可选）" hint={isLab ? '实验会挂在课的同一列里展示' : '关联后归入该课程'}>
          <Select value={courseId} onValueChange={(value) => update({ courseId: value })}>
            <SelectTrigger aria-label="关联课程">
              {courses.find((item) => item.id === courseId)?.name ?? '不关联'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">不关联</SelectItem>
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
