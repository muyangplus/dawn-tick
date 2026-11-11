/**
 * 诊断日志的统一出口：Web 日志 + 安卓原生日志。
 *
 * 为什么单独成模块：安卓上「导出文件」依赖 Filesystem/分享插件，部分机型会失败或卡住；
 * 弹窗查看/复制是更可靠的一手路径。导出与查看都从这里取同一份文本，避免两套逻辑。
 *
 * 边界：
 * - 原生日志读取带 8 秒超时（插件不回调时不能让界面锁死）；
 * - 只读，不清日志；清空由调用方显式调用 `clearDiagnosticsLog`；
 * - 失败信息只出现在返回值里，不抛异常（查看/导出都要能显示已有内容）。
 */

import { isAndroidApp } from './capabilities.ts';
import { loadPlugin, PLUGIN_NAMES, type SystemActionsPlugin } from './plugins.ts';
import { withTimeout } from './timeout.ts';
import { clearLogs, logWarn, logsText } from '../log.ts';

export interface DiagnosticsLog {
  /** 合并后的完整文本（原生日志跟在 Web 日志后面） */
  text: string;
  /** 原生日志文件路径；非安卓或读取失败时为 null */
  nativePath: string | null;
  /** 原生日志读取失败原因（Web 日志仍然可用） */
  nativeError: string | null;
  /** 读取时间（毫秒时间戳），弹窗里显示「刚刚更新」 */
  readAt: number;
}

/** 只读 Web 端内存日志：同步、必然有结果，用于弹窗首屏立即显示。 */
export function webOnlyLog(): DiagnosticsLog {
  const text = logsText().trim();
  return { text, nativePath: null, nativeError: null, readAt: Date.now() };
}

/**
 * 读安卓原生日志：整个流程（含插件加载）8 秒超时。
 *
 * 只包插件方法不够：`loadPlugin` 本身在个别机型/桥上也可能不回调，
 * 那会让弹窗永久停在「正在读取」——用户真机反馈的「打开日志一直转圈」。
 */
async function androidNativeLog(): Promise<{ text: string; path: string | null; error: string | null }> {
  if (!isAndroidApp()) return { text: '', path: null, error: null };
  try {
    const task = (async () => {
      const plugin = await loadPlugin<SystemActionsPlugin>(PLUGIN_NAMES.systemActions);
      const result = await (plugin?.readNativeLog?.({ maxBytes: 256 * 1024 }) ?? Promise.resolve(undefined));
      return {
        text: typeof result?.text === 'string' ? result.text.trim() : '',
        path: typeof result?.path === 'string' ? result.path : null,
        error: null as string | null,
      };
    })();
    return await withTimeout(task, 8_000, '读取原生日志超时（可能存储/原生桥异常）');
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logWarn('log', '读取原生日志失败', { message });
    return { text: '', path: null, error: message };
  }
}

/** 收集当前诊断日志（Web + 原生）。 */
export async function collectDiagnosticsLog(): Promise<DiagnosticsLog> {
  const native = await androidNativeLog();
  const parts = [logsText().trim()];
  if (native.text !== '') parts.push(`===== 安卓原生日志 =====\n${native.text}`);
  return {
    text: parts.filter((part) => part !== '').join('\n\n'),
    nativePath: native.path,
    nativeError: native.error,
    readAt: Date.now(),
  };
}

/** 清空 Web 日志与原生日志；返回每一步是否成功。 */
export async function clearDiagnosticsLog(): Promise<{ web: true; native: boolean; error: string | null }> {
  clearLogs();
  if (!isAndroidApp()) return { web: true, native: true, error: null };
  try {
    const plugin = await loadPlugin<SystemActionsPlugin>(PLUGIN_NAMES.systemActions);
    await withTimeout(
      plugin?.clearNativeLog?.() ?? Promise.resolve(undefined),
      8_000,
      '清空原生日志超时',
    );
    return { web: true, native: true, error: null };
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { web: true, native: false, error: message };
  }
}
