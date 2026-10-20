import { dayStampUtc } from '../../lib/dates.ts';
import { clearLogs, logsText } from '../../log.ts';
import { openLogDirectory, saveTextFile } from '../../system-actions.ts';
import { fail } from '../../copy/zh.ts';
import { toast } from '../../components/ui/toaster.tsx';

/** 桌面端走系统保存对话框，其余端下载；结果由调用方 toast。 */
export async function saveText(
  name: string,
  content: string,
  extension: string,
  filterName: string,
): Promise<boolean> {
  const result = await saveTextFile(name, content, { extension, filterName });
  if (result.cancelled) {
    toast.info('已取消保存');
    return false;
  }
  if (!result.ok) {
    toast.error(fail('保存', result.error, '请换一个位置后重试'));
    return false;
  }
  return true;
}

/** 导出当前日志缓冲区：没有日志时也写出占位文案，成功后清空缓冲区。 */
export async function exportLogs(): Promise<void> {
  const entries = logsText();
  const name = `DawnTick-log-${dayStampUtc(Date.now())}.txt`;
  const saved = await saveText(name, entries === '' ? '暂无日志' : entries, 'txt', '日志文件');
  if (saved) {
    toast.success(`已导出日志 ${entries === '' ? 0 : entries.split('\n').length} 行`);
    void clearLogs();
  }
}

/** 桌面端：资源管理器定位日志目录 */
export async function showLogDirectory(): Promise<void> {
  const dir = await openLogDirectory();
  if (dir === null) {
    toast.error(fail('打开日志目录', null, '请到「设置 → 同步与数据」查看数据目录'));
    return;
  }
  toast.info(`日志目录：${dir}`);
}
