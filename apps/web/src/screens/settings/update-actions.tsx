import { useEffect, useRef, useState } from 'react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { logInfo, logWarn } from '../../log.ts';
import { fail } from '../../copy/zh.ts';
import { errorMessage } from '../../lib/errors.ts';
import {
  INITIAL_UPDATE_STATE,
  formatDownloadProgress,
  isUpdateBusy,
  planUpdateDownload,
  runUpdateDownload,
  type UpdateDownloadState,
} from '../../lib/update-download.ts';
import { createUpdateHost, updatePlatform } from '../../lib/update-install.ts';
import { canRollbackToStable, loadRollbackReleases, pickRollbackTarget } from '../../lib/update-preferences.ts';
import { resolveReceiveBeta } from '../../update.ts';
import { useIgnoredUpdateVersion, unignoreUpdateVersion } from '../../components/update-prompt.ts';
import { Button } from '../../components/ui/button.tsx';
import { ExternalLink } from '../../components/ui/external-link.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import type { UpdateCheckApi } from './use-update-check.ts';

export interface UpdateActionsProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  /** 版本检查与设备页顶部快捷动作共用一份状态 */
  update: UpdateCheckApi;
}

/**
 * 更新与维护卡的「更新」区：检查更新、发布页、测试版/自动检查开关、
 * 已忽略版本与「回滚到正式版」。
 *
 * 只做展示与触发：是否自动提示、要不要回滚、回滚目标是谁都由 `lib/update-preferences.ts`
 * 的纯函数决定；下载/校验/安装沿用 `update-download` 的状态机，不在这里重写。
 */
export function UpdateActions({ storage, settings, onPatch, update }: UpdateActionsProps) {
  const ignoredVersion = useIgnoredUpdateVersion();
  /** 打开「接收测试版更新」前的警告：测试版可能不稳定，确认后才写设置 */
  const [betaWarningOpen, setBetaWarningOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [download, setDownload] = useState<UpdateDownloadState>(INITIAL_UPDATE_STATE);
  const [preparing, setPreparing] = useState(false);
  /** 进行中的回滚下载：关弹窗或换目标时中止 */
  const running = useRef<AbortController | null>(null);
  /** 关闭对话框就作废这一次回滚：避免关了弹窗还在后台继续下载/安装 */
  const generation = useRef(0);
  const platform = updatePlatform();
  const current = appVersion();
  const busy = isUpdateBusy(download.phase);
  /** 回滚复用安装链路：Web 只能刷新页面，不提供回滚入口 */
  const rollbackVisible =
    platform !== 'web' &&
    canRollbackToStable({ current, channel: CHANNEL, latestStable: update.latestStable });

  // 卸载时中止：回滚下载不该在卡片销毁后继续占用网络
  useEffect(() => {
    return () => {
      running.current?.abort();
    };
  }, []);

  function openRollback(): void {
    setRollbackError(null);
    setDownload(INITIAL_UPDATE_STATE);
    setRollbackOpen(true);
  }

  function closeRollback(): void {
    generation.current += 1;
    running.current?.abort();
    running.current = null;
    setRollbackOpen(false);
  }

  /**
   * 回滚：取发布列表 → 纯函数挑最新正式版 → 走 `runUpdateDownload` 下载校验安装。
   * 失败原因分两层：挑不到目标时写进对话框；下载/校验失败由状态机给出可读原因。
   */
  async function startRollback(): Promise<void> {
    if (preparing || busy) return;
    setPreparing(true);
    setRollbackError(null);
    setDownload(INITIAL_UPDATE_STATE);
    const token = generation.current;
    try {
      const target = pickRollbackTarget(await loadRollbackReleases(), platform);
      if (generation.current !== token) return;
      if (target.kind === 'none') throw new Error(target.reason);
      const plan = planUpdateDownload(target.manifest, platform);
      if (plan.kind !== 'download') throw new Error('最新正式版没有可用于自动安装的安装包，请到发布页下载');
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
      if (running.current === controller) running.current = null;
      if (generation.current !== token) return;
      setDownload(final);
      if (final.phase === 'done') {
        toast.success(`已开始安装正式版 ${target.version}，请按提示完成安装`);
        logInfo('update', '回滚到正式版', { from: current, target: target.version, platform });
        setRollbackOpen(false);
        return;
      }
      if (final.phase === 'failed') {
        logWarn('update', '回滚到正式版失败', {
          target: target.version,
          error: final.error,
          needsPermission: final.needsPermission,
        });
      }
      // cancel：用户中止下载，状态行已提示，不当作失败
    } catch (cause: unknown) {
      if (generation.current !== token) return;
      const reason = errorMessage(cause);
      setRollbackError(fail('回滚到正式版', reason, '请稍后再试，或到发布页手动下载'));
      logWarn('update', '回滚到正式版失败', { reason });
    } finally {
      running.current = null;
      setPreparing(false);
    }
  }

  async function unignore(): Promise<void> {
    try {
      await unignoreUpdateVersion(storage);
      toast.success('已取消忽略，下次检查会再提示');
    } catch (cause: unknown) {
      toast.error(fail('取消忽略', errorMessage(cause), '请稍后再试'));
    }
  }

  const rollbackStatus =
    download.phase === 'failed'
      ? fail('回滚到正式版', download.error, '请稍后再试')
      : download.phase === 'downloading'
        ? formatDownloadProgress(download)
        : (download.message ?? '');
  const rollbackLabel = busy ? '取消下载' : download.phase === 'failed' ? '重试' : '开始回滚';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="检查更新"
          loading={update.busy}
          onClick={() => void update.run()}
        >
          检查更新
        </Button>
        <ExternalLink
          dataRole="release-page-link"
          className="text-xs text-primary-strong underline"
          href="https://github.com/muyangplus/dawn-tick/releases"
          ariaLabel="打开发布页（GitHub）"
        >
          打开发布页
        </ExternalLink>
        {update.result !== null && (
          <StatusLine dataRole="update-result" at={update.result.at}>
            {update.result.text}
          </StatusLine>
        )}
      </div>
      {CHANNEL !== 'dev' ? (
        <SwitchField
          label="接收测试版更新"
          description={CHANNEL === 'beta' ? '默认开启；关闭后只收正式版' : '默认关闭；开启后还会收到测试版'}
          checked={resolveReceiveBeta(settings.receiveBeta, CHANNEL)}
          onCheckedChange={(checked) => {
            if (checked && !resolveReceiveBeta(settings.receiveBeta, CHANNEL)) {
              setBetaWarningOpen(true);
              return;
            }
            void onPatch({ receiveBeta: checked });
          }}
          ariaLabel="接收测试版更新"
        />
      ) : (
        <span className="text-xs text-muted">开发版只接收开发构建，不受此开关影响</span>
      )}
      <SwitchField
        label="自动检查版本更新"
        description="启动后自动查一次，有新版本时弹出更新信息；关闭后仍可用上面的「检查更新」手动查"
        checked={settings.autoCheckUpdate}
        onCheckedChange={(checked) => void onPatch({ autoCheckUpdate: checked })}
        ariaLabel="自动检查版本更新"
      />
      {ignoredVersion !== null && (
        <div className="flex flex-wrap items-center gap-2" data-role="ignored-version">
          <span className="text-xs text-muted">已忽略的版本：{ignoredVersion}</span>
          <Button
            size="sm"
            variant="secondary"
            aria-label="取消忽略版本"
            data-role="unignore-version"
            onClick={() => void unignore()}
          >
            取消忽略
          </Button>
        </div>
      )}
      {rollbackVisible && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="回滚到正式版"
            data-role="rollback-stable"
            onClick={openRollback}
          >
            回滚到正式版
          </Button>
          <span className="text-xs text-muted">当前 {CHANNEL_LABEL[CHANNEL]}；回到最新正式版</span>
        </div>
      )}
      <Dialog open={betaWarningOpen} onOpenChange={setBetaWarningOpen}>
        <DialogContent
          title="开启测试版更新？"
          description="测试版会先于正式版收到改动，可能包含未完成或不稳定的功能；出问题时可在「应用诊断日志」里导出日志反馈。"
          data-role="beta-warning-dialog"
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBetaWarningOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setBetaWarningOpen(false);
                void onPatch({ receiveBeta: true });
              }}
            >
              仍要开启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={rollbackOpen}
        onOpenChange={(open) => {
          if (!open) closeRollback();
        }}
      >
        <DialogContent
          data-role="rollback-dialog"
          title="回滚到正式版？"
          description={`将下载并安装最新的正式版（当前 ${current} · ${CHANNEL_LABEL[CHANNEL]}）。本机数据（课表、待办、提醒、设置与快照）都会保留；安装完成后应用回到正式版，不再接收测试版/开发版构建。`}
        >
          {rollbackError !== null && (
            <p className="text-xs text-danger-strong" data-role="rollback-error">
              {rollbackError}
            </p>
          )}
          {busy && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" data-role="rollback-progress">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round((download.progress ?? 0) * 100)}%` }}
              />
            </div>
          )}
          {rollbackStatus !== '' && (
            <p className="text-xs text-muted" data-role="rollback-status">
              {rollbackStatus}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={closeRollback} disabled={busy}>
              稍后
            </Button>
            <Button
              variant="primary"
              data-role="rollback-start"
              loading={preparing}
              onClick={() => void (busy ? closeRollback() : startRollback())}
            >
              {rollbackLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
