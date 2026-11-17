import type { Storage } from '@dawn-tick/core';
import {
  UPDATE_RELEASES_API,
  compareVersions,
  manifestFromRelease,
  type UpdateChannel,
  type UpdateManifest,
} from '../update.ts';
import { planUpdateDownload, type UpdatePlatform } from './update-download.ts';
import { readMetaJson, writeMetaJson } from './meta.ts';
import { IGNORED_UPDATE_VERSION_META_KEY } from './meta-keys.ts';

/**
 * 更新运营的本地偏好与策略：忽略某个版本、取消忽略、回滚到正式版。
 *
 * 边界：
 * - 忽略只记一个版本号（仅本次版本），存 `app_meta`，换版本后自动恢复提示；
 * - `shouldPrompt` / `isIgnoredVersion` / `pickRollbackTarget` / `canRollbackToStable`
 *   都是纯函数，界面只负责触发与展示，单测不碰存储与网络；
 * - 回滚只挑「最新正式版」的发布资产，并复用 `update-download` 的下载/校验/安装链路，
 *   因此这里不重复实现任何下载逻辑，只给可读的「为什么不能回滚」。
 */

/** 已忽略版本：只接受非空字符串，结构不对按「没有忽略」处理。 */
function parseIgnoredVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 读取已忽略的版本；没有记录或记录损坏时返回 null。 */
export async function readIgnoredVersion(storage: Pick<Storage, 'readMeta'>): Promise<string | null> {
  return readMetaJson(storage, IGNORED_UPDATE_VERSION_META_KEY, {
    parse: parseIgnoredVersion,
    fallback: null,
    scope: 'update',
  });
}

/** 记住忽略的版本（仅这一个版本）。 */
export async function writeIgnoredVersion(storage: Pick<Storage, 'writeMeta'>, version: string): Promise<void> {
  const normalized = version.trim();
  if (normalized === '') throw new Error('要忽略的版本号为空');
  await writeMetaJson(storage, IGNORED_UPDATE_VERSION_META_KEY, normalized, { scope: 'update' });
}

/** 取消忽略：直接写空值，读取时按「没有记录」处理，不会多记一条结构告警。 */
export async function clearIgnoredVersion(storage: Pick<Storage, 'writeMeta'>): Promise<void> {
  await storage.writeMeta(IGNORED_UPDATE_VERSION_META_KEY, '');
}

/** 远端最新版是否就是被忽略的那一个版本（比较时忽略 `v` 前缀与空白）。 */
export function isIgnoredVersion(remote: string | null, ignored: string | null): boolean {
  if (remote === null || remote.trim() === '' || ignored === null || ignored.trim() === '') return false;
  return compareVersions(remote, ignored) === 0;
}

export interface PromptDecision {
  /** 检查到的远端最新版；null 表示这次没查到 */
  remote: string | null;
  /** 本机当前版本 */
  current: string;
  /** 用户忽略的版本；null 表示没有忽略任何版本 */
  ignored: string | null;
}

/**
 * 要不要弹自动更新提示：远端严格更高、且不是用户忽略过的那个版本。
 * 忽略只对这一个版本生效——远端又出了更高的版本时照常提示。
 */
export function shouldPrompt({ remote, current, ignored }: PromptDecision): boolean {
  if (remote === null || remote.trim() === '') return false;
  if (compareVersions(remote, current) <= 0) return false;
  return !isIgnoredVersion(remote, ignored);
}

/** 回滚目标：能自动安装时给出正式版清单，否则给出可读原因。 */
export type RollbackTarget =
  | { kind: 'target'; version: string; manifest: UpdateManifest }
  | { kind: 'none'; reason: string };

/** 正式版标签：`v0.5.0` / `0.5.0`；带 `-beta` 等后缀的预发布不算。 */
const STABLE_TAG = /^v?\d+\.\d+\.\d+$/;

/** 发布列表里的一条正式版记录：非草稿、非预发布、标签是正式版号。 */
function isStableRelease(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['draft'] === true || record['prerelease'] === true) return false;
  const tag = typeof record['tag_name'] === 'string' ? record['tag_name'].trim() : '';
  return STABLE_TAG.test(tag);
}

/**
 * 从 GitHub 发布列表里挑最新正式版，并要求它带有该平台可自动安装的资产。
 *
 * 回滚复用 `update-download` 的安装链路，所以 Windows 只认 exe/msi 安装包、
 * Android 只认 APK；只有便携 zip 或没有资产时返回可读原因，让用户改走发布页。
 */
export function pickRollbackTarget(releases: unknown, platform: UpdatePlatform): RollbackTarget {
  if (!Array.isArray(releases)) return { kind: 'none', reason: '读不到正式版发布记录' };
  let best: UpdateManifest | null = null;
  for (const raw of releases) {
    if (!isStableRelease(raw)) continue;
    const manifest = manifestFromRelease('release', raw);
    if (manifest === null) continue;
    if (best === null || compareVersions(manifest.version, best.version) > 0) best = manifest;
  }
  if (best === null) return { kind: 'none', reason: '还没有正式版发布' };
  const plan = planUpdateDownload(best, platform);
  if (plan.kind === 'unavailable') return { kind: 'none', reason: plan.reason };
  return { kind: 'target', version: best.version, manifest: best };
}

export interface RollbackAvailability {
  /** 本机当前版本 */
  current: string;
  /** 本机渠道：dev/beta 天然可以回正式版 */
  channel: UpdateChannel;
  /** 最近一次检查看到的正式版；还没查到时为 null */
  latestStable: string | null;
}

/**
 * 「回滚到正式版」何时可用：
 * - beta/dev 渠道：即便当前还比正式版低，也允许回到正式版；
 * - 正式版渠道：只有当前版本高于最新正式版（例如关掉测试版开关后）才有意义。
 * 还不知道最新正式版时，正式版渠道不显示入口，等一次检查结果。
 */
export function canRollbackToStable({ current, channel, latestStable }: RollbackAvailability): boolean {
  if (channel === 'beta' || channel === 'dev') return true;
  if (latestStable === null || latestStable.trim() === '') return false;
  return compareVersions(current, latestStable) > 0;
}

/**
 * 拉取发布列表供 `pickRollbackTarget` 挑选。
 *
 * 只是 IO 薄壳：把 HTTP 状态换成可读原因，选择策略全在上面那个纯函数里。
 */
export async function loadRollbackReleases(fetchImpl?: typeof fetch): Promise<unknown> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境无法联网检查更新');
  const response = await doFetch(UPDATE_RELEASES_API, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('该仓库还没有发布记录');
    if (response.status === 403 || response.status === 429) throw new Error('GitHub 接口限流，请稍后再试');
    throw new Error(`更新源返回 ${response.status}`);
  }
  return await response.json();
}
