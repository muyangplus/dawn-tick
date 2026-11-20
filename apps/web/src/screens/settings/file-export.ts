import { isAndroidApp } from '../../lib/capabilities.ts';
import { collectDiagnosticsLog } from '../../lib/diagnostics-log.ts';
import { copyText } from '../../system-actions.ts';
import { withTimeout } from '../../lib/timeout.ts';
import { PLUGIN_NAMES, loadPlugin, type SystemActionsPlugin } from '../../lib/plugins.ts';
import { dayStampUtc } from '../../lib/dates.ts';
import { revealExportedFile, savedFileActions, shareExportedFile } from '../../lib/export-files.ts';
import { clearLogs, logsText } from '../../log.ts';
import { openLogDirectory, revealPath, saveTextFile } from '../../system-actions.ts';
import { fail } from '../../copy/common.ts';
import { toast } from '../../components/ui/toaster.tsx';
import { transferCopy as copy } from '../../copy/backup-transfer.ts';

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
    toast.info(copy.saveCancelled);
    return { saved: false, path: null };
  }
  if (!result.ok) {
    toast.error(fail(copy.saveWhat, result.error, copy.saveNext));
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
      description: copy.savedTo(path),
      action: { label: copy.share, onClick: () => void shareSavedFile(path) },
      cancel: { label: copy.revealLocation, onClick: () => void revealSavedFile(path) },
    });
    return;
  }
  toast.success(message, {
    description: copy.savedTo(path),
    action: {
      label: copy.revealLocation,
      onClick: () => {
        void revealSavedPath(path);
      },
    },
  });
}

/** 「打开所在位置」失败时给可读提示；成功不再额外打扰。 */
async function revealSavedPath(path: string): Promise<void> {
  if (await revealPath(path)) return;
  toast.error(fail(copy.revealWhat, null, copy.revealNext));
}

/** Android「分享」失败时给可读提示；成功不再额外打扰。 */
async function shareSavedFile(path: string): Promise<void> {
  if (await shareExportedFile(path)) return;
  toast.error(fail(copy.shareWhat, null, copy.shareNext));
}

/** Android「打开所在位置」失败时给可读提示。 */
async function revealSavedFile(path: string): Promise<void> {
  if (await revealExportedFile(path)) return;
  toast.error(fail(copy.revealWhat, null, copy.revealNext));
}

/** 导出当前日志缓冲区：没有日志时也写出占位文案，成功后清空缓冲区。 */
/**
 * 安卓原生日志（插件/小组件/窗口/链接的失败细节）：原生侧写 `filesDir/diag/native.log`，
 * 导出诊断时追加到 Web 日志后面，用户发回一份文件就能同时拿到两侧信息。
 */
async function androidNativeLog(): Promise<string> {
  if (!isAndroidApp()) return '';
  try {
    const plugin = await loadPlugin<SystemActionsPlugin>(PLUGIN_NAMES.systemActions);
    // 原生调用可能卡住不回调：超时按「没有原生日志」处理，不能因此锁死导出按钮
    const result = await withTimeout(
      plugin?.readNativeLog?.({ maxBytes: 256 * 1024 }) ?? Promise.resolve(undefined),
      8_000,
      copy.nativeLogTimeout,
    );
    const text = typeof result?.text === 'string' ? result.text.trim() : '';
    return text === '' ? '' : `\n${copy.nativeLogHeader}\n${text}`;
  } catch {
    return '';
  }
}

export async function exportLogs(): Promise<void> {
  // 安卓上文件导出依赖 Filesystem/分享插件，部分机型会失败；改成复制到剪贴板，直接粘贴即可发送
  if (isAndroidApp()) {
    const collected = await collectDiagnosticsLog();
    const done = await copyText(collected.text === '' ? copy.noLogsPlaceholder : collected.text);
    if (done) {
      toastSaved(copy.logsCopied(collected.text === '' ? 0 : collected.text.split('\n').length), null);
      return;
    }
    toast.error(copy.logsCopyFailed);
    return;
  }
  const native = await androidNativeLog();
  const entries = logsText() + native;
  const name = `DawnTick-log-${dayStampUtc(Date.now())}.txt`;
  const result = await saveText(name, entries === '' ? copy.noLogs : entries, 'txt', copy.logFileFilter);
  if (!result.saved) return;
  toastSaved(copy.logsExported(entries === '' ? 0 : entries.split('\n').length), result.path);
  void clearLogs();
}

/** 桌面端：资源管理器定位日志目录 */
export async function showLogDirectory(): Promise<void> {
  const dir = await openLogDirectory();
  if (dir === null) {
    toast.error(fail(copy.logDirWhat, null, copy.logDirNext));
    return;
  }
  toast.info(copy.logDir(dir));
}
