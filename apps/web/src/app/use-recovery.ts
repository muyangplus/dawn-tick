import { useCallback } from 'react';
import { clearLogs, describeError, logError, logInfo, logWarn, logsText } from '../log.ts';
import { dayStampUtc } from '../lib/dates.ts';
import { fail } from '../lib/fail.ts';
import { restoreLatestBackupSnapshot } from '../lib/recovery.ts';
import { openDataDirectory, relaunchApplication } from '../storage-config.ts';
import { saveTextFile } from '../system-actions.ts';
import { toast } from '../components/ui/toaster.tsx';

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
    logInfo('storage', '用户请求重试打开原生存储', { fallback });
    if (await relaunchApplication()) return;
    try {
      globalThis.location.reload();
    } catch (cause: unknown) {
      logWarn('storage', '自动重启失败', { message: describeError(cause) });
      toast.error(fail('重试失败', '当前环境不能自动重启', '请手动关闭并重新打开应用。').text);
    }
  }, [fallback]);

  /** 「打开日志」：日志本身只进文件，不弹在界面上。 */
  const exportDiagnosticLogs = useCallback(async (): Promise<void> => {
    try {
      const entries = logsText();
      const name = `DawnTick-log-${dayStampUtc(Date.now())}.txt`;
      const saved = await saveTextFile(name, entries === '' ? '暂无日志' : entries, {
        extension: 'txt',
        filterName: '日志文件',
      });
      if (saved.cancelled) return;
      if (!saved.ok) {
        toast.error(
          fail('打开日志失败', saved.error ?? '日志没能写出', '请稍后重试；仍失败请在「设备与同步」里打开日志目录。').text,
        );
        return;
      }
      logInfo('log', '已导出诊断日志', { path: saved.path, bytes: entries.length });
      toast.success(saved.path === null ? '已下载日志' : '已导出日志');
      // 回退期间不写临时存储：导出已经完成，清空留到原生库恢复后
      if (!fallback) await clearLogs();
    } catch (cause: unknown) {
      logError('log', '打开日志失败', { message: describeError(cause) });
      toast.error(fail('打开日志失败', '日志暂时读不出来', '请稍后重试；仍失败请在「设备与同步」里查看。').text);
    }
  }, [fallback]);

  /** 损坏页「从备份文件恢复」：用最近一份通过自检的快照排队恢复，随后重启生效。 */
  const restoreFromBackup = useCallback(async (): Promise<void> => {
    const outcome = await restoreLatestBackupSnapshot();
    if (!outcome.ok) {
      toast.error(
        fail('恢复失败', outcome.error ?? '没有读到可用备份', '请打开备份目录手动处理，或重启应用后再试。').text,
      );
      return;
    }
    toast.success(`已排队恢复 ${outcome.name ?? '最近的快照'}，正在重启…`);
    if (!(await relaunchApplication())) {
      toast.info('请手动关闭并重新打开应用，恢复才会生效');
    }
  }, []);

  /** 损坏页「打开备份目录」：备份在数据目录的 backups 子目录里。 */
  const openBackupDirectory = useCallback(async (): Promise<void> => {
    const dir = await openDataDirectory();
    if (dir === null) {
      toast.error(
        fail('打开备份目录失败', '当前平台不支持打开数据目录', '请在「设备与同步」里导出或导入备份。').text,
      );
      return;
    }
    logInfo('storage', '打开数据目录', { dir });
    toast.info(`已打开数据目录；备份在其中 backups 子目录：${dir}`);
  }, []);

  return { retryStorage, exportDiagnosticLogs, restoreFromBackup, openBackupDirectory };
}
