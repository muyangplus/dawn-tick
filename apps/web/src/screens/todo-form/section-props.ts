import type { EventFormKind, TodoFormState } from '../todo-form-model.ts';

export const KIND_LABEL: Record<EventFormKind, string> = {
  todo: '日程',
  homework: '作业',
  exam: '考试',
  lab: '实验',
};

/** 各分区共用：读整份表单，按字段打补丁写回。 */
export interface TodoSectionProps {
  form: TodoFormState;
  update: (patch: Partial<TodoFormState>) => void;
}
