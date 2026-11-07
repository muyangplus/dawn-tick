import { supportsNativeHttp } from './capabilities.ts';

/**
 * 更新链路的 HTTP 出口：取源、探测与下载必须走同一个 fetch。
 *
 * 为什么不能直接用 WebView 的 fetch：
 * - Gitee 的 raw 地址不带 CORS 响应头，WebView 里会被浏览器拦掉；
 * - 桌面端 Tauri 自带 `plugin-http`，由 Rust 侧发请求，不受 CORS / 证书限制；
 * - Android 的 CapacitorHttp 已在 `capacitor.config.ts` 里全局接管 `fetch`，用全局即可；
 * - 纯浏览器没有原生出口，仍用全局（此时受 CORS 约束，属于平台限制）。
 */

/** 桌面原生 HTTP：绕过 WebView 的 CORS，支持流式进度与取消（与 webdav 同口径）。 */
export function desktopHttpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return import('@tauri-apps/plugin-http').then(({ fetch: nativeFetch }) => nativeFetch(input, init));
}

/** 更新链路该用的 fetch：桌面取原生出口，其余平台用全局（Android 已由 CapacitorHttp 接管）。 */
export function updateFetch(): typeof fetch {
  return supportsNativeHttp() ? (desktopHttpFetch as typeof fetch) : globalThis.fetch;
}
