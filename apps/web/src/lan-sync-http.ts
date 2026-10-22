import { supportsNativeHttp } from './lib/capabilities.ts';

/**
 * 局域网同步的 HTTP 工具：客户端 fetch 与错误体解析。
 *
 * 单独一层是为了让 `lan-sync.ts`（生命周期）与 `lan-sync-preview.ts`（预览）
 * 共用同一份原生 HTTP 分支，不各写一遍平台判断。
 */

export async function lanFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (supportsNativeHttp()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, init);
  }
  return globalThis.fetch(url, init);
}

/** 错误响应优先取服务端的可展示文案，否则退回「动作 + 状态码」。 */
export function lanResponseError(status: number, text: string, action: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === 'string' && message !== '') return message;
  } catch {
    // 非 JSON 错误体：退回状态码文案
  }
  return `${action}失败（HTTP ${status}）`;
}

export function lanUtf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
