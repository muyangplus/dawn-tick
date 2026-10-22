import { useState } from 'react';
import { releaseChannelOf } from '../../update.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { fail } from '../../copy/zh.ts';
import { errorMessage } from '../../lib/errors.ts';
import { isIgnoredVersion } from '../../lib/update-preferences.ts';
import { formatTransferProgress, planUpdateDownload } from '../../lib/update-download.ts';
import { createUpdateHost, updatePlatform } from '../../lib/update-install.ts';
import {
  IDLE_UPDATE_TASK,
  cancelUpdateTask,
  installUpdateTask,
  isUpdateTaskBusy,
  retryUpdateTask,
  startUpdateTask,
  useUpdateTask,
  type UpdateTaskState,
} from '../../lib/update-task.ts';
import { copyText, openExternalUrl } from '../../system-actions.ts';
import type { UpdatePrompt } from '../update-prompt.ts';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Markdown } from '../ui/markdown.tsx';
import { StatusLine } from '../ui/status-line.tsx';
import { toast } from '../ui/toaster.tsx';
import { RELEASES_URL } from './constants.ts';
import { UpdateProgress } from './update-progress.tsx';

export interface UpdateDialogProps {
  /** 发现的新版本（含此前忽略过的版本）；null 表示不展示。与启动自检共用 `update-prompt`。 */
  info: UpdatePrompt | null;
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

/** 当前版本对应的进度文案：失败、下载/校验、就绪、取消各一句，空态交给标题区。 */
function dialogStatusText(task: UpdateTaskState, ownsTask: boolean, refreshPlan: boolean): string {
  if (!ownsTask) return refreshPlan ? '新版本已发布，刷新页面后生效' : '';
  switch (task.status) {
    case 'failed':
      return task.needsPermission ? (task.error ?? '') : fail('下载更新', task.error, '请稍后重试');
    case 'downloading':
      return formatTransferProgress(task);
    case 'verifying':
      return task.message ?? '正在校验安装包…';
    case 'ready':
      return task.installed
        ? (task.message ?? '安装程序已启动，请按提示完成安装')
        : task.action === 'refresh'
          ? '新版本已就绪，刷新页面后生效'
          : (task.message ?? '安装包已就绪，可以安装');
    case 'cancelled':
      return task.message ?? '已取消下载';
    default:
      return '';
  }
}

/**
 * 发现新版本弹窗，三段式布局：
 * 头部（版本/渠道/当前版本）→ 正文（进度 + 可折叠发布说明 + 发布页）→ 底部（状态相关操作组）。
 *
 * 下载由后台任务 store 持有：弹窗关闭不会中断下载，重新打开或到设备页看到的是同一个任务。
 * 桌面/安卓就绪后点「安装」，Web 渠道就绪后点「刷新页面」。
 */
export function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  const [opening, setOpening] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const task = useUpdateTask();
  const status = info?.status ?? null;
  const notes = status?.manifest?.notes?.trim() ?? '';
  /** 渠道取发布本身的渠道：beta 预发布=测试版、正式版=正式版，不看接收开关 */
  const channel = status === null ? CHANNEL : releaseChannelOf(status);
  const platform = updatePlatform();
  const plan = planUpdateDownload(status?.manifest ?? null, platform);
  const version = (status?.latest ?? status?.manifest?.version ?? '').trim();
  /** 只认这个版本的后台任务；别的版本继续在设备页跑，不在这个弹窗里冒充 */
  const ownsTask = task.version !== null && version !== '' && task.version === version;
  const active = ownsTask ? task : IDLE_UPDATE_TASK;
  const busy = isUpdateTaskBusy(active);
  const ready = active.status === 'ready';
  const installed = ready && active.installed;
  const retryable = active.status === 'failed' || active.status === 'cancelled';
  const ignored = isIgnoredVersion(status?.latest ?? null, info?.ignoredVersion ?? null);
  const statusText = dialogStatusText(active, ownsTask, plan.kind === 'refresh');
  const progressVisible = ownsTask && (busy || ready);

  async function copyReleaseLink(): Promise<void> {
    const copied = await copyText(RELEASES_URL);
    toast[copied ? 'success' : 'error'](copied ? '已复制发布页链接' : '复制失败，请手动选中链接复制');
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

  /** 写 app_meta 失败时不让弹窗状态悄悄错位：忽略/取消忽略都回一句可读结果 */
  async function changeIgnored(run: () => Promise<void>, ok: string, what: string): Promise<void> {
    try {
      await run();
      toast.success(ok);
    } catch (cause: unknown) {
      toast.error(fail(what, errorMessage(cause), '请稍后再试'));
    }
  }

  async function ignoreVersion(): Promise<void> {
    if (info === null || ignoring) return;
    setIgnoring(true);
    try {
      await changeIgnored(info.ignore, '已忽略该版本，不再自动提示', '忽略版本');
    } finally {
      setIgnoring(false);
    }
  }

  const unignoreVersion = (): Promise<void> =>
    info === null ? Promise.resolve() : changeIgnored(info.unignore, '已取消忽略，下次检查会再提示', '取消忽略');

  /** 开始后台下载；`closeAfter` 为 true 时先关弹窗，下载在后台继续。 */
  async function startDownload(closeAfter: boolean): Promise<void> {
    if (status === null || version === '' || plan.kind === 'unavailable') return;
    if (plan.kind === 'refresh') {
      const started = await startUpdateTask({
        version,
        plan,
        host: createUpdateHost(platform === 'android' ? 'android' : 'windows'),
      });
      if (started.status === 'ready') await installUpdateTask();
      return;
    }
    void startUpdateTask({
      version,
      plan,
      host: createUpdateHost(platform === 'android' ? 'android' : 'windows'),
    });
    if (closeAfter) onClose();
  }

  /** 主按钮按状态分流：取消 → 关闭 → 安装/刷新 → 重试 → 下载。 */
  async function onPrimary(): Promise<void> {
    if (busy) {
      cancelUpdateTask();
      return;
    }
    if (installed) {
      onClose();
      return;
    }
    if (ready) {
      const final = await installUpdateTask();
      if (final.status === 'ready' && final.installed) toast.success(final.message ?? '更新已就绪');
      else if (final.status === 'failed') toast.error(updateInstallFailure(final));
      return;
    }
    if (retryable) {
      await retryUpdateTask();
      return;
    }
    await startDownload(false);
  }

  const primaryLabel = busy
    ? '取消下载'
    : installed
      ? '关闭'
      : ready
        ? active.action === 'refresh'
          ? '刷新页面'
          : '安装'
        : retryable
          ? '重试'
          : plan.kind === 'refresh'
            ? '刷新页面'
            : '下载';

  return (
    <Dialog
      open={info !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-role="update-dialog"
        title={`发现新版本 ${status?.latest ?? ''}`}
        description={`当前版本 ${appVersion()} · 发布渠道 ${CHANNEL_LABEL[channel]}`}
      >
        {/* 正文第一段：进度（进度条 + 百分比/速度/已收/剩余） */}
        {progressVisible ? (
          <UpdateProgress
            percent={(active.progress ?? 0) * 100}
            text={statusText}
            barRole="update-progress"
            statusRole="update-status"
          />
        ) : (
          statusText !== '' && (
            <StatusLine dataRole="update-status" tone={active.status === 'failed' ? 'danger' : 'muted'}>
              {statusText}
            </StatusLine>
          )
        )}

        {/* 正文第二段：发布说明，可折叠、最大高度内滚动 */}
        {notes !== '' && (
          <details
            open
            data-role="update-notes-block"
            className="rounded-md border border-line bg-surface-muted"
          >
            <summary className="min-h-tap cursor-pointer px-3 py-2 text-xs font-medium text-ink">发布说明</summary>
            <Markdown
              source={notes}
              dataRole="update-notes"
              className="max-h-56 overflow-y-auto overscroll-contain px-3 pb-3"
            />
          </details>
        )}
        {ignored && (
          <p className="text-xs text-muted" data-role="update-ignored">
            已忽略此版本，可在这里取消忽略
          </p>
        )}
        {plan.kind === 'unavailable' && (
          <p className="text-xs text-muted" data-role="update-unavailable">
            {fail('自动更新', plan.reason, '请到发布页下载')}
          </p>
        )}
        {plan.kind === 'download' && !busy && !ready && (
          <p className="text-xs text-muted" data-role="update-background-hint">
            下载在后台进行，关闭弹窗不会中断；随时可在「设备与同步 → 更新与维护」查看进度。
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

        {/* 底部：按状态分组的操作区 */}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            稍后
          </Button>
          {plan.kind === 'download' && !busy && !ready && (
            <Button
              variant="secondary"
              data-role="update-background"
              onClick={() => void startDownload(true)}
            >
              后台下载并关闭
            </Button>
          )}
          {ignored ? (
            <Button variant="secondary" data-role="update-unignore" onClick={() => void unignoreVersion()}>
              取消忽略
            </Button>
          ) : (
            <Button
              variant="secondary"
              data-role="update-ignore"
              loading={ignoring}
              onClick={() => void ignoreVersion()}
            >
              忽略此版本
            </Button>
          )}
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
            disabled={plan.kind === 'unavailable' && !busy && !retryable && !ready}
            onClick={() => void onPrimary()}
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 安装失败的提示句：授权问题原样给系统提示，其余用 fail() 拼。 */
function updateInstallFailure(task: UpdateTaskState): string {
  if (task.needsPermission) return task.error ?? '请允许安装未知应用后重试';
  return fail('安装更新', task.error, '请稍后重试');
}
