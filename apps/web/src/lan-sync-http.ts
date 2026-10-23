import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { invokeNative, type NativeCommand } from './lib/native.ts';
import { logWarn } from './log.ts';

/**
 * 局域网同步的 HTTP 工具：客户端 fetch 与错误体解析。
 *
 * 边界：
 * - 桌面走 Rust `lan_http_request`（`TcpStream` 手写 HTTP，**完全不走系统代理**）；
 *   开着系统代理时 `plugin-http` 会把 192.168.x.x 也交给代理，导致局域网同步失败；
 * - Android 走 CapacitorHttp（原生直连，不受桌面代理影响）；
 * - 原生直连失败时回退 `globalThis.fetch` 并记日志，保持旧行为可用；
 * - 单独一层是为了让 `lan-sync.ts`（生命周期）与 `lan-sync-preview.ts`（预览）
 *   共用同一份分支，不各写一遍平台判断。
 */

/** 原生直连超时：服务端最多等 TS 10 秒，客户端留出余量。 */
export const LAN_HTTP_TIMEOUT_MS = 15_000;

/** Rust `lan_http_request` 的返回。 */
export interface LanHttpNativeReply {
  status: number;
  body: string;
}

/** 原生命令参数：与 Rust 命令签名（camelCase）逐字对应。 */
export interface LanHttpNativeArgs {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

/** 把 `fetch` 的 init 归一成原生参数；纯函数，便于单测。 */
export function toLanNativeArgs(
  url: string,
  init: RequestInit = {},
  timeoutMs = LAN_HTTP_TIMEOUT_MS,
): LanHttpNativeArgs {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  if (init.headers !== undefined) {
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
  }
  const body = typeof init.body === 'string' ? init.body : undefined;
  return body === undefined
    ? { method, url, headers, timeoutMs }
    : { method, url, headers, body, timeoutMs };
}

function toResponse(reply: LanHttpNativeReply): Response {
  if (
    typeof reply !== 'object' ||
    reply === null ||
    typeof reply.status !== 'number' ||
    typeof reply.body !== 'string'
  ) {
    throw new Error('局域网原生 HTTP 返回不完整');
  }
  return new Response(reply.body === '' ? null : reply.body, {
    status: reply.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

type InvokeLike = (command: NativeCommand, args?: Record<string, unknown>) => Promise<unknown>;

/** 单测 / 冒烟注入：替代 `invokeNative`，验证桌面分支确实调了原生命令。 */
let invokeOverride: InvokeLike | null = null;

export function setLanHttpInvokerForTests(next: InvokeLike | null): void {
  invokeOverride = next;
}

function nativeInvoke(): InvokeLike {
  return invokeOverride ?? invokeNative;
}

/** CapacitorHttp 的最小接口；单测注入，避免在 Node 里真的加载 Capacitor。 */
export interface LanCapacitorHttp {
  request(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    data?: string;
    readTimeout?: number;
    connectTimeout?: number;
  }): Promise<{ status?: number; data?: unknown }>;
}

let capacitorHttpOverride: LanCapacitorHttp | null = null;

export function setLanCapacitorHttpForTests(next: LanCapacitorHttp | null): void {
  capacitorHttpOverride = next;
}

async function loadCapacitorHttp(): Promise<LanCapacitorHttp | null> {
  if (capacitorHttpOverride !== null) return capacitorHttpOverride;
  const { CapacitorHttp } = await import('@capacitor/core');
  return CapacitorHttp as unknown as LanCapacitorHttp;
}

async function androidFetch(url: string, init: RequestInit): Promise<Response> {
  const http = await loadCapacitorHttp();
  if (http === null) throw new Error('当前平台没有 CapacitorHttp');
  const args = toLanNativeArgs(url, init);
  const reply = await http.request({
    url,
    method: args.method,
    headers: args.headers,
    ...(args.body === undefined ? {} : { data: args.body }),
    readTimeout: LAN_HTTP_TIMEOUT_MS,
    connectTimeout: LAN_HTTP_TIMEOUT_MS,
  });
  const status = reply.status ?? 200;
  const data = reply.data;
  const body =
    typeof data === 'string' ? data : data === undefined || data === null ? '' : JSON.stringify(data);
  return new Response(body === '' ? null : body, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function lanFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (isDesktopApp()) {
    try {
      return toResponse(
        (await nativeInvoke()('lan_http_request', {
          ...toLanNativeArgs(url, init),
        })) as LanHttpNativeReply,
      );
    } catch (cause: unknown) {
      logWarn('lan-sync', '桌面局域网直连失败，回退 WebView fetch', {
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  } else if (isAndroidApp()) {
    try {
      return await androidFetch(url, init);
    } catch (cause: unknown) {
      logWarn('lan-sync', 'Android 原生 HTTP 失败，回退 fetch', {
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
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
