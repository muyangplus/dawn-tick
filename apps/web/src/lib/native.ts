import { isAndroidApp, isDesktopApp } from './capabilities.ts';
import { errorMessage } from './errors.ts';

/**
 * 原生桥：前端调用 Tauri 命令与 Capacitor 插件的唯一出口。
 *
 * 边界：
 * - 只做「平台可用性 + invoke + 错误归一」，不持有状态，也不按命令包薄壳函数；
 * - 命令名来自 Rust 侧 `invoke_handler` 注册表（`apps/desktop/src-tauri/src/lib.rs`），
 *   拼错在 `pnpm typecheck` 阶段就会失败，不再等到运行时；
 * - 平台不可用时返回 `undefined`（调用方按「没有原生能力」处理），
 *   命令失败统一抛 `NativeError`，`message` 已是可直接展示/记录的一行文本。
 */

/**
 * `lib.rs` 的 `invoke_handler(tauri::generate_handler![...])` 列表，逐项对应。
 * 新增 Rust 命令时先加到这里，TS 侧才能调用。
 */
export const NATIVE_COMMANDS = [
  'log_event',
  'set_dev_console',
  'set_log_settings',
  'save_startup_prefs',
  'autostart_status',
  'set_autostart',
  'relaunch_elevated',
  'elevation_status',
  'database_url',
  'storage_info',
  'set_storage_path',
  'open_data_dir',
  'relaunch_app',
  'backup_target',
  'list_backups',
  'delete_backup',
  'prune_backups',
  'restore_backup',
  'recovery_notice',
  'open_import_window',
  'close_import_window',
  'submit_page_import',
  'show_widget',
  'hide_widget',
  'show_main',
  'tray_status',
  'open_external_url',
  'open_log_dir',
  'write_text_file',
  'write_binary_file',
] as const;

/** 已注册的 Tauri 命令名。 */
export type NativeCommand = (typeof NATIVE_COMMANDS)[number];

/** 把 `invoke` 的拒绝值（Rust `Err(String)` / JS Error / 其他）归一成一行文本。 */
export function nativeErrorMessage(cause: unknown): string {
  return errorMessage(cause, '原生调用失败');
}

/** 归一后的原生调用错误：保留命令名与原始拒绝值，`message` 可直接进日志或界面。 */
export class NativeError extends Error {
  readonly command: NativeCommand;
  override readonly cause: unknown;

  constructor(command: NativeCommand, cause: unknown) {
    super(nativeErrorMessage(cause));
    this.name = 'NativeError';
    this.command = command;
    this.cause = cause;
  }
}

/**
 * 调用 Tauri 命令。
 *
 * - 非桌面壳：返回 `undefined`，不尝试加载 `@tauri-apps/api`；
 * - 桌面壳但命令失败：抛 `NativeError`，调用方沿用原有 try/catch 记日志或回退。
 */
export async function invokeNative<T = void>(
  command: NativeCommand,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch (cause: unknown) {
    throw new NativeError(command, cause);
  }
}

/**
 * 加载 Capacitor 原生插件（`registerPlugin` 模板的唯一实现）。
 *
 * 业务模块不直接调用本函数，统一经 `lib/plugins.ts` 的 `loadPlugin()`：
 * 插件名与接口定义都在那里，Android 侧对照表见 `apps/mobile/docs/plugins.contract.md`。
 *
 * - 非 Android 壳：返回 `null`；
 * - Android 壳但插件加载失败：抛出原始错误，由调用方决定记日志还是回退。
 */
export async function loadCapacitorPlugin<T>(name: string): Promise<T | null> {
  if (!isAndroidApp()) return null;
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin<T>(name);
}
