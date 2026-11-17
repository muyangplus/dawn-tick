import type { Storage } from '@dawn-tick/core';
import { readMetaJson, writeMetaJson } from './lib/meta.ts';
import { LAN_TRUSTED_TOKENS_META_KEY } from './lib/meta-keys.ts';
import { parseTrustedTokens, trustedTokensValue, type TrustedToken } from './lan-sync-protocol.ts';

/**
 * 服务端可信令牌的持久化（`app_meta` 键 `lan_trusted_tokens_v1`）。
 *
 * 只在桌面 / 安卓的「开启配对」服务端使用：**只落 `tokenHash`**（SHA-256），
 * 明文令牌只出现在 `/pair` 与 `/pair/refresh` 的响应里。
 * 结构校验与过期判定在 `lan-sync-protocol.ts`，这里只管读写与去重写。
 */

/** 读取可信令牌列表；损坏或缺失时返回空数组。 */
export async function loadTrustedTokens(storage: Storage): Promise<TrustedToken[]> {
  return readMetaJson(storage, LAN_TRUSTED_TOKENS_META_KEY, {
    parse: parseTrustedTokens,
    fallback: [],
    scope: 'lan-sync',
  });
}

/** 写入可信令牌列表；失败只记日志（`writeMetaJson` 内部抛错由这里吞掉）。 */
export async function saveTrustedTokens(
  storage: Storage,
  tokens: readonly TrustedToken[],
): Promise<void> {
  try {
    await writeMetaJson(storage, LAN_TRUSTED_TOKENS_META_KEY, trustedTokensValue(tokens), {
      scope: 'lan-sync',
    });
  } catch {
    // 写失败不阻断同步：本次运行仍以内存里的列表为准
  }
}

/** 两份令牌列表是否等价（用于避免每次请求都重复落盘）。 */
export function sameTrustedTokens(
  left: readonly TrustedToken[],
  right: readonly TrustedToken[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (
      a.tokenHash !== b.tokenHash ||
      a.name !== b.name ||
      a.createdAt !== b.createdAt ||
      a.lastUsedAt !== b.lastUsedAt ||
      a.expiresAt !== b.expiresAt
    ) {
      return false;
    }
  }
  return true;
}
