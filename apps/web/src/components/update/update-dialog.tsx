import { useState } from 'react';
import { releaseChannelOf } from '../../update.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { fail } from '../../copy/zh.ts';
import { errorMessage } from '../../lib/errors.ts';
import { DOWNLOAD_SOURCE_LABEL } from '../../lib/download-source.ts';
import { isIgnoredVersion } from '../../lib/update-preferences.ts';
import { planUpdateDownload } from '../../lib/update-download.ts';
import {
  cancelUpdateTask,
  installUpdateTask,
  retryUpdateTask,
  startAutomaticUpdate,
  startBackgroundUpdate,
  updateTaskSnapshot,
  useUpdateTask,
  type UpdateTask,
} from '../../lib/update-task.ts';
import { updatePlatform, useDetectedWindowsInstallKind } from '../../lib/update-install.ts';
import { copyText, openExternalUrl } from '../../system-actions.ts';
import type { UpdatePrompt } from '../update-prompt.ts';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog.tsx';
import { toast } from '../ui/toaster.tsx';
import { RELEASES_URL } from './releases.ts';
import { describeUpdateDialog } from './update-dialog-model.ts';
import { UpdateInstallKindLine } from './update-install-kind.tsx';
import { UpdateMoreMenu } from './update-more-menu.tsx';
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
 * 发现新版本弹窗：头部（版本/渠道/安装形态 + 详细说明）→ 正文（进度 + 发布说明 + 状态）
 * → 底部（稍后 / 更多 / 立即更新）。
 *
 * 「立即更新」是唯一主操作：点击后自动下载 → 校验 → 安装（便携版自动退出替换，
 * Android 调起系统安装器，Web 刷新或下载 Web 包），失败原因直接显示在状态行。
 * 下载交给模块级后台任务：关闭弹窗不中断，再次打开弹窗或到设备页看到的是同一份进度。
 */
export function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  const [opening, setOpening] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  /** 一键更新的下载/校验阶段：按钮挂起，避免重复触发 */
  const [starting, setStarting] = useState(false);
  /** 已进入安装（下载完成自动串起来）：状态行显示「正在安装」，不再给按钮 */
  const [installing, setInstalling] = useState(false);
  const task = useUpdateTask();
  const status = info?.status ?? null;
  const notes = status?.manifest?.notes?.trim() ?? '';
  /** 渠道取发布本身的渠道：beta 预发布=测试版、正式版=正式版，不看接收开关 */
  const channel = status === null ? CHANNEL : releaseChannelOf(status);
  /** 实际下载源：跨源回退后显示回退源，并说明回退 */
  const sourceLabel = status === null ? null : DOWNLOAD_SOURCE_LABEL[status.source];
  const fallbackLabel = status?.fallbackFrom === undefined ? null : DOWNLOAD_SOURCE_LABEL[status.fallbackFrom];
  const platform = updatePlatform();
  /** Windows 运行形态：便携版下 zip，安装版下安装包；检测中是 null（先按安装版渲染） */
  const installKind = useDetectedWindowsInstallKind(platform);
  const plan = planUpdateDownload(status?.manifest ?? null, platform, installKind ?? 'installed');
  const latest = status?.latest?.trim() ?? null;
  /** Web 渠道清单里提供的 web 包：有则「立即更新」直接下载文件 */
  const webAssetUrl = status?.manifest?.assets?.web?.url ?? null;
  // 只认与这个版本匹配的任务：另一个版本的后台下载不该出现在本弹窗里
  const matchedTask = task.status !== 'idle' && latest !== null && task.version === latest ? task : null;
  const view = describeUpdateDialog({ plan, task: matchedTask, installing, webAssetUrl });
  /** 这次要弹的就是用户忽略过的版本：给「取消忽略」入口，手动检查仍能看到它 */
  const ignored = isIgnoredVersion(latest, info?.ignoredVersion ?? null);
  const busy = starting || installing;
  /** 复制哪条链接：能确定下载目标就给安装包地址，否则退回发布页 */
  const downloadUrl = plan.kind === 'download' ? plan.target.url : (webAssetUrl ?? RELEASES_URL);

  async function copyDownloadLink(): Promise<void> {
    const copied = await copyText(downloadUrl);
    toast[copied ? 'success' : 'error'](copied ? '已复制下载链接' : '复制失败，请手动选中链接复制');
  }

  async function openReleasePage(): Promise<void> {
    if (opening) return;
    setOpening(true);
    try {
      const opened = await openReleasePageOnce(RELEASES_URL);
      if (opened) toast.success('已在默认浏览器打开发布页');
      else toast.info('打开浏览器失败，请改用「更多 → 复制下载链接」');
    } finally {
      setOpening(false);
    }
  }

  /** 结束后的提示：成功给可读结果，失败给原因，取消只提示不报错。 */
  function announce(final: UpdateTask): void {
    if (final.installed) {
      toast.success(final.message ?? '安装程序已启动，请按提示完成安装');
      if (final.target?.platform === 'web') globalThis.location?.reload();
      return;
    }
    if (final.status === 'failed') {
      if (final.needsPermission) toast.info(final.error ?? '请允许安装未知应用后重试');
      else toast.error(fail(final.target?.kind === 'portable' ? '准备便携版更新' : '下载更新', final.error, '请稍后重试'));
      return;
    }
    if (final.status === 'cancelled') {
      toast.info('已取消下载');
      return;
    }
    if (final.status === 'ready') toast.success(final.message ?? '更新已就绪');
  }

  /** 主操作：下载 → 校验 → 自动安装，默认路径一次点击完成。 */
  async function updateNow(): Promise<void> {
    if (status === null || starting) return;
    setStarting(true);
    try {
      const final = await startAutomaticUpdate(
        status.manifest,
        { source: status.source },
        { onInstalling: () => setInstalling(true) },
      );
      announce(final);
    } catch (cause: unknown) {
      toast.error(fail('更新', errorMessage(cause), '请稍后重试'));
    } finally {
      setInstalling(false);
      setStarting(false);
    }
  }

  /** 已经有下载好的安装包（例如后台任务此前完成）：直接进入安装链路。 */
  async function installNow(): Promise<void> {
    if (installing) return;
    setInstalling(true);
    try {
      await installUpdateTask();
      announce(updateTaskSnapshot());
    } finally {
      setInstalling(false);
    }
  }

  /** Web 渠道：清单带 web 包就直接打开下载地址，否则刷新页面加载新构建。 */
  async function downloadWebPackage(): Promise<void> {
    if (webAssetUrl === null) {
      globalThis.location?.reload();
      return;
    }
    const opened = await openExternalUrl(webAssetUrl);
    toast[opened ? 'success' : 'error'](
      opened ? '已开始下载 Web 版安装包' : '打开下载地址失败，请用「更多 → 复制下载链接」',
    );
  }

  /** 失败重试：权限类失败安装包已落盘，授权后只需再交给安装器；其余重新走一键更新。 */
  async function retryFromMenu(): Promise<void> {
    if (matchedTask?.status === 'failed' && matchedTask.needsPermission) {
      setInstalling(true);
      try {
        announce(await retryUpdateTask());
      } finally {
        setInstalling(false);
      }
      return;
    }
    await updateNow();
  }

  function onPrimary(): void {
    switch (view.primaryKind) {
      case 'install':
        void installNow();
        return;
      case 'refresh':
        globalThis.location?.reload();
        return;
      case 'download-web':
        void downloadWebPackage();
        return;
      case 'update':
        void updateNow();
        return;
      default:
        return;
    }
  }

  /** 下载中「后台下载并关闭」：任务继续跑，这里只负责收起弹窗并说明去哪看进度。 */
  function sendToBackground(): void {
    if (status !== null && matchedTask === null) {
      void startBackgroundUpdate(status.manifest, { source: status.source });
    }
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
          {sourceLabel !== null && (
            <span data-role="update-source">
              下载源 {sourceLabel}
              {fallbackLabel === null ? '' : `（${fallbackLabel} 不可用，已回退）`}
            </span>
          )}
          <UpdateInstallKindLine platform={platform} />
          {/* 头部只保留发布说明链接，不再放单独的复制/打开发布页按钮 */}
          <button
            type="button"
            data-role="update-notes-link"
            className="text-xs text-primary-strong underline underline-offset-2"
            onClick={() => void openReleasePage()}
          >
            详细说明
          </button>
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
        <DialogFooter>
          {view.showCancel && (
            <Button variant="ghost" size="sm" data-role="update-cancel" onClick={cancelUpdateTask}>
              取消
            </Button>
          )}
          {view.showLater && (
            <Button variant="ghost" onClick={onClose}>
              稍后
            </Button>
          )}
          {view.showMore && (
            <UpdateMoreMenu
              ignored={ignored}
              ignoring={ignoring}
              // 一键更新正在跑时不给「后台下载并关闭」：那会与自动安装的流程决定冲突
              showBackground={view.showBackground && !starting && !installing}
              showRetry={view.showRetry}
              onIgnore={() => void ignoreVersion()}
              onUnignore={() => void unignoreVersion()}
              onBackground={sendToBackground}
              onRetry={() => void retryFromMenu()}
              onOpenRelease={() => void openReleasePage()}
              onCopyLink={() => void copyDownloadLink()}
            />
          )}
          {view.primaryKind !== 'none' && (
            <Button
              variant="primary"
              data-role="update-primary"
              disabled={view.primaryDisabled || busy}
              loading={starting}
              onClick={onPrimary}
            >
              {view.primaryLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
