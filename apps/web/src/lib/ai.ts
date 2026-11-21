import {
  createOpenAiCompatibleClient,
  readSettings,
  type AiClient,
  type AiFetch,
  type Storage,
} from '@dawn-tick/core';
import { supportsNativeHttp } from './capabilities.ts';
import { AI_API_KEY_META_KEY, readStoredSecret } from './credentials.ts';
import { desktopHttpFetch } from './update-fetch.ts';
import { aiCopy } from '../copy/settings-ai.ts';

/** AI 请求的出口：桌面走原生 HTTP 绕开跨域，安卓的全局 fetch 已由 CapacitorHttp 接管，浏览器受跨域限制。 */
export function aiFetch(): AiFetch {
  return (supportsNativeHttp() ? desktopHttpFetch : globalThis.fetch) as unknown as AiFetch;
}

/** 测试注入：替换真实客户端。 */
let injected: AiClient | undefined;

export function setAiClientForTests(client: AiClient | undefined): void {
  injected = client;
}

/** 按当前设置组装客户端；密钥现取现解密，不留在设置对象里。 */
export async function loadAiClient(storage: Storage): Promise<AiClient> {
  if (injected !== undefined) return injected;
  const settings = await readSettings(storage);
  const secret = await readStoredSecret(storage, AI_API_KEY_META_KEY);
  if (secret.state === 'error') throw new Error(secret.message ?? aiCopy.keyUnreadable);
  return createOpenAiCompatibleClient(
    { baseUrl: settings.aiBaseUrl, model: settings.aiModel, apiKey: secret.password },
    aiFetch(),
  );
}
