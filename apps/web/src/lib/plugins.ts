import { loadCapacitorPlugin } from './native.ts';

/**
 * Capacitor 插件契约：插件名、方法名、参数与返回字段的唯一 TS 定义。
 *
 * 边界：
 * - 只写契约与加载入口，不写业务逻辑；业务归一（如通知状态默认值）留在 `system-actions.ts`、
 *   `widget-pin.ts`、`import-window.ts`、`widget-snapshot.ts`；
 * - Android 侧实现分别位于 `apps/mobile/android/app/src/main/java/com/dawntick/app/`
 *   下的 `system/SystemActionsPlugin.java`、`widget/WidgetPinPlugin.kt`、
 *   `school/SchoolWindowPlugin.kt`、`widget/WidgetRefreshPlugin.kt`、
 *   `install/ApkInstallerPlugin.kt`、`share/FileSharePlugin.kt`；
 * - 两端对照表见 `apps/mobile/docs/plugins.contract.md`。改方法名或返回字段时三处一起改
 *   （本文件、Java/Kotlin 实现、契约文档），否则 JS 侧只会静默拿到 `undefined`；
 * - `apps/web/test/plugins.test.ts` 静态核对方法名与文档，Android 编译在打包机上另跑。
 */

/** 已注册的 Capacitor 插件名，与各自 `@CapacitorPlugin(name = …)` 逐字一致。 */
export const PLUGIN_NAMES = {
  systemActions: 'SystemActions',
  schoolWindow: 'SchoolWindow',
  widgetPin: 'DawnTickWidget',
  widgetRefresh: 'WidgetRefresh',
  apkInstaller: 'ApkInstaller',
  fileShare: 'FileShare',
} as const;

/** 插件名联合类型。 */
export type PluginName = (typeof PLUGIN_NAMES)[keyof typeof PLUGIN_NAMES];

/**
 * 每个插件对外暴露的方法清单。
 *
 * 接口是编译期契约，这里是运行期清单：`apps/web/test/plugins.test.ts` 用它逐项核对
 * Java/Kotlin 的 `@PluginMethod` 与契约文档，改名时测试会先失败，不必等 Android 运行时。
 * 新增方法时同步接口、本清单、Android 实现与契约文档。
 */
export const PLUGIN_METHODS = {
  [PLUGIN_NAMES.systemActions]: [
    'openExternal',
    'isIgnoringBatteryOptimizations',
    'requestIgnoreBatteryOptimizations',
    'notificationStatus',
    'openNotificationSettings',
  ],
  [PLUGIN_NAMES.schoolWindow]: ['open'],
  [PLUGIN_NAMES.widgetPin]: ['requestPin', 'readStates'],
  [PLUGIN_NAMES.widgetRefresh]: ['refresh'],
  [PLUGIN_NAMES.apkInstaller]: ['installApk'],
  [PLUGIN_NAMES.fileShare]: ['shareFile', 'revealFile'],
} as const satisfies Record<PluginName, readonly string[]>;

/** 安卓侧的原生系统动作插件（打开链接、电池优化白名单、通知状态）。 */
export interface SystemActionsPlugin {
  /** 用系统浏览器打开 http/https 链接；`opened` 为 true 表示已交给系统。 */
  openExternal(options: { url: string }): Promise<{ opened: boolean }>;
  /** 是否已在电池优化白名单里。 */
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  /** 跳系统页申请白名单：已发起跳转时 `requested` 为 true，本来就在白名单时 `ignoring` 为 true。 */
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring?: boolean; requested?: boolean }>;
  /**
   * 通知状态：应用级开关、运行时权限与通知渠道分开报。
   * `runtime` 取值 `granted` / `denied` / `prompt` / `permanently-denied`。
   */
  notificationStatus(options: { asked: boolean }): Promise<{
    appEnabled?: boolean;
    runtime?: string;
    asked?: boolean;
    channelId?: string | null;
    channelName?: string | null;
    channelMuted?: boolean;
  }>;
  /** 跳系统通知设置页；给了 `channelId` 就直达该渠道。 */
  openNotificationSettings(options: { channelId?: string }): Promise<{ opened: boolean }>;
}

/** 内嵌教务窗口插件：打开页面并带回页面内容。 */
export interface SchoolWindowPlugin {
  /** 打开 `url`；用户取消时 `payload` 为空串。 */
  open(options: { url: string }): Promise<{ payload?: string }>;
}

/** 主屏小组件插件：请求添加、读取每种尺寸的当前状态。 */
export interface WidgetPinPlugin {
  /**
   * 请求把某个小组件放到桌面。
   * `status` 取值 `added` / `already-added` / `cancelled` / `unsupported` / `disabled` / `rejected`。
   */
  requestPin(options: { provider: string }): Promise<{ status?: string; reason?: string }>;
  /** 读每种尺寸的状态；`enabled === false` 表示组件被系统或启动器停用。 */
  readStates(): Promise<{
    supported?: boolean;
    widgets?: { provider?: string; added?: boolean; enabled?: boolean }[];
  }>;
}

/** 小组件刷新插件：Web 层写完快照后请求系统立即重绘。 */
export interface WidgetRefreshPlugin {
  /** 触发所有已放置小组件重绘；无返回值。 */
  refresh(): Promise<void>;
}

/** 安卓 APK 安装器：把下载好的安装包交给系统安装器。 */
export interface ApkInstallerPlugin {
  /**
   * 唤起系统安装器。
   *
   * `path` 只接受应用缓存 / 外部私有下载目录内的绝对路径或 `file://` URI，且必须是 `.apk`；
   * 未授权「安装未知应用」时跳本应用设置页并返回 `opened: false`、`needsPermission: true`。
   */
  installApk(options: { path: string }): Promise<{ opened?: boolean; needsPermission?: boolean }>;
}

/** 安卓文件分享：分享导出文件，或打开它所在的系统文件目录。 */
export interface FileSharePlugin {
  /** `ACTION_SEND` + FileProvider 分享；`mimeType` 缺省按扩展名推断。 */
  shareFile(options: { path: string; mimeType?: string }): Promise<{ shared: boolean }>;
  /**
   * Android 没有「打开所在文件夹」：先开系统文件应用的所在目录，失败退 `content://` 目录，
   * 再失败回退分享面板；`via` 取值 `documents` / `content` / `share`。
   */
  revealFile(options: { path: string }): Promise<{ opened: boolean; via?: string }>;
}

/**
 * 加载 Capacitor 插件的唯一入口。
 *
 * - 非 Android 壳返回 `null`（调用方按「没有原生能力」回退）；
 * - 插件加载失败抛出原始错误，由调用方按自己的日志 scope 记录并回退。
 */
export async function loadPlugin<T>(name: PluginName): Promise<T | null> {
  return loadCapacitorPlugin<T>(name);
}
