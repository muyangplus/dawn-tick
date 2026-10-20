import type { UpdateStatus } from '../update.ts';
import type { ApplyMode } from '../webdav.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../channel.ts';
import { openExternalUrl } from '../system-actions.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';

/** 发布页地址：渠道提示与更新提示的下载入口共用 */
export const RELEASES_URL = 'https://github.com/muyangplus/dawn-tick/releases';

/** 渠道提示的 id：开发版可能频繁更新、公测版可能不稳定 */
export const NOTICE_DEV = 'dev-frequent-updates';
export const NOTICE_BETA = 'beta-unstable';

/** 关掉渠道提示时选了哪条路：× / 「知道了」是确认，另一条是去发布页 */
export interface NoticeDismissOptions {
  /** 关提示后要不要再查一次更新（切到测试版时用） */
  recheck?: boolean;
  /** 是否顺带打开发布页 */
  openReleases?: boolean;
}

export interface NoticeDialogProps {
  /** 待展示的提示 id；null 表示不展示 */
  notice: string | null;
  /** 关掉提示（× / Esc / 知道了 / 查看发布页）：调用方负责记为已读并清状态 */
  onDismiss: (notice: string, options: NoticeDismissOptions) => void;
}

/** 渠道提示：开发版可能频繁更新、公测版可能不稳定；每条只弹一次，新增提示对老用户也会弹。 */
export function NoticeDialog({ notice, onDismiss }: NoticeDialogProps) {
  return (
    <Dialog
      open={notice !== null}
      onOpenChange={(open) => {
        if (open || notice === null) return;
        onDismiss(notice, { recheck: notice === NOTICE_BETA });
      }}
    >
      <DialogContent
        title={notice === NOTICE_BETA ? '公测版提示' : '开发版提示'}
        description={notice === NOTICE_BETA ? '公测版可能不稳定，反馈请附日志' : '开发版滚动更新'}
      >
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              if (notice === null) return;
              onDismiss(notice, { openReleases: true });
            }}
          >
            查看发布页
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (notice === null) return;
              onDismiss(notice, {});
            }}
          >
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface UpdateDialogProps {
  /** 发现的新版本；null 表示不展示 */
  info: UpdateStatus | null;
  onClose: () => void;
}

/** 发现新版本：显示版本、渠道与发布说明，只提示不下载。 */
export function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  return (
    <Dialog
      open={info !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={`发现新版本 ${info?.latest ?? ''}`}
        description={`当前 ${appVersion()} · 渠道 ${CHANNEL_LABEL[info?.manifest?.channel ?? info?.feed ?? CHANNEL]}`}
      >
        {info?.manifest?.notes !== undefined && info.manifest.notes.trim().length > 0 && (
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-muted p-2 text-xs text-ink">
            {info.manifest.notes}
          </pre>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            稍后
          </Button>
          <Button variant="primary" onClick={() => openExternalUrl(RELEASES_URL)}>
            去发布页下载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
        title="远端有较新的备份"
        description={`${info?.name ?? ''}${info?.detail == null ? '' : ` · ${info.detail}`}；恢复全部将覆盖本机数据（下载前会先备份本机），不可撤销`}
      >
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            稍后
          </Button>
          <Button variant="secondary" aria-label="下载并只应用设置与预设" onClick={() => onApply('settings')}>
            只应用设置与预设
          </Button>
          <Button variant="danger" aria-label="下载并恢复整库" onClick={() => onApply('all')}>
            恢复全部
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
