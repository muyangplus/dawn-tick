/**
 * 更新检查：只负责"有没有新版"，下载与安装由用户在界面确认后触发。
 *
 * 渠道隔离：每个渠道只查自己那张 version.json，dev 永不看 beta/release。
 * release 用户只有在打开「接收测试版更新」后才会去看 beta 源。
 */

export type UpdateChannel = 'dev' | 'beta' | 'release';

const OWNER = 'muyangplus';
const REPO = 'dawn-tick';

/** 各渠道的固定取用地址：rolling 标签由发布流程维护。 */
export const UPDATE_FEEDS: Record<UpdateChannel, string> = {
  dev: `https://github.com/${OWNER}/${REPO}/releases/download/dev-latest/version.json`,
  beta: `https://github.com/${OWNER}/${REPO}/releases/download/beta-latest/version.json`,
  release: `https://github.com/${OWNER}/${REPO}/releases/latest/download/version.json`,
};

export interface UpdateAsset {
  url: string;
  size?: number;
  /** 该平台自带签名的校验值：Windows 为 minisign 签名，Android 为 APK 签名摘要 */
  signature?: string;
  sha256?: string;
}

export interface UpdateManifest {
  channel: UpdateChannel;
  version: string;
  releasedAt?: number;
  commit?: string;
  notes?: string;
  assets?: Partial<Record<'windows' | 'android' | 'web', UpdateAsset>>;
}

export interface UpdateStatus {
  /** 是否有可用更新（含渠道允许的最新版） */
  available: boolean;
  /** 拉取失败时的原因，成功时为 null */
  error: string | null;
  /** 实际查询的渠道 */
  feed: UpdateChannel;
  current: string;
  latest: string | null;
  manifest: UpdateManifest | null;
}

/** 指定渠道下用户应该查询哪个源。 */
export function resolveFeed(channel: UpdateChannel, receiveBeta: boolean): UpdateChannel {
  if (channel === 'dev') return 'dev';
  if (channel === 'beta') return receiveBeta ? 'beta' : 'release';
  return receiveBeta ? 'beta' : 'release';
}

/** 未显式设置时，「接收测试版更新」的默认值：beta 渠道默认开，其余默认关。 */
export function defaultReceiveBeta(channel: UpdateChannel): boolean {
  return channel === 'beta';
}

export function resolveReceiveBeta(stored: boolean | null, channel: UpdateChannel): boolean {
  return stored === null ? defaultReceiveBeta(channel) : stored;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** 语义化版本比较：a > b 返回正数，相等返回 0。预发布版本小于同号正式版。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return a.localeCompare(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const one = left.prerelease[index];
    const two = right.prerelease[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    if (one === two) continue;
    const oneNumber = Number(one);
    const twoNumber = Number(two);
    const bothNumeric = Number.isFinite(oneNumber) && Number.isFinite(twoNumber);
    if (bothNumeric) return oneNumber - twoNumber;
    if (Number.isFinite(oneNumber)) return -1;
    if (Number.isFinite(twoNumber)) return 1;
    return one.localeCompare(two);
  }
  return 0;
}

export function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<UpdateManifest>;
  return (
    (row.channel === 'dev' || row.channel === 'beta' || row.channel === 'release') &&
    typeof row.version === 'string' &&
    row.version.length > 0
  );
}

export interface CheckUpdateOptions {
  channel: UpdateChannel;
  receiveBeta: boolean;
  currentVersion: string;
  fetchImpl?: typeof fetch;
}

/**
 * 检查更新。只接受与来源渠道一致、且更新于当前版本的清单；
 * 跨渠道或降级一律视为无更新，避免"串版"。
 */
export async function checkForUpdate(options: CheckUpdateOptions): Promise<UpdateStatus> {
  const feed = resolveFeed(options.channel, options.receiveBeta);
  const base: UpdateStatus = {
    available: false,
    error: null,
    feed,
    current: options.currentVersion,
    latest: null,
    manifest: null,
  };
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return { ...base, error: '当前环境无法联网检查更新' };

  try {
    const response = await doFetch(UPDATE_FEEDS[feed], { headers: { accept: 'application/json' } });
    if (!response.ok) return { ...base, error: `更新源返回 ${response.status}` };
    const parsed: unknown = await response.json();
    if (!isUpdateManifest(parsed)) return { ...base, error: '更新清单格式不正确' };
    if (parsed.channel !== feed) {
      return { ...base, error: `清单渠道 ${parsed.channel} 与查询渠道 ${feed} 不一致，已忽略` };
    }
    const newer = compareVersions(parsed.version, options.currentVersion) > 0;
    return {
      ...base,
      available: newer,
      latest: parsed.version,
      manifest: parsed,
    };
  } catch (cause: unknown) {
    return { ...base, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** 各平台自带的合法性验证命令，展示给用户核对。 */
export function verifyHint(channel: UpdateChannel, asset: 'windows' | 'android' | 'web'): string {
  if (asset === 'android') return '安装前系统会校验 APK 签名；也可用 apksigner verify --print-certs 核对签名者';
  if (asset === 'windows') return '更新包随附签名，安装前会校验；也可用 gh attestation verify <文件> --repo muyangplus/dawn-tick 核对来源';
  return `网页版随渠道 ${channel} 自动获取最新构建`;
}
