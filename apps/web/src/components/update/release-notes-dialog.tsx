import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog.tsx';
import { Markdown } from '../ui/markdown.tsx';
import { updateDialogCopy } from '../../copy/update-dialog.ts';

export interface ReleaseNotesDialogProps {
  /** 待展示的版本说明；null 表示不展示 */
  notes: { version: string; source: string } | null;
  /** 关闭（× / Esc / 知道了）：调用方记下当前版本 */
  onClose: () => void;
  /** 「不再显示」：关掉设置里的开关 */
  onDisable: () => void;
}

/** 更新后的新版本内容：每个版本只弹一次，设置里可关。 */
export function ReleaseNotesDialog({ notes, onClose, onDisable }: ReleaseNotesDialogProps) {
  return (
    <Dialog
      open={notes !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={updateDialogCopy.releaseNotesTitle(notes?.version ?? '')}
        description={updateDialogCopy.releaseNotesDescription}
      >
        <Markdown
          source={notes?.source ?? ''}
          dataRole="release-notes"
          className="max-h-80 overflow-y-auto overscroll-contain pr-1"
        />
        <DialogFooter>
          <Button variant="secondary" onClick={onDisable} data-role="release-notes-disable">
            {updateDialogCopy.releaseNotesDisable}
          </Button>
          <Button variant="primary" onClick={onClose} data-role="release-notes-close">
            {updateDialogCopy.releaseNotesClose}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
