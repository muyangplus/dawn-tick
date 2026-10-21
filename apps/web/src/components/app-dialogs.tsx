import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../update.ts';
import { releaseChannelOf } from '../update.ts';
import type { ApplyMode } from '../webdav.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../channel.ts';
import { fail } from '../copy/zh.ts';
import {
  INITIAL_UPDATE_STATE,
  formatDownloadProgress,
  isUpdateBusy,
  planUpdateDownload,
  runUpdateDownload,
  type UpdateDownloadState,
} from '../lib/update-download.ts';
import { createUpdateHost, updatePlatform } from '../lib/update-install.ts';
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
 * 「下载并安装」按渠道走：桌面下安装包交给 `run_installer`，Android 写 Cache 后交 `ApkInstaller`；
 * Web 不下载，只提示刷新。进度、失败原因与重试全部消费 `update-download` 的状态机。
 */
export function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  const [opening, setOpening] = useState(false);
  const [download, setDownload] = useState<UpdateDownloadState>(INITIAL_UPDATE_STATE);
  /** 进行中的下载：关闭弹窗或换版本时中止，避免后台继续下载 */
  const running = useRef<AbortController | null>(null);
  const notes = info?.manifest?.notes?.trim() ?? '';
  /** 渠道取发布本身的渠道：beta 预发布=测试版、正式版=正式版，不看接收开关 */
  const channel = info === null ? CHANNEL : releaseChannelOf(info);
  const platform = updatePlatform();
  const plan = planUpdateDownload(info?.manifest ?? null, platform);
  const busy = isUpdateBusy(download.phase);

  // 关闭弹窗或换成另一个版本：中止下载并回到初始态，不把上一次的失败/完成带进新弹窗
  useEffect(() => {
    running.current?.abort();
    running.current = null;
    setDownload(INITIAL_UPDATE_STATE);
  }, [info?.latest]);

  // 卸载时中止：更新下载不该在弹窗销毁后继续占用网络
  useEffect(() => {
    return () => {
      running.current?.abort();
    };
  }, []);

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

  /** 结束后的提示：成功给出「安装程序已启动」，失败给可读原因，取消只提示不报错。 */
  function announce(state: UpdateDownloadState): void {
    if (state.phase === 'done') {
      toast.success(state.message ?? '更新已就绪');
      return;
    }
    if (state.phase === 'failed' && state.needsPermission) {
      toast.info(state.error ?? '请允许安装未知应用后重试');
      return;
    }
    if (state.phase === 'failed') {
      toast.error(fail('下载更新', state.error, '请稍后重试'));
      return;
    }
    if (state.message !== null) toast.info(state.message);
  }

  async function startDownload(): Promise<void> {
    if (info === null || busy) return;
    if (plan.kind === 'refresh') {
      globalThis.location?.reload();
      return;
    }
    const controller = new AbortController();
    running.current = controller;
    const final = await runUpdateDownload({
      plan,
      host: createUpdateHost(platform === 'android' ? 'android' : 'windows'),
      signal: controller.signal,
      onState: (next) => {
        if (running.current === controller) setDownload(next);
      },
    });
    if (running.current !== controller) return;
    running.current = null;
    setDownload(final);
    announce(final);
  }

  /** 下载中点主按钮 = 取消：中止网络并回到 idle，不产生失败提示。 */
  function cancelDownload(): void {
    running.current?.abort();
  }

  async function onPrimary(): Promise<void> {
    if (busy) {
      cancelDownload();
      return;
    }
    if (download.phase === 'done') {
      onClose();
      return;
    }
    await startDownload();
  }

  const statusText =
    download.phase === 'failed'
      ? download.needsPermission
        ? (download.error ?? '')
        : fail('下载更新', download.error, '请稍后重试')
      : download.phase === 'idle'
        ? (download.message ?? (plan.kind === 'refresh' ? '新版本已发布，刷新页面后生效' : ''))
        : formatDownloadProgress(download);
  const primaryLabel = busy
    ? '取消下载'
    : download.phase === 'done'
      ? '完成'
      : plan.kind === 'refresh'
        ? '刷新页面'
        : download.phase === 'failed'
          ? '重试'
          : '下载并安装';

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
        {plan.kind === 'unavailable' && (
          <p className="text-xs text-muted" data-role="update-unavailable">
            {fail('自动更新', plan.reason, '请到发布页下载')}
          </p>
        )}
        {busy && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" data-role="update-progress">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round((download.progress ?? 0) * 100)}%` }}
            />
          </div>
        )}
        {statusText !== '' && (
          <p className="text-xs text-muted" data-role="update-status">
            {statusText}
          </p>
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
            variant="secondary"
            data-role="update-open-release"
            loading={opening}
            onClick={() => void openReleasePage()}
          >
            打开发布页
          </Button>
          <Button
            variant="primary"
            data-role="update-download"
            disabled={plan.kind === 'unavailable' && !busy && download.phase !== 'failed'}
            onClick={() => void onPrimary()}
          >
            {primaryLabel}
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
