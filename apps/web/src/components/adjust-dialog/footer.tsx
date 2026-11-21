import type { AdjustMode } from '../../screens/timetable/move-controller.ts';
import { Button } from '../ui/button.tsx';
import { DialogFooter } from '../ui/dialog.tsx';
import { adjustCopy } from '../../copy/timetable-adjust.ts';

interface AdjustFooterProps {
  mode: AdjustMode;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

/** 取消 + 按模式变化文案的确认按钮。 */
export function AdjustFooter({ mode, busy, disabled, onCancel, onSubmit }: AdjustFooterProps) {
  return (
    <DialogFooter>
      <Button variant="ghost" onClick={onCancel}>
        {adjustCopy.cancelButton}
      </Button>
      <Button variant="primary" loading={busy} disabled={disabled} onClick={onSubmit}>
        {adjustCopy.submit[mode]}
      </Button>
    </DialogFooter>
  );
}
