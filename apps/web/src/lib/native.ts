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
  'recover_database',
  'open_import_window',
  'close_import_window',
  'submit_page_import',
  'show_widget',
  'hide_widget',
  'show_main',
  'widget_measure',
  'widget_resize',
  'reveal_path',
  'run_installer',
  'windows_install_kind',
  'prepare_portable_update',
  'exit_for_update',
  'tray_status',
  'open_external_url',
  'open_log_dir',
  'write_text_file',
  'write_binary_file',
  'lan_sync_start',
  'lan_sync_stop',
  'lan_sync_poll',
  'lan_sync_respond',
  'lan_discovery_scan',
  'lan_network_list',
  'lan_http_request',
  'set_pending_reminders',
  'clear_pending_reminder',
  'secret_encrypt',
  'secret_decrypt',
] as const;

/** 已注册的 Tauri 命令名。 */
export type NativeCommand = (typeof NATIVE_COMMANDS)[number];

/**
 * Windows 托盘提醒动作事件名，与 Rust `reminder_actions::REMINDER_EVENT` 逐字一致。
 * 事件负载：`{ id: string, action: 'snooze' | 'done' | 'mute' }`。
 */
export const REMINDER_ACTION_EVENT = 'reminder-action';

/** 悬浮窗尺寸来源：默认 / 记住的 / 按内容 / 手动拉伸。 */
export type WidgetSizeSource = 'default' | 'remembered' | 'content' | 'manual';

/**
 * `widget_measure` / `widget_resize` 的返回：一次尺寸计算的结果。
 *
 * 与 Rust `widget_window::WidgetLayout` 的 camelCase 序列化逐字对应：
 * `width` / `height` 是**实际应用**的尺寸（已夹取并取整，逻辑像素），
 * `requested*` 是夹取前请求的值，`remembered` 是没有记忆时的 null。
 */
export interface WidgetLayout {
  variant: string;
  width: number;
  height: number;
  requestedWidth: number;
  requestedHeight: number;
  source: WidgetSizeSource;
  clamped: boolean;
  maxHeight: number;
  remembered: { width: number; height: number } | null;
}

/** 局域网同步的监听地址：端口由系统分配，TS 再拼配对码与有效期。 */
export interface LanSyncListen {
  host: string;
  port: number;
}

/**
 * `lan_sync_poll` 取到的一条待处理请求。
 *
 * 与 Rust `lan_sync::LanSyncRequest`、Android `LanSyncServer.LanRequest` 字段一致：
 * `id` 回应时原样带回，`authorization` 未带时为 null（TS 侧据此判 401）。
 */
export interface LanSyncRequest {
  id: number;
  method: string;
  path: string;
  query: string;
  authorization: string | null;
  body: string;
  receivedAt: number;
}

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
