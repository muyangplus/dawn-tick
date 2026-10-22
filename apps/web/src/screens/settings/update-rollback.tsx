import { useEffect, useRef, useState } from 'react';
import { CHANNEL, CHANNEL_LABEL } from '../../channel.ts';
import { fail } from '../../copy/zh.ts';
import { logInfo, logWarn } from '../../log.ts';
import { errorMessage } from '../../lib/errors.ts';
import {
  INITIAL_UPDATE_STATE,
  isUpdateBusy,
  planUpdateDownload,
  runUpdateDownload,
  type UpdateDownloadState,
  type UpdatePlatform,
} from '../../lib/update-download.ts';
import { createUpdateHost } from '../../lib/update-install.ts';
import { loadRollbackReleases, pickRollbackTarget } from '../../lib/update-preferences.ts';
import { UpdateProgress } from '../../components/update/update-progress.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { toast } from '../../components/ui/toaster.tsx';

export interface RollbackDialogProps {
  open: boolean;
  onClose: () => void;
  platform: UpdatePlatform;
  /** 本机当前版本：标题与说明里展示 */
  current: string;
}

/**
 * 回滚到正式版：取发布列表 → 纯函数挑最新正式版 → 走 `runUpdateDownload` 下载校验安装。
 * 回滚是一次性动作，关掉对话框就作废（取消下载），与后台更新任务不同。
 */
export function RollbackDialog({ open, onClose, platform, current }: RollbackDialogProps) {
  const [download, setDownload] = useState<UpdateDownloadState>(INITIAL_UPDATE_STATE);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 进行中的回滚下载：关弹窗或换目标时中止 */
  const running = useRef<AbortController | null>(null);
  /** 关闭对话框就作废这一次回滚：避免关了弹窗还在后台继续下载/安装 */
  const generation = useRef(0);

  // 卸载时中止：回滚下载不该在卡片销毁后继续占用网络
  useEffect(() => {
    return () => {
      running.current?.abort();
    };
  }, []);

  function close(): void {
    generation.current += 1;
    running.current?.abort();
    running.current = null;
    onClose();
  }

  function reset(): void {
    setError(null);
    setDownload(INITIAL_UPDATE_STATE);
  }

  async function start(): Promise<void> {
    if (preparing || isUpdateBusy(download.phase)) return;
    setPreparing(true);
    reset();
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
        onClose();
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
      setError(fail('回滚到正式版', reason, '请稍后再试，或到发布页手动下载'));
      logWarn('update', '回滚到正式版失败', { reason });
    } finally {
      running.current = null;
      setPreparing(false);
    }
  }

  const busy = isUpdateBusy(download.phase);
  const progress =
    download.phase === 'downloading' && download.total !== null
      ? {
          received: download.received,
          total: download.total,
          percent: download.progress,
          speedBytesPerSec: null,
          etaSeconds: null,
        }
      : null;
  const status =
    download.phase === 'failed'
      ? fail('回滚到正式版', download.error, '请稍后再试')
      : (download.message ?? '');
  const label = busy ? '取消下载' : download.phase === 'failed' ? '重试' : '开始回滚';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        data-role="rollback-dialog"
        title="回滚到正式版？"
        description={`将下载并安装最新的正式版（当前 ${current} · ${CHANNEL_LABEL[CHANNEL]}）。本机数据（课表、待办、提醒、设置与快照）都会保留；安装完成后应用回到正式版，不再接收测试版/开发版构建。`}
      >
        {error !== null && (
          <p className="text-xs text-danger-strong" data-role="rollback-error">
            {error}
          </p>
        )}
        {progress !== null && <UpdateProgress dataRole="rollback-progress" progress={progress} />}
        {status !== '' && (
          <p className="text-xs text-muted" data-role="rollback-status">
            {status}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            稍后
          </Button>
          <Button
            variant="primary"
            data-role="rollback-start"
            loading={preparing}
            onClick={() => void (busy ? close() : start())}
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
