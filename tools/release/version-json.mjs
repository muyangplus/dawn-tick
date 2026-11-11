import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 产物里的更新清单：`version.json` 升到 v2，同时承载发布信息与平台文件表。
 *
 * v2 字段：沿用旧字段（channel / version / tag / notes / artifacts），新增
 * schema=2、commit / releasedAt、files（各产物名字 / 体积 / SHA256）与
 * checksums。Android 从 0.6.12 起按 ABI 拆成两个 APK：`android` 是 arm64-v8a
 * （旧客户端仍读这个键，永远拿到 arm64 包），`android32` 是 armeabi-v7a。
 * GitHub Release 与独立 assets 仓库放同一份，客户端只维护一份清单。
 */
export const VERSION_JSON_FILE = 'version.json';
export const CHECKSUMS_FILE = 'SHA256SUMS.txt';
export const VERSION_SCHEMA = 2;
export const CHANNELS = ['release', 'beta', 'dev'];

/** 平台 → 产物后缀：发布产物名由 CI 固定，客户端按平台取值。 */
export const PLATFORM_SUFFIXES = {
  windowsSetup: '-windows-x64-setup.exe',
  windowsPortable: '-windows-x64-portable.zip',
  android: '-android-arm64-v8a.apk',
  android32: '-android-armeabi-v7a.apk',
  web: '-web.zip',
};

export const PLATFORM_KEYS = Object.keys(PLATFORM_SUFFIXES);

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** 计算文件 sha256（小写十六进制）。 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * 产物名清单：只列可直接下载的安装产物，不含清单自身、校验清单与派生的 `.sha256`。
 * 这样同一份清单在发布页与客户端读到的「有哪些产物」保持一致。
 */
export function listArtifacts(outDir) {
  return readdirSync(outDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !== VERSION_JSON_FILE &&
        entry.name !== CHECKSUMS_FILE &&
        !entry.name.endsWith('.sha256'),
    )
    .map((entry) => entry.name)
    .sort();
}

/** 从目录里按后缀挑出各产物文件名（Android 两个 ABI 各一个）；缺的键为 null。 */
export function collectPlatformFileNames(outDir) {
  const names = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const picked = {};
  for (const key of PLATFORM_KEYS) {
    picked[key] = names.find((name) => name.endsWith(PLATFORM_SUFFIXES[key])) ?? null;
  }
  return picked;
}

/**
 * 读 out/ 里各平台产物的名字、体积与 SHA256。
 * 缺任一产物都报错：半套产物发出去，该平台的更新会直接不可用。
 */
export function readPlatformFiles(outDir) {
  const names = collectPlatformFileNames(outDir);
  const missing = PLATFORM_KEYS.filter((key) => names[key] === null);
  if (missing.length > 0) {
    throw new Error(
      `缺少发布产物：${missing.join('、')}（${outDir} 里需要五个产物：Windows 安装包 / 便携包、Android arm64-v8a / armeabi-v7a、Web 包）`,
    );
  }
  const files = {};
  for (const key of PLATFORM_KEYS) {
    const name = names[key];
    const path = join(outDir, name);
    files[key] = { name, size: statSync(path).size, sha256: sha256File(path) };
  }
  return files;
}

function checkFileEntry(key, value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${key} 不是文件对象`);
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    throw new Error(`${key} 缺少文件名`);
  }
  if (!Number.isInteger(value.size) || value.size < 0) {
    throw new Error(`${key} 的 size 不是有效字节数`);
  }
  if (typeof value.sha256 !== 'string' || !SHA256_HEX.test(value.sha256)) {
    throw new Error(`${key} 的 sha256 不是 64 位十六进制`);
  }
  return { name: value.name.trim(), size: value.size, sha256: value.sha256.toLowerCase() };
}

/**
 * 生成 v2 清单：旧字段原样保留，新增 schema / files / checksums。
 *
 * `files` 由 `readPlatformFiles(outDir)` 或调用方按同一结构提供；五个产物缺一
 * 不可（`android` 固定是 arm64-v8a，`android32` 是 armeabi-v7a）。`commit` 有值时
 * 按 7 位短哈希写入（与旧 mirror.json 同一口径）。
 */
export function buildVersionManifest({
  channel,
  version,
  tag,
  notes,
  artifacts = [],
  files,
  commit = '',
  releasedAt = Date.now(),
}) {
  if (!CHANNELS.includes(channel)) throw new Error(`未知渠道: ${channel}`);
  if (typeof version !== 'string' || version.trim().length === 0) throw new Error('版本号不能为空');
  if (typeof tag !== 'string' || tag.trim().length === 0) throw new Error('标签不能为空');
  if (typeof notes !== 'string' || notes.trim().length === 0) throw new Error('发布说明不能为空');
  if (typeof releasedAt !== 'number' || !Number.isFinite(releasedAt) || releasedAt <= 0) {
    throw new Error('releasedAt 不是有效毫秒时间戳');
  }
  if (typeof files !== 'object' || files === null) throw new Error('缺少 files（五个产物，含两个 Android ABI 包）');
  const missing = PLATFORM_KEYS.filter((key) => files[key] === undefined || files[key] === null);
  if (missing.length > 0) throw new Error(`缺少发布产物：${missing.join('、')}`);
  const platformFiles = {};
  for (const key of PLATFORM_KEYS) platformFiles[key] = checkFileEntry(key, files[key]);

  const names = [...new Set(artifacts.map((name) => String(name).trim()))]
    .filter((name) => name.length > 0)
    .sort();
  const shortCommit = typeof commit === 'string' ? commit.trim().slice(0, 7) : '';
  return {
    schema: VERSION_SCHEMA,
    channel,
    version: version.trim(),
    tag: tag.trim(),
    ...(shortCommit === '' ? {} : { commit: shortCommit }),
    releasedAt,
    notes: notes.trim(),
    artifacts: names,
    files: platformFiles,
    checksums: CHECKSUMS_FILE,
  };
}

/** 写入 `<outDir>/version.json`（v2），返回写入的内容。 */
export function writeVersionJson({
  outDir = 'out',
  channel,
  version,
  tag,
  notes,
  artifacts = listArtifacts(outDir),
  files = readPlatformFiles(outDir),
  commit = '',
  releasedAt = Date.now(),
}) {
  const manifest = buildVersionManifest({ channel, version, tag, notes, artifacts, files, commit, releasedAt });
  writeFileSync(join(outDir, VERSION_JSON_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/version-json.mjs');
if (invokedDirectly) {
  const args = new Map();
  for (const raw of process.argv.slice(2)) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    args.set(key, rest.join('='));
  }
  const outDir = args.get('out') ?? 'out';
  const notesFile = args.get('notes-file');
  const notes = notesFile === undefined ? (args.get('notes') ?? '') : readFileSync(notesFile, 'utf8');
  const releasedAt = args.has('released-at') ? Number(args.get('released-at')) : Date.now();
  const manifest = writeVersionJson({
    outDir,
    channel: args.get('channel') ?? '',
    version: args.get('version') ?? '',
    tag: args.get('tag') ?? '',
    notes,
    commit: args.get('commit') ?? '',
    releasedAt,
  });
  process.stdout.write(
    `写入 ${join(outDir, VERSION_JSON_FILE)}（v2，${manifest.artifacts.length} 个产物，${PLATFORM_KEYS.length} 个平台文件）\n`,
  );
}
