import type { ApplyMode } from '../webdav.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';
import { appShellCopy } from '../copy/app-shell.ts';

/**
 * 只读弹窗的统一出口：更新域弹窗已经拆到 `components/update/`，
 * 这里只做 re-export，保证 `App.tsx` / `use-app-effects` / 冒烟的导入路径与 data-role 不变。
 *
 * 「远端有较新的备份」属于备份域而不是更新域，因此留在本文件；
 * 它的导入方（`use-app-session` / `App`）同样不需要改路径。
 */
export { NOTICE_BETA, NOTICE_DEV, RELEASES_URL } from './update/releases.ts';
export { NoticeDialog, type NoticeDismissOptions } from './update/notice-dialog.tsx';
export { UpdateDialog, type UpdateDialogProps } from './update/update-dialog.tsx';

export interface RemoteBackupInfo {
  name: string;
  detail: string | null;
}

export interface RemoteNewerDialogProps {
  /** 远端备份比本机新时的信息；null 表示不展示 */
  info: RemoteBackupInfo | null;
  onClose: () => void;
  /** 下载并应用：只应用设置与预设，或整库恢复 */
  onApply: (mode: ApplyMode) => void;
}

/** 远端备份更新：提示下载，下载前先给本机做快照。 */
export function RemoteNewerDialog({ info, onClose, onApply }: RemoteNewerDialogProps) {
  return (
    <Dialog
      open={info !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={appShellCopy.remoteNewer.title}
        description={appShellCopy.remoteNewer.description(info?.name ?? '', info?.detail ?? null)}
      >
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {appShellCopy.remoteNewer.laterButton}
          </Button>
          <Button variant="secondary" aria-label={appShellCopy.remoteNewer.applySettingsAria} onClick={() => onApply('settings')}>
            {appShellCopy.remoteNewer.applySettingsButton}
          </Button>
          <Button variant="danger" aria-label={appShellCopy.remoteNewer.restoreAllAria} onClick={() => onApply('all')}>
            {appShellCopy.remoteNewer.restoreAllButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
