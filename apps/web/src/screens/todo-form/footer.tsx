import { Button } from '../../components/ui/button.tsx';
import { DialogFooter } from '../../components/ui/dialog.tsx';
import { todoFormCopy } from '../../copy/todo-form.ts';

interface TodoFooterProps {
  /** 编辑中的条目标题；新建时为 null，不显示删除与复制 */
  editingTitle: string | null;
  busy: boolean;
  canSave: boolean;
  onRemove: () => void;
  onCancel: () => void;
  onCopy: () => void;
  onSave: () => void;
}

/** 删除（仅编辑）、取消、复制（仅编辑）、保存。 */
export function TodoFooter({ editingTitle, busy, canSave, onRemove, onCancel, onCopy, onSave }: TodoFooterProps) {
  return (
    <DialogFooter>
      {editingTitle !== null && (
        <Button
          variant="danger"
          className="mr-auto"
          loading={busy}
          aria-label={todoFormCopy.deleteItemAria(editingTitle)}
          onClick={onRemove}
        >
          {todoFormCopy.deleteButton}
        </Button>
      )}
      <Button variant="ghost" disabled={busy} onClick={onCancel}>
        {todoFormCopy.cancel}
      </Button>
      {editingTitle !== null && (
        <Button variant="secondary" loading={busy} onClick={onCopy}>
          {todoFormCopy.copyButton}
        </Button>
      )}
      <Button variant="primary" loading={busy} disabled={!canSave} onClick={onSave}>
        {todoFormCopy.saveButton}
      </Button>
    </DialogFooter>
  );
}
