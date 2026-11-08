/** 下载源：国内 Gitee 与国际 GitHub 的镜像地址、延迟探测与自动选择。 */
/**
 * 边界：
 * - 地址表 `MIRRORS` 是唯一事实来源：应用更新、预设更新、可达性探测都从这里拼 URL；
 * - 产物（安装包）放在独立 assets 仓库，地址口径见 `assets-mirror.ts`；
 * - 探测在 `download-probe.ts`，选择与缓存文案在 `download-selection.ts`（本模块只留地址表）；
 * - 自动选择只看「version.json 探测 + 便携包 256KB 测速」结果，不做 GeoIP；结果按会话缓存 10 分钟；
 * - Gitee 镜像未同步/不可达时退化成「仓库可达」探测（`degraded`），下载链路据此回退另一个源。
 */

import type { DownloadSourceChoice } from '@dawn-tick/core';
import type { UpdateChannel } from '../update.ts';

export {
  ASSETS_BRANCH,
  ASSETS_REPO,
  ASSETS_VERSION_FILE,
  CHECKSUMS_FILE,
  assetsFileUrl,
  assetsVersionUrl,
} from './assets-mirror.ts';

/** 具体的一次下载（应用更新与预设更新共用）：不含 auto。 */
export type DownloadSource = 'github' | 'gitee';

/** 界面下拉的候选顺序：国内优先。 */
export const DOWNLOAD_SOURCES: readonly DownloadSource[] = ['gitee', 'github'];

export const DOWNLOAD_SOURCE_LABEL: Record<DownloadSource, string> = {
  gitee: 'Gitee',
  github: 'GitHub',
};

/** 一个镜像仓库的全部地址口径。 */
export interface Mirror {
  /** 应用更新仓库（owner/repo） */
  repo: string;
  /** 预设仓库（owner/repo） */
  presets: string;
  /** 独立产物仓库（owner/repo）：按渠道分支存安装包与 version.json */
  assets: string;
  /** 默认分支：预设 raw 与可达性探测用 */
  branch: string;
  /** 发布 API 根（不含 owner/repo）：GitHub 与 Gitee v5 的路径形状一致 */
  api: string;
  /** 站点根：发布页与 release 下载地址 */
  site: string;
  /** raw 文件地址：GitHub 用 raw.githubusercontent.com，Gitee 用 /raw/ 路径 */
  raw: (repo: string, branch: string, path: string) => string;
}

export const MIRRORS: Record<DownloadSource, Mirror> = {
  github: {
    repo: 'muyangplus/dawn-tick',
    presets: 'muyangplus/dawn-tick-presets',
    assets: 'muyangplus/dawn-tick-assets',
    branch: 'main',
    api: 'https://api.github.com/repos',
    site: 'https://github.com',
    raw: (repo, branch, path) => `https://raw.githubusercontent.com/${repo}/${branch}/${path}`,
  },
  gitee: {
    repo: 'muyangplus/dawn-tick',
    presets: 'muyangplus/dawn-tick-presets',
    assets: 'muyangplus/dawn-tick-assets',
    branch: 'main',
    api: 'https://gitee.com/api/v5/repos',
    site: 'https://gitee.com',
    raw: (repo, branch, path) => `https://gitee.com/${repo}/raw/${branch}/${path}`,
  },
};

// —— 地址拼接（纯函数） ——

/** 发布列表：beta 渠道取候选时用（`?per_page=30`）。 */
export function releasesApiUrl(source: DownloadSource, perPage = 30): string {
  return `${MIRRORS[source].api}/${MIRRORS[source].repo}/releases?per_page=${perPage}`;
}

/** 各渠道的发布 API：dev 用滚动标签、beta 查列表、release 查 latest。 */
export function releaseApiUrl(source: DownloadSource, feed: UpdateChannel): string {
  const base = `${MIRRORS[source].api}/${MIRRORS[source].repo}/releases`;
  if (feed === 'dev') return `${base}/tags/dev-latest`;
  if (feed === 'release') return `${base}/latest`;
  return releasesApiUrl(source);
}

/** 发布页（「打开发布页」的地址）。 */
export function releasePageUrl(source: DownloadSource): string {
  return `${MIRRORS[source].site}/${MIRRORS[source].repo}/releases`;
}

/** GitHub 的「最新正式版 version.json」直连地址；Gitee 不再提供 Releases 兜底。 */
export function latestVersionJsonUrl(source: DownloadSource): string {
  return `${MIRRORS[source].site}/${MIRRORS[source].repo}/releases/latest/download/version.json`;
}

/** 预设仓库的 version.json：raw 直连。 */
export function presetVersionUrl(source: DownloadSource): string {
  return MIRRORS[source].raw(MIRRORS[source].presets, MIRRORS[source].branch, 'version.json');
}

/** 指定版本的预设快照：raw 直连。 */
export function presetSnapshotUrl(source: DownloadSource, version: string): string {
  return MIRRORS[source].raw(MIRRORS[source].presets, MIRRORS[source].branch, `snapshot/presets-${version}.json`);
}

/** 预设仓库的 contents 接口（raw 失败时的回退；正文是 base64）。 */
export function presetContentsUrl(source: DownloadSource, path: string): string {
  return `${MIRRORS[source].api}/${MIRRORS[source].presets}/contents/${path}`;
}

/** 发布资产里某个文件的下载地址（旧 Releases 兼容路径用）。 */
export function versionJsonAssetUrl(release: unknown): string | null {
  const record = asRecord(release);
  const assets = record?.['assets'];
  if (!Array.isArray(assets)) return null;
  for (const raw of assets) {
    const asset = asRecord(raw);
    if (asset === null) continue;
    if (String(asset['name'] ?? '').toLowerCase() !== 'version.json') continue;
    const url = asset['browser_download_url'] ?? asset['download_url'];
    if (typeof url === 'string' && url !== '') return url;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
