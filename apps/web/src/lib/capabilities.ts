import { detectPlatform, type Platform } from '../platform-detect.ts';

/**
 * 平台能力查询：界面与业务模块只问「能不能」，不直接判断 `tauri` / `capacitor` / `web`。
 *
 * 边界：
 * - 探测仍只发生在 `platform-detect.ts`（本模块是唯一读取它的地方）；
 * - 只做布尔查询，不持有状态、不发命令、不加载插件；
 * - 视图层（`screens/`、`components/`）用它代替 Tauri invoke 的动态导入。
 */

function currentPlatform(): Platform {
  return detectPlatform();
}

/** 桌面壳（Tauri / Windows）：原生窗口、托盘、文件对话框、文件快照、提权。 */
export function isDesktopApp(): boolean {
  return currentPlatform() === 'tauri';
}

/** Android 壳（Capacitor）：主屏小组件、系统通知、教务内嵌窗口。 */
export function isAndroidApp(): boolean {
  return currentPlatform() === 'capacitor';
}

/** 纯浏览器（Web / PWA）：IndexedDB、Notification API。 */
export function isWebApp(): boolean {
  return currentPlatform() === 'web';
}

/** 是否允许修改存储位置：只有 Windows 端能改，其它端用沙箱固定位置。 */
export function canConfigureStorage(): boolean {
  return isDesktopApp();
}

/** 是否有内嵌教务窗口：桌面为独立 Tauri 窗口，安卓为 Capacitor 插件。 */
export function canOpenImportWindow(): boolean {
  return isDesktopApp() || isAndroidApp();
}

/** 是否用桌面悬浮窗（Windows）；Web 与安卓没有。 */
export function canUseWidget(): boolean {
  return isDesktopApp();
}

/** 是否有主屏小组件（仅 Android 应用内）。 */
export function hasMobileWidgets(): boolean {
  return isAndroidApp();
}

/** 是否支持开机自启（注册表 / 启动项，仅桌面端）。 */
export function isAutoStartSupported(): boolean {
  return isDesktopApp();
}

/** 快照是否落在原生文件系统（桌面端 VACUUM INTO），否则存 app_meta JSON。 */
export function usesNativeSnapshots(): boolean {
  return isDesktopApp();
}

/** 是否把日志同步给原生层（写 dawn-tick.log）。 */
export function supportsNativeLog(): boolean {
  return isDesktopApp();
}

/** 是否走原生 HTTP（绕过 WebView 的 CORS / 证书限制）。 */
export function supportsNativeHttp(): boolean {
  return isDesktopApp();
}

/** 应用关闭后仍能送达的提醒：仅 Android 的原生通知调度。 */
export function supportsBackgroundReminders(): boolean {
  return isAndroidApp();
}
