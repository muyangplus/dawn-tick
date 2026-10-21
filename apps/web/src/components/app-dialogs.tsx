import { useState } from 'react';
import type { UpdateStatus } from '../update.ts';
import { releaseChannelOf } from '../update.ts';
import type { ApplyMode } from '../webdav.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../channel.ts';
import { copyText, openExternalUrl } from '../system-actions.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';
import { Input } from './ui/input.tsx';
import { Markdown } from './ui/markdown.tsx';
import { toast } from './ui/toaster.tsx';

/** 发布页地址：渠道提示与更新提示的下载入口共用 */
export const RELEASES_URL = 'https://github.com/muyangplus/dawn-tick/releases';

/** 渠道提示的 id：开发版可能频繁更新、测试版可能不稳定 */
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

/** 渠道提示：开发版可能频繁更新、测试版可能不稳定；每条只弹一次，新增提示对老用户也会弹。 */
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
        title={notice === NOTICE_BETA ? '测试版提示' : '开发版提示'}
        description={
          notice === NOTICE_BETA
            ? '测试版可能不稳定，反馈请附日志'
            : '开发版仅用于开发与测试，日常使用建议安装正式版'
        }
      >
        <p className="text-xs text-muted" data-role="channel-notice-detail">
          {notice === NOTICE_BETA
            ? '测试版会先于正式版收到改动，可能包含未完成的功能；遇到问题请在反馈里附上「应用诊断日志」。'
            : '开发版随每次提交滚动更新，不保证稳定，也不参与测试版开关。'}
        </p>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              if (notice === null) return;
              onDismiss(notice, { openReleases: true });
            }}
            data-role="channel-notice-releases"
          >
            下载正式版
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
  /** 发现的新版本；null 表示不展示。与启动自检共用 `update-prompt` 的数据形状。 */
  info: UpdateStatus | null;
  onClose: () => void;
}

/**
 * 原生「用默认浏览器打开」可能迟迟不返回：只在点击时调用一次并设上限，
 * 超时按失败提示；弹窗打开时不做任何预加载/预取。
 */
async function openReleasePageOnce(url: string, timeoutMs = 8000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([openExternalUrl(url), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 发现新版本：版本号、发布渠道、当前版本与发布说明（Markdown）。
 * 只提示不下载；「复制链接」与「打开发布页」互不依赖，打开失败也能复制。
 */
export function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  const [opening, setOpening] = useState(false);
  const notes = info?.manifest?.notes?.trim() ?? '';
  /** 渠道取发布本身的渠道：beta 预发布=测试版、正式版=正式版，不看接收开关 */
  const channel = info === null ? CHANNEL : releaseChannelOf(info);

  async function copyReleaseLink(): Promise<void> {
    const copied = await copyText(RELEASES_URL);
    if (copied) toast.success('已复制发布页链接');
    else toast.error('复制失败，请手动选中链接复制');
  }

  async function openReleasePage(): Promise<void> {
    if (opening) return;
    setOpening(true);
    try {
      const opened = await openReleasePageOnce(RELEASES_URL);
      if (opened) toast.success('已在默认浏览器打开发布页');
      else toast.info('打开浏览器失败，请改用「复制链接」');
    } finally {
      setOpening(false);
    }
  }

  return (
    <Dialog
      open={info !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-role="update-dialog"
        title={`发现新版本 ${info?.latest ?? ''}`}
        description={`当前版本 ${appVersion()} · 发布渠道 ${CHANNEL_LABEL[channel]}`}
      >
        {notes !== '' && (
          <Markdown
            source={notes}
            dataRole="update-notes"
            className="max-h-56 overflow-y-auto overscroll-contain rounded-md border border-line bg-surface-muted p-3"
          />
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span>发布页链接</span>
          <Input
            readOnly
            data-role="update-release-url"
            aria-label="发布页链接"
            value={RELEASES_URL}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            稍后
          </Button>
          <Button variant="secondary" data-role="update-copy-link" onClick={() => void copyReleaseLink()}>
            复制链接
          </Button>
          <Button
            variant="primary"
            data-role="update-open-release"
            loading={opening}
            onClick={() => void openReleasePage()}
          >
            打开发布页
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
