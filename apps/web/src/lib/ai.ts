import {
  createOpenAiCompatibleClient,
  readSettings,
  type AiClient,
  type AiFetch,
  type Storage,
} from '@dawn-tick/core';
import { pluginStreamFetch } from './ai-stream.ts';
import { isAndroidApp, supportsNativeHttp } from './capabilities.ts';
import { AI_API_KEY_META_KEY, readStoredSecret } from './credentials.ts';
import { logWarn } from '../log.ts';
import { loadPlugin, PLUGIN_NAMES, type AiStreamPlugin } from './plugins.ts';
import { desktopHttpFetch } from './update-fetch.ts';
import { aiCopy } from '../copy/settings-ai.ts';

let androidFetch: Promise<AiFetch> | null = null;

/** 安卓：优先走 AiStream 插件逐段读回复；插件加载不到时退回 CapacitorHttp 接管的全局 fetch（整段返回）。 */
function loadAndroidFetch(): Promise<AiFetch> {
  androidFetch ??= loadPlugin<AiStreamPlugin>(PLUGIN_NAMES.aiStream)
    .then((plugin) => (plugin === null ? (globalThis.fetch as unknown as AiFetch) : pluginStreamFetch(plugin)))
    .catch((error: unknown) => {
      logWarn('app', 'AI 流式插件加载失败，改用整段返回', { error });
      return globalThis.fetch as unknown as AiFetch;
    });
  return androidFetch;
}

/** AI 请求的出口：桌面走原生 HTTP 绕开跨域，安卓走流式插件，浏览器受跨域限制。 */
export function aiFetch(): AiFetch {
  if (supportsNativeHttp()) return desktopHttpFetch as unknown as AiFetch;
  if (isAndroidApp()) return async (input, init) => (await loadAndroidFetch())(input, init);
  return globalThis.fetch as unknown as AiFetch;
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
