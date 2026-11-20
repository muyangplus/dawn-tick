import { Button } from '../../components/ui/button.tsx';
import { DialogFooter } from '../../components/ui/dialog.tsx';

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
          aria-label={`删除条目 ${editingTitle}`}
          onClick={onRemove}
        >
          删除这条
        </Button>
      )}
      <Button variant="ghost" disabled={busy} onClick={onCancel}>
        取消
      </Button>
      {editingTitle !== null && (
        <Button variant="secondary" loading={busy} onClick={onCopy}>
          复制一条
        </Button>
      )}
      <Button variant="primary" loading={busy} disabled={!canSave} onClick={onSave}>
        保存
      </Button>
    </DialogFooter>
  );
}
