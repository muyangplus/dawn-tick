import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import {
  DATABASE_CORRUPT_MESSAGE,
  subscribeCorrupt,
  type CorruptEvent,
} from '../db/corrupt-guard.ts';
import { recoverDatabase } from '../db/recover.ts';
import { logInfo, logWarn } from '../log.ts';
import { openDataDirectory, relaunchApplication } from '../storage-config.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';
import { toast } from './ui/toaster.tsx';

/**
 * 运行中数据库损坏的恢复对话框。
 *
 * 由 `corrupt-guard` 的首次损坏事件触发（同一会话只弹一次）：
 * - 「立即恢复并重启」：调 Rust `recover_database`，成功后再 `relaunch_app`；
 *   失败时把可读原因留在对话框里，不覆盖成原始 sqlx 文案；
 * - 「打开数据目录」：数据目录里的 `backups/` 就是快照位置；
 * - 「稍后」：关闭对话框，但写入仍被守卫锁死，操作时会提示只读。
 *
 * 组件自己订阅事件，因此挂在启动页/引导页/主壳都能弹；不依赖会话是否已就绪。
 */
export function DatabaseCorruptDialog() {
  const [event, setEvent] = useState<CorruptEvent | null>(null);
  /** 用户点了「稍后」：不自动重弹，写入仍被锁死 */
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    return subscribeCorrupt((next) => {
      setEvent(next);
      setDismissed(false);
      setFailure(null);
    });
  }, []);

  async function recoverAndRestart(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await recoverDatabase();
      if (!outcome.recovered) {
        setFailure(outcome.reason ?? '恢复没有完成，请打开数据目录手动处理');
        return;
      }
      setDismissed(true);
      toast.success(`已用快照 ${outcome.snapshot ?? '最近快照'} 恢复，正在重启…`);
      if (!(await relaunchApplication())) {
        toast.info('请手动关闭并重新打开应用，恢复才会生效');
      }
    } finally {
      setBusy(false);
    }
  }

  async function openDataDir(): Promise<void> {
    const dir = await openDataDirectory();
    if (dir === null) {
      logWarn('storage', '损坏对话框打开数据目录失败');
      toast.error('当前平台不支持打开数据目录；请手动定位程序旁的 data 目录');
      return;
    }
    logInfo('storage', '损坏对话框打开数据目录', { dir });
    toast.info(`已打开数据目录；备份在其中的 backups 子目录：${dir}`);
  }

  return (
    <Dialog
      open={event !== null && !dismissed}
      onOpenChange={(open) => {
        if (!open) setDismissed(true);
      }}
    >
      <DialogContent
        title="数据库文件损坏"
        description="已停止写入，避免损坏扩大；数据目录里的备份快照仍然可用"
        data-role="corrupt-dialog"
      >
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger-strong">
          <Database className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1" data-role="corrupt-dialog-message">
            {DATABASE_CORRUPT_MESSAGE}
          </p>
        </div>
        {event !== null && (
          <p className="break-all text-[11px] text-muted" data-role="corrupt-dialog-detail">
            原始错误：{event.message}
          </p>
        )}
        {failure !== null && (
          <p role="alert" className="text-xs text-danger-strong" data-role="corrupt-dialog-failure">
            恢复失败：{failure}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setDismissed(true)}>
            稍后
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void openDataDir()}>
            打开数据目录
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void recoverAndRestart()}>
            立即恢复并重启
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
