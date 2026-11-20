/** 自动更新的下载计划：渠道与平台 → 资产、文件名，以及 SHA256SUMS 校验。纯函数。 */
import type { UpdateAsset, UpdateManifest } from '../update.ts';
import type { UpdatePlatform } from './update-download-state.ts';
import { updateTaskCopy } from '../copy/update-task.ts';

export interface UpdateDownloadTarget {
  platform: 'windows' | 'android';
  /**
   * 安装方式：`installer` 交给系统安装程序（exe/msi/apk）；
   * `portable` 是 Windows 便携版 zip，退出应用后由原生脚本覆盖 exe。
   */
  kind: 'installer' | 'portable';
  /** 清单里的绝对地址：version.json 的文件名由客户端拼成同源 assets raw URL */
  url: string;
  /** 落盘文件名：固定名，重复下载覆盖旧安装包 */
  fileName: string;
  /** 清单给出的字节数：服务端没给 content-length 时用它显示进度 */
  size: number | null;
  /** 发布里的原始文件名：在 `SHA256SUMS.txt` 里按它取摘要 */
  assetName: string;
  /** 发布里 `SHA256SUMS.txt` 的地址 */
  checksumsUrl: string | null;
  /** 清单里直接给出的摘要 */
  sha256: string | null;
}

export type UpdatePlan =
  | { kind: 'download'; target: UpdateDownloadTarget }
  | { kind: 'refresh' }
  | { kind: 'unavailable'; reason: string };

/** Windows 运行形态：便携版用 zip 覆盖 exe，安装版交给安装程序。 */
export type WindowsInstallKind = 'portable' | 'installed';

const INSTALLER_SUFFIXES: Record<'windows' | 'android', readonly string[]> = {
  windows: ['.exe', '.msi'],
  android: ['.apk'],
};

/** 资产地址的最后一段（去掉查询串）；相对地址与测试桩也能用。 */
function baseNameFromUrl(url: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 相对地址或测试桩：按原样取最后一段
  }
  return (pathname.split('/').pop() ?? '').split('?')[0] ?? '';
}

/** 固定落盘名：从资产名（优先）或地址取出安装包扩展名，非安装包（如便携 zip）返回 null。 */
/** Gitee 的下载地址可能是 `…/download/v0.2.0/asset-1` 这类不带扩展名的 id，必须按发布里的原始文件名判断。 */
export function installerFileName(platform: 'windows' | 'android', url: string, name?: string): string | null {
  const lower = (name ?? baseNameFromUrl(url)).toLowerCase();
  const suffix = INSTALLER_SUFFIXES[platform].find((item) => lower.endsWith(item));
  if (suffix === undefined) return null;
  return platform === 'windows' ? `DawnTick-update${suffix}` : 'DawnTick-update.apk';
}

/** 便携包固定落盘名：只认 `.zip`，重复下载覆盖旧包。 */
export function portableFileName(url: string, name?: string): string | null {
  return (name ?? baseNameFromUrl(url)).toLowerCase().endsWith('.zip') ? 'DawnTick-update.zip' : null;
}

/**
 * 渠道 → 该下哪个资产。
 *
 * Web 不下载（构建随渠道自动更新）；Windows 按运行形态选产物：安装版只接受 exe/msi，
 * 便携版只接受便携 zip；Android 只接受 apk。缺资产时给可读原因，由界面提示并保留「打开发布页」。
 */
export function planUpdateDownload(
  manifest: UpdateManifest | null,
  platform: UpdatePlatform,
  installKind: WindowsInstallKind = 'installed',
): UpdatePlan {
  if (platform === 'web') return { kind: 'refresh' };
  const assets = manifest?.assets;
  if (platform === 'android') {
    const asset: UpdateAsset | undefined = assets?.android;
    if (asset === undefined || asset.url === '') {
      return { kind: 'unavailable', reason: updateTaskCopy.noAndroidPackage };
    }
    const fileName = installerFileName('android', asset.url, asset.name);
    if (fileName === null) {
      return { kind: 'unavailable', reason: updateTaskCopy.androidNotApk };
    }
    return {
      kind: 'download',
      target: downloadTarget('android', 'installer', asset, fileName, manifest),
    };
  }
  // 便携版优先取单独保留的 zip；只有 zip 的老清单则退回 windows 本身
  const portable = installKind === 'portable';
  const asset = portable ? (assets?.windowsPortable ?? assets?.windows) : assets?.windows;
  if (asset === undefined || asset.url === '') {
    return {
      kind: 'unavailable',
      reason: portable ? updateTaskCopy.noWindowsPortable : updateTaskCopy.noWindowsInstaller,
    };
  }
  if (portable) {
    const fileName = portableFileName(asset.url, asset.name);
    if (fileName === null) {
      return { kind: 'unavailable', reason: updateTaskCopy.portableNotZip };
    }
    return {
      kind: 'download',
      target: downloadTarget('windows', 'portable', asset, fileName, manifest),
    };
  }
  const fileName = installerFileName('windows', asset.url, asset.name);
  if (fileName === null) {
    return {
      kind: 'unavailable',
      reason: updateTaskCopy.installerNotFound,
    };
  }
  return {
    kind: 'download',
    target: downloadTarget('windows', 'installer', asset, fileName, manifest),
  };
}

/** 组装下载目标：渠道与安装方式之外的字段都从资产/清单里取。 */
function downloadTarget(
  platform: 'windows' | 'android',
  kind: UpdateDownloadTarget['kind'],
  asset: UpdateAsset,
  fileName: string,
  manifest: UpdateManifest | null,
): UpdateDownloadTarget {
  return {
    platform,
    kind,
    url: asset.url,
    fileName,
    size: asset.size ?? null,
    assetName: asset.name ?? fileNameFromUrl(asset.url),
    checksumsUrl: manifest?.checksumsUrl ?? null,
    sha256: asset.sha256 ?? null,
  };
}

const SHA256_TEXT = /([0-9a-f]{64})/i;

/** `sha256sum` 的一行：`<64 位 hex>  <文件名>`（文本模式两个空格，二进制模式带 `*`）。 */
const CHECKSUM_LINE = /^([0-9a-f]{64})[ \t]+\*?(.+?)\s*$/i;

/** 从裸摘要或 `摘要  文件名` 文本里取出摘要。 */
export function parseSha256(text: string): string | null {
  return SHA256_TEXT.exec(text)?.[1]?.toLowerCase() ?? null;
}

/**
 * 解析发布里的 `SHA256SUMS.txt`：返回「小写文件名 → 摘要」。
 * 以 `#` 开头的注释行与空行跳过；文件名只取最后一段，避免 `./` 或路径前缀影响匹配。
 */
export function parseChecksums(text: string): Record<string, string> {
  const table: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const matched = CHECKSUM_LINE.exec(trimmed);
    if (matched === null) continue;
    const digest = matched[1] ?? '';
    const rawName = matched[2] ?? '';
    if (digest === '' || rawName === '') continue;
    const base = rawName.split('/').pop() ?? rawName;
    table[base.toLowerCase()] = digest.toLowerCase();
  }
  return table;
}

/** 资产地址里最后一段文件名（测试桩与相对地址也能用）。 */
function fileNameFromUrl(url: string): string {
  const pathname = url.split('?')[0] ?? url;
  return pathname.split('/').pop() ?? pathname;
}

export function digestMatches(actual: string, expected: string): boolean {
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

/** 计算字节序列的 SHA-256（十六进制小写）；环境没有 WebCrypto 时抛可读错误。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error(updateTaskCopy.noSha256);
  const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
