import { useState } from 'react';
import { releaseChannelOf } from '../../update.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { fail } from '../../copy/zh.ts';
import { errorMessage } from '../../lib/errors.ts';
import { isIgnoredVersion } from '../../lib/update-preferences.ts';
import { planUpdateDownload } from '../../lib/update-download.ts';
import {
  cancelUpdateTask,
  installUpdateTask,
  retryUpdateTask,
  startBackgroundUpdate,
  updateTaskSnapshot,
  useUpdateTask,
  type UpdateTask,
} from '../../lib/update-task.ts';
import { updatePlatform } from '../../lib/update-install.ts';
import { copyText, openExternalUrl } from '../../system-actions.ts';
import type { UpdatePrompt } from '../update-prompt.ts';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { toast } from '../ui/toaster.tsx';
import { RELEASES_URL } from './releases.ts';
import { describeUpdateDialog } from './update-dialog-model.ts';
import { UpdateNotes } from './update-notes.tsx';
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

/**
 * 发现新版本弹窗，三段式：头部（版本/渠道 → 当前版本）→ 正文（进度 + 发布说明 + 发布页链接）
 * → 底部操作区（按状态给下载/取消/后台下载并关闭/安装/重试/稍后/忽略）。
 *
 * 下载交给模块级后台任务：关闭弹窗不中断，再次打开弹窗或到设备页看到的是同一份进度。
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
  const latest = status?.latest?.trim() ?? null;
  // 只认与这个版本匹配的任务：另一个版本的后台下载不该出现在本弹窗里
  const matchedTask = task.status !== 'idle' && latest !== null && task.version === latest ? task : null;
  const view = describeUpdateDialog({ plan, task: matchedTask });
  /** 这次要弹的就是用户忽略过的版本：给「取消忽略」入口，手动检查仍能看到它 */
  const ignored = isIgnoredVersion(latest, info?.ignoredVersion ?? null);

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

  /** 结束后的提示：成功给可读结果，失败给原因，取消只提示不报错。 */
  function announce(final: UpdateTask): void {
    if (final.status === 'ready') {
      toast.success(final.message ?? '更新已就绪');
      return;
    }
    if (final.status === 'failed') {
      if (final.needsPermission) toast.info(final.error ?? '请允许安装未知应用后重试');
      else toast.error(fail('下载更新', final.error, '请稍后重试'));
      return;
    }
    if (final.status === 'cancelled') toast.info('已取消下载');
  }

  /** 开始下载：任务挂在模块级 store 上，弹窗随后被关掉也不会中断。 */
  async function startDownload(): Promise<void> {
    if (status === null) return;
    announce(await startBackgroundUpdate(status.manifest));
  }

  /** 失败重试：优先沿用后台任务记住的清单，没有任务时用当前弹窗的清单。 */
  async function retryDownload(): Promise<void> {
    if (matchedTask === null) {
      await startDownload();
      return;
    }
    announce(await retryUpdateTask());
  }

  async function install(): Promise<void> {
    await installUpdateTask();
    const final = updateTaskSnapshot();
    if (final.installed) {
      toast.success(final.message ?? '安装程序已启动，请按提示完成安装');
      if (final.target?.platform === 'web') globalThis.location?.reload();
      return;
    }
    if (final.status === 'failed') {
      if (final.needsPermission) toast.info(final.error ?? '请允许安装未知应用后重试');
      else toast.error(fail('启动安装程序', final.error, '请稍后重试'));
    }
  }

  function onPrimary(): void {
    switch (view.primaryKind) {
      case 'cancel':
        cancelUpdateTask();
        return;
      case 'install':
        void install();
        return;
      case 'refresh':
        globalThis.location?.reload();
        return;
      case 'retry':
        void retryDownload();
        return;
      default:
        void startDownload();
    }
  }

  /** 下载中「后台下载并关闭」：任务已经在跑，这里只负责收起弹窗并说明去哪看进度。 */
  function sendToBackground(): void {
    toast.info('已转到后台下载，可在设备页查看进度');
    onClose();
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

  /** 忽略这个版本：只记住版本号并关弹窗，下一次出现更高版本时照常提示。 */
  async function ignoreVersion(): Promise<void> {
    if (info === null || ignoring) return;
    setIgnoring(true);
    try {
      await changeIgnored(info.ignore, '已忽略该版本，不再自动提示', '忽略版本');
    } finally {
      setIgnoring(false);
    }
  }

  /** 取消忽略：弹窗保持打开，界面同步回到「可更新」状态。 */
  const unignoreVersion = (): Promise<void> =>
    info === null ? Promise.resolve() : changeIgnored(info.unignore, '已取消忽略，下次检查会再提示', '取消忽略');

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
        description={`发布渠道 ${CHANNEL_LABEL[channel]} · 当前版本 ${appVersion()}`}
      >
        <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted" data-role="update-header">
          <span className="font-medium text-ink">{latest ?? ''}</span>
          <span>{CHANNEL_LABEL[channel]}</span>
          <span aria-hidden>←</span>
          <span>当前 {appVersion()}</span>
        </div>
        {view.showProgress && <UpdateProgress progress={matchedTask?.progress ?? null} />}
        <UpdateNotes source={notes} />
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
        {view.statusText !== '' && (
          <p
            className={view.tone === 'danger' ? 'text-xs text-danger-strong' : 'text-xs text-muted'}
            data-role="update-status"
          >
            {view.statusText}
          </p>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">发布页链接</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              className="min-w-0 flex-1"
              data-role="update-release-url"
              aria-label="发布页链接"
              value={RELEASES_URL}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button size="sm" variant="secondary" data-role="update-copy-link" onClick={() => void copyReleaseLink()}>
              复制链接
            </Button>
            <Button
              size="sm"
              variant="secondary"
              data-role="update-open-release"
              loading={opening}
              onClick={() => void openReleasePage()}
            >
              打开发布页
            </Button>
          </div>
        </div>
        <DialogFooter>
          {view.showLater && (
            <Button variant="ghost" onClick={onClose}>
              稍后
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
          {view.showBackground && (
            <Button variant="secondary" data-role="update-background" onClick={sendToBackground}>
              后台下载并关闭
            </Button>
          )}
          <Button
            variant="primary"
            data-role="update-download"
            disabled={view.primaryDisabled}
            onClick={onPrimary}
          >
            {view.primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
