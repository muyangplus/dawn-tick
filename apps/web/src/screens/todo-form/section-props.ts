import type { EventFormKind, TodoFormState } from '../todo-form-model.ts';
import { todoFormCopy } from '../../copy/todo-form.ts';

export const KIND_LABEL: Record<EventFormKind, string> = todoFormCopy.kind;

/** 各分区共用：读整份表单，按字段打补丁写回。 */
export interface TodoSectionProps {
  form: TodoFormState;
  update: (patch: Partial<TodoFormState>) => void;
}
