import { detectPlatform } from './platform-detect.ts';

export interface PlatformResponse {
  status: number;
  text: () => Promise<string>;
  setCookie?: string[];
}

export type PlatformFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<PlatformResponse>;

function readSetCookie(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') return withGetter.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw === null ? [] : raw.split(/,(?=[^;]+=)/);
}

/**
 * 三端各自的 HTTP 通道：
 * - Windows：走 tauri-plugin-http（Rust 侧请求，不受同源策略限制）
 * - Android：CapacitorHttp 已接管 fetch（原生请求）
 * - Web：浏览器 fetch，受同源策略限制
 */
export function createPlatformFetch(): PlatformFetch {
  const platform = detectPlatform();

  if (platform === 'tauri') {
    return async (url, init) => {
      const plugin = await import('@tauri-apps/plugin-http');
      const response = await plugin.fetch(url, {
        method: init?.method ?? 'GET',
        ...(init?.headers === undefined ? {} : { headers: init.headers }),
        ...(init?.body === undefined ? {} : { body: init.body }),
        ...(init?.method === 'POST' ? { connectTimeout: 20_000 } : {}),
      });
      return {
        status: response.status,
        text: () => response.text(),
        setCookie: readSetCookie(response.headers),
      };
    };
  }

  return async (url, init) => {
    const response = await fetch(url, { ...init, credentials: 'include' });
    return {
      status: response.status,
      text: () => response.text(),
      setCookie: readSetCookie(response.headers),
    };
  };
}

export function fetchHint(platform = detectPlatform()): string {
  if (platform === 'web') return '浏览器受同源策略限制，可改用 CSV/Excel 或 ICS 导入';
  return '可检查教务地址是否正确，或改用 CSV/Excel 与 ICS 导入';
}
