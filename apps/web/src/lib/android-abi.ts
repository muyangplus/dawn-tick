import { isAndroidApp } from './capabilities.ts';
import { errorMessage } from './errors.ts';
import { logWarn } from '../log.ts';
import { loadPlugin, PLUGIN_NAMES, type SystemActionsPlugin } from './plugins.ts';
import { withTimeout } from './timeout.ts';

/**
 * 设备 ABI 探测：更新清单里 Android 分成 arm64-v8a 与 armeabi-v7a 两个 APK，
 * 客户端要在下载前知道自己该拿哪一个。
 *
 * 边界：
 * - 只在 Android 壳里调用一次原生 `SystemActions.abi()`（`Build.SUPPORTED_ABIS`），
 *   结果在本次会话内缓存；Web / Windows 直接按 arm64 处理；
 * - 3 秒超时，插件缺失、旧安装包没有该方法或调用失败都回退 arm64-v8a，
 *   绝不因为探测失败挡住检查更新；
 * - 纯查询，不写设置；清单解析（`assets-mirror.ts`）只读 `preferredAndroidAbi()`。
 */

/** 本仓库发布的两个 ABI。 */
export type AndroidAbi = 'arm64-v8a' | 'armeabi-v7a';

/** 探测失败/非 Android 的默认值：旧客户端与绝大多数真机都是 arm64。 */
export const DEFAULT_ANDROID_ABI: AndroidAbi = 'arm64-v8a';

/** 原生探测的超时上限：慢也不会拖住「检查更新」。 */
export const ANDROID_ABI_TIMEOUT_MS = 3_000;

/** 原生 `abi()` 的返回形状（字段与 `plugins.ts` 的契约一致）。 */
export interface AndroidAbiInfo {
  primary?: string;
  abis?: string[];
}

export type AndroidAbiDetector = () => Promise<unknown>;

let preferred: AndroidAbi = DEFAULT_ANDROID_ABI;
/** 本次会话的探测只跑一次：失败也缓存成默认值，不反复打原生。 */
let detection: Promise<void> | null = null;
/** 测试注入的直接结果：非空时 `ensureAndroidAbi()` 不加载插件。 */
let abiOverrideForTests: AndroidAbi | null = null;
/** 测试注入的探测器；非空时允许在非 Android 环境验证超时/失败回退。 */
let detectorForTests: AndroidAbiDetector | null = null;
let timeoutForTests: number = ANDROID_ABI_TIMEOUT_MS;

/** 当前会话的首选 ABI：探测完成后为设备主 ABI，否则是 arm64-v8a。 */
export function preferredAndroidAbi(): AndroidAbi {
  return preferred;
}

/**
 * 冒烟 / 单测直接固定首选 ABI（不加载 Capacitor）。
 * 传 `null` 恢复默认 arm64 并清掉探测缓存，让下一次 `ensureAndroidAbi()` 重新探测。
 */
export function setAndroidAbiForTests(next: AndroidAbi | null): void {
  abiOverrideForTests = next;
  preferred = next ?? DEFAULT_ANDROID_ABI;
  detection = null;
}

/**
 * 冒烟 / 单测替换原生探测，并可用 `timeoutMs` 在毫秒级验证超时回退。
 * 传 `null` 恢复真实插件；非 Android 环境注入时也能跑探测（仅测试用）。
 */
export function setAndroidAbiDetectorForTests(
  next: AndroidAbiDetector | null,
  timeoutMs: number = ANDROID_ABI_TIMEOUT_MS,
): void {
  detectorForTests = next;
  timeoutForTests = timeoutMs;
  detection = null;
  preferred = abiOverrideForTests ?? DEFAULT_ANDROID_ABI;
}

/** ABI 名归一：只认发布的两个；大小写与空白容错，其它值返回 null。 */
export function normalizeAndroidAbi(value: unknown): AndroidAbi | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'arm64-v8a') return 'arm64-v8a';
  if (normalized === 'armeabi-v7a') return 'armeabi-v7a';
  return null;
}

/**
 * 解析原生返回值：`primary` 优先，其次 `abis` 里第一个能识别的；
 * 都认不出（x86 模拟器、旧插件返回空）按 arm64-v8a。
 */
export function parseAndroidAbi(value: unknown): AndroidAbi {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_ANDROID_ABI;
  }
  const record = value as Record<string, unknown>;
  const primary = normalizeAndroidAbi(record['primary']);
  if (primary !== null) return primary;
  const abis = record['abis'];
  if (Array.isArray(abis)) {
    for (const item of abis) {
      const parsed = normalizeAndroidAbi(item);
      if (parsed !== null) return parsed;
    }
  }
  return DEFAULT_ANDROID_ABI;
}

/** 真实探测：加载 SystemActions 插件并读 `Build.SUPPORTED_ABIS`。 */
async function probeNativeAbi(): Promise<AndroidAbiInfo | null> {
  const plugin = await loadPlugin<SystemActionsPlugin>(PLUGIN_NAMES.systemActions);
  if (plugin === null || typeof plugin.abi !== 'function') return null;
  return plugin.abi();
}

async function detectAndroidAbi(): Promise<AndroidAbi> {
  const probe = detectorForTests ?? probeNativeAbi;
  try {
    const value = await withTimeout(probe(), timeoutForTests, '读取设备 ABI 超时');
    return parseAndroidAbi(value);
  } catch (cause: unknown) {
    logWarn('update', '读取设备 ABI 失败，按 arm64-v8a 处理', { message: errorMessage(cause) });
    return DEFAULT_ANDROID_ABI;
  }
}

/**
 * 确保首选 ABI 已就绪：`checkForUpdate()` 在拉清单前调用。
 * 非 Android 直接返回；同一次会话只探测一次；永不抛错，失败按 arm64。
 */
export async function ensureAndroidAbi(): Promise<void> {
  if (abiOverrideForTests !== null) {
    preferred = abiOverrideForTests;
    return;
  }
  if (!isAndroidApp() && detectorForTests === null) return;
  if (detection === null) {
    detection = detectAndroidAbi().then((abi) => {
      preferred = abi;
    });
  }
  await detection;
}
