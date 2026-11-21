import { useCallback } from 'react';
import { clearLogs, describeError, logError, logInfo, logsText, logWarn } from '../log.ts';
import { pathForLog } from '../lib/log-redact.ts';
import { dayStampUtc } from '../lib/dates.ts';
import { fail } from '../lib/fail.ts';
import { restoreLatestBackupSnapshot } from '../lib/recovery.ts';
import { openDataDirectory, relaunchApplication } from '../storage-config.ts';
import { saveTextFile } from '../system-actions.ts';
import { toast } from '../components/ui/toaster.tsx';
import { appRecoveryCopy } from '../copy/app-recovery.ts';

export interface RecoveryActions {
  /** 回退警告条「重试」：原生侧重启会重新打开数据库；浏览器侧退回整页刷新 */
  retryStorage: () => Promise<void>;
  /** 「打开日志」：走现有导出入口（桌面端另存、其余端下载） */
  exportDiagnosticLogs: () => Promise<void>;
  /** 损坏页「从备份文件恢复」：用最近一份通过自检的快照排队恢复 */
  restoreFromBackup: () => Promise<void>;
  /** 损坏页「打开备份目录」 */
  openBackupDirectory: () => Promise<void>;
}

/**
 * 错误页与回退警告条上的恢复动作：重试打开存储、导出诊断日志、从备份恢复、打开备份目录。
 * 只处理「存储不可用」时的补救，不参与正常读写。
 */
export function useRecoveryActions(input: { fallback: boolean }): RecoveryActions {
  const { fallback } = input;

  /** 回退警告条「重试」：原生侧重启会重新打开数据库；浏览器侧退回整页刷新。 */
  const retryStorage = useCallback(async (): Promise<void> => {
    logInfo('storage', '重试打开原生存储', { fallback });
    if (await relaunchApplication()) return;
    try {
      globalThis.location.reload();
    } catch (cause: unknown) {
      logWarn('storage', '自动重启失败', { message: describeError(cause) });
      toast.error(fail(appRecoveryCopy.recovery.retryFailed.what, appRecoveryCopy.recovery.retryFailed.reason, appRecoveryCopy.recovery.retryFailed.next).text);
    }
  }, [fallback]);

  /** 「打开日志」：日志本身只进文件，不弹在界面上。 */
  const exportDiagnosticLogs = useCallback(async (): Promise<void> => {
    try {
      const entries = logsText();
      const name = `DawnTick-log-${dayStampUtc(Date.now())}.txt`;
      const saved = await saveTextFile(name, entries === '' ? appRecoveryCopy.recovery.emptyLog : entries, {
        extension: 'txt',
        filterName: appRecoveryCopy.recovery.logFileFilter,
      });
      if (saved.cancelled) return;
      if (!saved.ok) {
        toast.error(
          fail(appRecoveryCopy.recovery.logSaveFailed.what, saved.error ?? appRecoveryCopy.recovery.logSaveFailed.reason, appRecoveryCopy.recovery.logSaveFailed.next).text,
        );
        return;
      }
      logInfo('log', '诊断日志已导出', { path: pathForLog(saved.path), chars: entries.length });
      toast.success(saved.path === null ? appRecoveryCopy.recovery.logDownloaded : appRecoveryCopy.recovery.logExported);
      // 回退期间不写临时存储：导出已经完成，清空留到原生库恢复后
      if (!fallback) await clearLogs();
    } catch (cause: unknown) {
      logError('log', '日志导出失败', { message: describeError(cause) });
      toast.error(fail(appRecoveryCopy.recovery.logReadFailed.what, appRecoveryCopy.recovery.logReadFailed.reason, appRecoveryCopy.recovery.logReadFailed.next).text);
    }
  }, [fallback]);

  /** 损坏页「从备份文件恢复」：用最近一份通过自检的快照排队恢复，随后重启生效。 */
  const restoreFromBackup = useCallback(async (): Promise<void> => {
    const outcome = await restoreLatestBackupSnapshot();
    if (!outcome.ok) {
      toast.error(
        fail(appRecoveryCopy.recovery.restoreFailed.what, outcome.error ?? appRecoveryCopy.recovery.restoreFailed.reason, appRecoveryCopy.recovery.restoreFailed.next).text,
      );
      return;
    }
    toast.success(appRecoveryCopy.recovery.restoreQueued(outcome.name ?? null));
    if (!(await relaunchApplication())) {
      toast.info(appRecoveryCopy.recovery.restartToApply);
    }
  }, []);

  /** 损坏页「打开备份目录」：备份在数据目录的 backups 子目录里。 */
  const openBackupDirectory = useCallback(async (): Promise<void> => {
    const dir = await openDataDirectory();
    if (dir === null) {
      toast.error(
        fail(appRecoveryCopy.recovery.backupDirFailed.what, appRecoveryCopy.recovery.backupDirFailed.reason, appRecoveryCopy.recovery.backupDirFailed.next).text,
      );
      return;
    }
    logInfo('storage', '已打开数据目录', { dir: pathForLog(dir) });
    toast.info(appRecoveryCopy.recovery.dataDirOpened(dir));
  }, []);

  return { retryStorage, exportDiagnosticLogs, restoreFromBackup, openBackupDirectory };
}
