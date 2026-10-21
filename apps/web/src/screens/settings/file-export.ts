import { dayStampUtc } from '../../lib/dates.ts';
import { revealExportedFile, savedFileActions, shareExportedFile } from '../../lib/export-files.ts';
import { clearLogs, logsText } from '../../log.ts';
import { openLogDirectory, revealPath, saveTextFile } from '../../system-actions.ts';
import { fail } from '../../copy/zh.ts';
import { toast } from '../../components/ui/toaster.tsx';

/** 保存结果：桌面端带实际路径，浏览器下载没有本地路径。 */
export interface SavedTextResult {
  saved: boolean;
  /** 实际写入的路径；取消、失败或浏览器下载时为 null */
  path: string | null;
}

/** 桌面端走系统保存对话框，其余端下载；取消与失败在这里提示，成功提示交给调用方。 */
export async function saveText(
  name: string,
  content: string,
  extension: string,
  filterName: string,
  mime?: string,
): Promise<SavedTextResult> {
  const result = await saveTextFile(
    name,
    content,
    mime === undefined ? { extension, filterName } : { extension, filterName, mime },
  );
  if (result.cancelled) {
    toast.info('已取消保存');
    return { saved: false, path: null };
  }
  if (!result.ok) {
    toast.error(fail('保存', result.error, '请换一个位置后重试'));
    return { saved: false, path: null };
  }
  return { saved: true, path: result.path };
}

/**
 * 保存成功提示（I-12）：桌面端给出实际路径，并附「打开所在位置」按钮（调 `reveal_path`）；
 * Android 的路径在应用缓存里，给出「分享」与「打开所在位置」（走 FileShare 插件）；
 * 浏览器下载没有本地路径，只提示结果，按钮不出现。
 */
export function toastSaved(message: string, path: string | null): void {
  if (path === null) {
    toast.success(message);
    return;
  }
  const actions = savedFileActions();
  if (actions === 'android') {
    toast.success(message, {
      description: `已保存到 ${path}`,
      action: { label: '分享', onClick: () => void shareSavedFile(path) },
      cancel: { label: '打开所在位置', onClick: () => void revealSavedFile(path) },
    });
    return;
  }
  toast.success(message, {
    description: `已保存到 ${path}`,
    action: {
      label: '打开所在位置',
      onClick: () => {
        void revealSavedPath(path);
      },
    },
  });
}

/** 「打开所在位置」失败时给可读提示；成功不再额外打扰。 */
async function revealSavedPath(path: string): Promise<void> {
  if (await revealPath(path)) return;
  toast.error(fail('打开所在位置', null, '请稍后重试，或手动到文件管理器里打开'));
}

/** Android「分享」失败时给可读提示；成功不再额外打扰。 */
async function shareSavedFile(path: string): Promise<void> {
  if (await shareExportedFile(path)) return;
  toast.error(fail('分享文件', null, '请稍后重试，或到文件管理器里发送'));
}

/** Android「打开所在位置」失败时给可读提示。 */
async function revealSavedFile(path: string): Promise<void> {
  if (await revealExportedFile(path)) return;
  toast.error(fail('打开所在位置', null, '请稍后重试，或手动到文件管理器里打开'));
}

/** 导出当前日志缓冲区：没有日志时也写出占位文案，成功后清空缓冲区。 */
export async function exportLogs(): Promise<void> {
  const entries = logsText();
  const name = `DawnTick-log-${dayStampUtc(Date.now())}.txt`;
  const result = await saveText(name, entries === '' ? '暂无日志' : entries, 'txt', '日志文件');
  if (!result.saved) return;
  toastSaved(`已导出日志 ${entries === '' ? 0 : entries.split('\n').length} 行`, result.path);
  void clearLogs();
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
