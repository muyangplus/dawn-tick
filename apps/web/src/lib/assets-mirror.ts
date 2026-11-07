/**
 * 独立 assets 仓库的清单契约与地址拼接。
 *
 * 背景：Gitee Releases/API 在 GitHub Actions 网络下不可用、附件也有容量限制。
 * 产物改放独立仓库 `muyangplus/dawn-tick-assets`，按渠道用三条单提交分支
 * `dev` / `beta` / `release`（每次发布 force-push 覆盖，只留最新一套），
 * 客户端只读两条 raw 链路（Gitee 侧由镜像同步后同样可读）：
 *
 *   GitHub: https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/<branch>/<file>
 *   Gitee : https://gitee.com/muyangplus/dawn-tick-assets/raw/<branch>/<file>
 *
 * 本模块只做「地址 + mirror.json 解析 → UpdateManifest」的纯转换，不发请求。
 */

import type { UpdateAsset, UpdateChannel, UpdateManifest } from '../update.ts';
import type { DownloadSource } from './download-source.ts';

/** 产物仓库：与主仓库分开，避免产物把主仓库撑大，也绕开 Gitee Releases 限制。 */
export const ASSETS_REPO = 'muyangplus/dawn-tick-assets';
export const MIRROR_FILE = 'mirror.json';
export const CHECKSUMS_FILE = 'SHA256SUMS.txt';
export const MIRROR_SCHEMA = 1;

/** 渠道 → assets 仓库分支：三条分支各自只留该渠道最新一套文件。 */
export const ASSETS_BRANCH: Record<UpdateChannel, string> = {
  dev: 'dev',
  beta: 'beta',
  release: 'release',
};

export const MIRROR_FILE_KEYS = ['windowsSetup', 'windowsPortable', 'android', 'web'] as const;

export type MirrorFileKey = (typeof MIRROR_FILE_KEYS)[number];

export interface MirrorFile {
  name: string;
  size: number;
  sha256: string;
}

export type MirrorFiles = Partial<Record<MirrorFileKey, MirrorFile>>;

/** `mirror.json` 的完整契约：发布脚本 `tools/release/publish-assets.mjs` 生成。 */
export interface AssetsMirror {
  schema: number;
  channel: UpdateChannel;
  version: string;
  tag?: string;
  commit?: string;
  releasedAt?: number;
  notes?: string;
  files: MirrorFiles;
  checksums: string;
}

// —— 地址拼接（纯函数） ——

/** 两个源的 raw 基地址（末尾没有斜杠）：与 `MIRRORS[source].raw` 同一口径。 */
export function assetsRawBase(source: DownloadSource): string {
  return source === 'github'
    ? `https://raw.githubusercontent.com/${ASSETS_REPO}`
    : `https://gitee.com/${ASSETS_REPO}/raw`;
}

/** 渠道分支的 mirror.json 地址：客户端取源的第一个请求。 */
export function assetsMirrorUrl(source: DownloadSource, feed: UpdateChannel): string {
  return `${assetsRawBase(source)}/${ASSETS_BRANCH[feed]}/${MIRROR_FILE}`;
}

/** 渠道分支下某个文件的绝对地址：下载、校验文件都用它拼。 */
export function assetsFileUrl(source: DownloadSource, feed: UpdateChannel, name: string): string {
  const file = name.trim();
  if (file === '') throw new Error('assets 文件名为空');
  return `${assetsRawBase(source)}/${ASSETS_BRANCH[feed]}/${encodeURIComponent(file)}`;
}

// —— mirror.json 解析 ——

export type MirrorParseResult =
  | { ok: true; mirror: AssetsMirror }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isChannel(value: unknown): value is UpdateChannel {
  return value === 'dev' || value === 'beta' || value === 'release';
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** 单个文件项：名字非空、体积为非负整数、摘要为 64 位十六进制。 */
function parseFile(value: unknown, key: string): { ok: true; file: MirrorFile } | { ok: false; error: string } {
  const record = asRecord(value);
  if (record === null) return { ok: false, error: `${key} 不是对象` };
  const name = record['name'];
  if (typeof name !== 'string' || name.trim() === '') return { ok: false, error: `缺少文件 ${key} 的 name` };
  const size = record['size'];
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    return { ok: false, error: `${key} 的 size 不是有效字节数` };
  }
  const sha256 = record['sha256'];
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    return { ok: false, error: `${key} 的 sha256 不是 64 位十六进制` };
  }
  return { ok: true, file: { name: name.trim(), size, sha256: sha256.toLowerCase() } };
}

/**
 * 解析并校验 mirror.json。
 *
 * 只要求「渠道 + 版本 + 至少一个平台文件」成立：某个平台产物缺失时，
 * 客户端对那个平台提示「这次发布没有提供」，而不是整条更新链路失败。
 */
export function parseAssetsMirror(value: unknown): MirrorParseResult {
  const record = asRecord(value);
  if (record === null) return { ok: false, error: 'mirror.json 不是对象' };
  if (record['schema'] !== MIRROR_SCHEMA) return { ok: false, error: `schema 不是 ${MIRROR_SCHEMA}` };
  const channel = record['channel'];
  if (!isChannel(channel)) return { ok: false, error: '渠道不是 dev / beta / release' };
  const version = record['version'];
  if (typeof version !== 'string' || version.trim() === '') return { ok: false, error: '缺少版本号' };
  const releasedAt = record['releasedAt'];
  if (releasedAt !== undefined && (typeof releasedAt !== 'number' || !Number.isFinite(releasedAt))) {
    return { ok: false, error: 'releasedAt 不是毫秒时间戳' };
  }
  const commit = record['commit'];
  if (commit !== undefined && typeof commit !== 'string') return { ok: false, error: 'commit 不是字符串' };
  const notes = record['notes'];
  if (notes !== undefined && typeof notes !== 'string') return { ok: false, error: 'notes 不是字符串' };
  const tag = record['tag'];
  if (tag !== undefined && (typeof tag !== 'string' || tag.trim() === '')) {
    return { ok: false, error: 'tag 不是非空字符串' };
  }
  const checksums = record['checksums'];
  if (checksums !== undefined && (typeof checksums !== 'string' || checksums.trim() === '')) {
    return { ok: false, error: 'checksums 不是文件名' };
  }
  const filesRecord = asRecord(record['files']);
  if (filesRecord === null) return { ok: false, error: '缺少 files' };
  const files: MirrorFiles = {};
  for (const key of MIRROR_FILE_KEYS) {
    const raw = filesRecord[key];
    if (raw === undefined) continue;
    const parsed = parseFile(raw, key);
    if (!parsed.ok) return parsed;
    files[key] = parsed.file;
  }
  if (Object.keys(files).length === 0) {
    return { ok: false, error: `缺少文件（${MIRROR_FILE_KEYS.join(' / ')} 至少一个）` };
  }
  const mirror: AssetsMirror = {
    schema: MIRROR_SCHEMA,
    channel,
    version: version.trim(),
    ...(tag === undefined ? {} : { tag: tag.trim() }),
    ...(commit === undefined || commit === '' ? {} : { commit }),
    ...(releasedAt === undefined ? {} : { releasedAt }),
    ...(notes === undefined ? {} : { notes }),
    files,
    checksums: checksums === undefined ? CHECKSUMS_FILE : checksums.trim(),
  };
  return { ok: true, mirror };
}

// —— mirror.json → UpdateManifest ——

function assetOf(mirror: AssetsMirror, source: DownloadSource, file: MirrorFile): UpdateAsset {
  return {
    url: assetsFileUrl(source, mirror.channel, file.name),
    name: file.name,
    size: file.size,
    sha256: file.sha256,
  };
}

/**
 * 转成客户端既有的取源清单：
 * - `windows` = 安装包（没有安装包时退回便携 zip，向后兼容老清单）；
 * - `windowsPortable` 单独保留便携 zip：便携版自动更新要它，不能被安装包挤掉；
 * - 所有 URL 都是同源 raw 的绝对地址，`checksumsUrl` 指向同一分支的 `SHA256SUMS.txt`。
 */
export function manifestFromAssetsMirror(mirror: AssetsMirror, source: DownloadSource): UpdateManifest {
  const assets: NonNullable<UpdateManifest['assets']> = {};
  const portable = mirror.files.windowsPortable;
  const windows = mirror.files.windowsSetup ?? portable;
  if (windows !== undefined) assets.windows = assetOf(mirror, source, windows);
  if (portable !== undefined) assets.windowsPortable = assetOf(mirror, source, portable);
  if (mirror.files.android !== undefined) assets.android = assetOf(mirror, source, mirror.files.android);
  if (mirror.files.web !== undefined) assets.web = assetOf(mirror, source, mirror.files.web);
  return {
    channel: mirror.channel,
    version: mirror.version,
    ...(mirror.releasedAt === undefined ? {} : { releasedAt: mirror.releasedAt }),
    ...(mirror.commit === undefined ? {} : { commit: mirror.commit }),
    ...(mirror.notes === undefined ? {} : { notes: mirror.notes }),
    ...(Object.keys(assets).length === 0 ? {} : { assets }),
    checksumsUrl: assetsFileUrl(source, mirror.channel, mirror.checksums),
  };
}
