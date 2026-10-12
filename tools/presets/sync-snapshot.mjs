#!/usr/bin/env node
/**
 * sync-snapshot.mjs —— 把预设仓库的真实快照同步进主仓库（内置快照）。
 *
 * 用法：
 *   node tools/presets/sync-snapshot.mjs --from "E:/work/dsh/dawn-tick-presets"
 *   node tools/presets/sync-snapshot.mjs --from <预设仓库> --version 1.0.1
 *   node tools/presets/sync-snapshot.mjs --from <预设仓库> --check   # 只校验不写盘
 *   node tools/presets/sync-snapshot.mjs --from <预设仓库> --out <目录>   # 写到别的目录（文件名不变）
 *
 * 读什么：
 *   <预设仓库>/version.json                     → 版本与 schemaVersion（--version 缺省时取这里的 version）
 *   <预设仓库>/snapshot/presets-<version>.json  → 快照原文（含 hash 与 generatedAt）
 * 写什么（默认目录见下；给了 --out 就写到那个目录，两个文件名不变）：
 *   <输出目录>/builtin-preset-snapshot.json   ← 快照**原文逐字节复制**
 *   <输出目录>/preset-version.json            ← { version, schemaVersion }
 *   默认输出目录 = packages/core/src/config（主仓库内置配置，即现状行为）。
 *
 * 为什么要 --out：测试与试跑要能真的落盘、又**绝不能碰真实内置配置**。
 * 给了 --out 就只在那一个目录里写（目录不存在时按需创建），
 * `--check` 则改为拿该目录里的两份文件做比对，语义仍是「只校验不写盘、一个文件都不写」。
 *
 * 规矩（重要）：**预设仓库是内容的唯一来源**。改了预设仓库里的 timetables / systems / adapters，
 * 必须先在预设仓库跑 `node scripts/snapshot.mjs` 生成新快照，再回来跑本脚本同步；
 * 本脚本只做「校验 + 复制」，绝不重新生成时间戳、也绝不改写 hash。
 *
 * 失败即不落盘：目录不存在、快照缺失、hash 不符、文件清单对不上内置配置，
 * 都会打印中文错误并以非 0 退出，且**一个文件都不写**。
 *
 * 幂等：内容一致时报告「未变化」，不触碰文件（不改 mtime），因此连跑两次 git status 干净。
 *
 * 零依赖：只用 Node 内置模块。哈希口径直接 import 自 core 的唯一实现
 * （`packages/core/src/config/preset-hash.ts`；Node 24 能直接 import .ts，无需构建），
 * 所以「脚本复算」「Web 端校验」「内置自检」三处永远是同一份代码。
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPresetJson, sha256HexSync } from '../../packages/core/src/config/preset-hash.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
/** 默认输出目录：主仓库的内置配置目录。两个目标文件名固定不变。 */
const DEFAULT_OUT_DIR = join(REPO_ROOT, 'packages', 'core', 'src', 'config');
const SNAPSHOT_FILE_NAME = 'builtin-preset-snapshot.json';
const PRESET_VERSION_FILE_NAME = 'preset-version.json';

/** 对字符串做 sha256，返回 "sha256:<hex>"（与预设仓库 snapshot.mjs 的 sha256 同口径）。 */
export function sha256(text) {
  return `sha256:${sha256HexSync(text)}`;
}

/**
 * 规范化 JSON 序列化：对象键排序、数组保持顺序、无多余空白。
 * 直接转出 core 的实现（与预设仓库 scripts/snapshot.mjs 的 canonicalJson 逐字一致）。
 */
export const canonicalJson = canonicalPresetJson;

/** 复算快照的内容哈希，返回 "sha256:<hex>"。 */
export function computeSnapshotHash(snapshot) {
  const { hash: _ignored, ...unsigned } = snapshot;
  return sha256(canonicalJson(unsigned));
}

/** 同步脚本自己的失败类型：只带一句中文说明，调用方直接打印。 */
export class SyncError extends Error {}

function fail(message) {
  throw new SyncError(message);
}

/** 读一个必须存在的 JSON 文件；解析失败也当作错误抛出。 */
function readJsonFile(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    fail(`无法读取${label}：${path}（${cause instanceof Error ? cause.message : String(cause)}）`);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    fail(`${label}不是合法 JSON：${path}（${cause instanceof Error ? cause.message : String(cause)}）`);
  }
}

/** 解析 `--from <目录>` / `--version <版本>` / `--out <目录>` / `--check`。 */
export function parseArgs(argv) {
  const options = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from') {
      options.from = argv[index + 1];
      index += 1;
    } else if (arg === '--version') {
      options.version = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      // 缺值时记成空串（而不是 undefined），这样「--out 后面没跟目录」会被当成错误，
      // 而不是悄悄退回默认输出目录去写真实内置配置。
      options.out = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--check') {
      options.check = true;
    }
  }
  return options;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}应为非空字符串`);
  return value.trim();
}

/** 校验快照自身：结构、hash 格式、复算哈希。返回版本信息。 */
function verifySnapshot(snapshot, snapshotPath) {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    fail(`快照应为对象：${snapshotPath}`);
  }
  const version = requireText(snapshot.version, '快照的 version');
  if (!Number.isInteger(snapshot.schemaVersion)) {
    fail(`快照的 schemaVersion 应为整数：${String(snapshot.schemaVersion)}`);
  }
  if (typeof snapshot.hash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(snapshot.hash.trim().toLowerCase())) {
    fail(`快照的 hash 格式不合法：${String(snapshot.hash)}`);
  }
  const sources = snapshot.sources;
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) {
    fail('快照缺少 sources');
  }
  if (!Array.isArray(sources.timetables)) fail('快照的 sources.timetables 应为数组');
  if (!Array.isArray(sources.systems)) fail('快照的 sources.systems 应为数组');

  const declared = snapshot.hash.trim().toLowerCase();
  const recomputed = computeSnapshotHash(snapshot);
  if (recomputed !== declared) {
    fail(`快照哈希校验未通过：声明 ${declared}，复算 ${recomputed}（${snapshotPath}）`);
  }
  return { version, schemaVersion: snapshot.schemaVersion, declared, recomputed };
}

/**
 * 内置配置的 id 清单（timetables.json / systems.json 是数组）。
 * 只用于「快照清单与内置配置不得漂移」这一层护栏，内容级一致性由 core 的单测守着。
 */
function builtinIds(relativePath, label) {
  const path = join(REPO_ROOT, 'packages', 'core', 'src', 'config', relativePath);
  const data = readJsonFile(path, label);
  if (!Array.isArray(data)) fail(`${label}应为数组：${path}`);
  return data.map((entry, index) => requireText(entry?.id, `${label} #${index + 1} 的 id`));
}

/** 对比快照清单与内置配置的 id 集合（顺序不比：快照按文件名排序，内置顺序是识别优先级）。 */
function compareSourceIds(snapshot, hostLabel) {
  const groups = [
    { listed: snapshot.sources.timetables, builtinFile: 'timetables.json', label: '作息表' },
    { listed: snapshot.sources.systems, builtinFile: 'systems.json', label: '教务系统' },
  ];
  for (const group of groups) {
    const listedIds = group.listed.map((item, index) => requireText(item?.id, `快照 ${group.label} #${index + 1} 的 id`));
    const builtin = builtinIds(group.builtinFile, `内置 ${group.builtinFile}`);
    const missing = listedIds.filter((id) => !builtin.includes(id));
    const extra = builtin.filter((id) => !listedIds.includes(id));
    if (missing.length > 0 || extra.length > 0) {
      fail(
        `${hostLabel}与内置 ${group.builtinFile} 的${group.label}清单不一致：` +
          `快照多出 [${missing.join(', ')}]，内置多出 [${extra.join(', ')}]。` +
          '请先在预设仓库同步内容并重新生成快照，再跑本脚本。',
      );
    }
  }
}

/** 写出文件；内容一致时返回 false（不触碰文件，保证幂等）。 */
function writeIfChanged(path, text) {
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (previous === text) return false;
  writeFileSync(path, text, 'utf8');
  return true;
}

const summary = [];
function note(line) {
  summary.push(`  ${line}`);
}

/**
 * 同步一次。成功返回 0；失败抛 SyncError（由 main 收敛为中文错误 + 非 0 退出）。
 *
 * 落盘顺序：先算出两份文件的**全部内容**，再写。任何校验失败都发生在写之前，
 * 所以「出错不写文件」是结构性保证，而不是靠事后回滚。
 */
export function syncSnapshot(options) {
  summary.length = 0;
  const rawFrom = requireText(options.from, '--from 参数（预设仓库根目录）');
  const from = resolve(rawFrom);
  if (!existsSync(from)) fail(`预设仓库目录不存在：${from}`);
  if (!statSync(from).isDirectory()) fail(`--from 指向的不是目录：${from}`);

  // 输出目录：默认是主仓库的内置配置目录；给了 --out 就只写那一个目录（文件名不变）。
  // 这里先把目录本身校验完，后面所有落盘都只碰这两个算好的路径。
  const outDir =
    options.out === undefined
      ? DEFAULT_OUT_DIR
      : resolve(requireText(options.out, '--out 参数（输出目录）'));
  if (existsSync(outDir) && !statSync(outDir).isDirectory()) fail(`--out 指向的不是目录：${outDir}`);
  const snapshotOutPath = join(outDir, SNAPSHOT_FILE_NAME);
  const versionOutPath = join(outDir, PRESET_VERSION_FILE_NAME);

  const presetVersionPath = join(from, 'version.json');
  if (!existsSync(presetVersionPath)) fail(`预设仓库缺少 version.json：${presetVersionPath}`);
  const presetVersion = readJsonFile(presetVersionPath, '预设仓库 version.json');
  const declaredVersion = requireText(presetVersion.version, 'version.json 的 version');
  const declaredSchemaVersion = presetVersion.schemaVersion;
  if (!Number.isInteger(declaredSchemaVersion)) {
    fail(`version.json 的 schemaVersion 应为整数：${String(declaredSchemaVersion)}`);
  }

  // --version 缺省时取 version.json 的版本；显式传了就必须真的存在那个快照
  const version = options.version === undefined || options.version === ''
    ? declaredVersion
    : requireText(options.version, '--version 参数');
  if (options.version !== undefined && options.version !== '' && version !== declaredVersion) {
    note(`注意：--version ${version} 与预设仓库 version.json（${declaredVersion}）不同，按 --version 取快照`);
  }

  const snapshotPath = join(from, 'snapshot', `presets-${version}.json`);
  if (!existsSync(snapshotPath)) fail(`预设仓库缺少该版本的快照：${snapshotPath}`);
  const snapshotText = readFileSync(snapshotPath, 'utf8');
  let snapshot;
  try {
    snapshot = JSON.parse(snapshotText);
  } catch (cause) {
    fail(`快照不是合法 JSON：${snapshotPath}（${cause instanceof Error ? cause.message : String(cause)}）`);
  }

  const info = verifySnapshot(snapshot, snapshotPath);
  if (info.version !== version) {
    fail(`快照内的 version（${info.version}）与请求的版本（${version}）不一致：${snapshotPath}`);
  }
  if (info.schemaVersion !== declaredSchemaVersion) {
    fail(
      `快照的 schemaVersion（${info.schemaVersion}）与 version.json（${declaredSchemaVersion}）不一致：${snapshotPath}`,
    );
  }
  compareSourceIds(snapshot, `快照 ${version}`);

  // 两份目标文件的内容：快照原文逐字节复制；版本文件只留 version + schemaVersion
  const nextSnapshotText = snapshotText;
  const nextVersionText = `${JSON.stringify({ version, schemaVersion: info.schemaVersion }, null, 2)}\n`;

  note(`来源：${from}`);
  note(
    `输出目录：${rel(outDir)}${outDir === DEFAULT_OUT_DIR ? '（主仓库内置配置，默认）' : '（--out 指定）'}`,
  );
  note(`目标文件：${rel(snapshotOutPath)}、${rel(versionOutPath)}`);
  note(`版本：${version}（schemaVersion ${info.schemaVersion}）`);
  note(`生成时间：${typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : '（快照未记录）'}`);
  note(`内容哈希：${info.declared}（已复算一致）`);
  note(
    `内容清单：作息表 ${snapshot.sources.timetables.length} 个` +
      `（${snapshot.sources.timetables.map((item) => item.id).join('、')}）` +
      `，教务系统 ${snapshot.sources.systems.length} 个` +
      `（${snapshot.sources.systems.map((item) => item.id).join('、')}）`,
  );

  if (options.check === true) {
    // --check 只读：比对的是「本次会写出的目标」，给了 --out 就比对那个目录，
    // 不创建目录、不写任何文件。
    const currentSnapshotText = existsSync(snapshotOutPath) ? readFileSync(snapshotOutPath, 'utf8') : null;
    const currentVersionText = existsSync(versionOutPath) ? readFileSync(versionOutPath, 'utf8') : null;
    const inSync = currentSnapshotText === nextSnapshotText && currentVersionText === nextVersionText;
    note(`--check：${rel(outDir)} 里的内置快照${inSync ? '已是最新，无需同步' : '与预设仓库不一致，需要同步'}`);
    return { version, hash: info.declared, wrote: [], inSync };
  }

  // 目录不存在时按需创建——只发生在「校验全部通过、马上要写」这一刻
  mkdirSync(outDir, { recursive: true });

  const wrote = [];
  if (writeIfChanged(snapshotOutPath, nextSnapshotText)) wrote.push(snapshotOutPath);
  else note(`未变化：${rel(snapshotOutPath)}（内容一致，未触碰文件）`);
  if (writeIfChanged(versionOutPath, nextVersionText)) wrote.push(versionOutPath);
  else note(`未变化：${rel(versionOutPath)}（内容一致，未触碰文件）`);

  for (const path of wrote) note(`已写入：${rel(path)}`);
  return { version, hash: info.declared, wrote, inSync: wrote.length === 0 };
}

function rel(path) {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1).split(sep).join('/') : path;
}

/** CLI 入口：打印中文摘要，返回进程退出码。 */
export function main(argv = process.argv.slice(2)) {
  let result;
  try {
    result = syncSnapshot(parseArgs(argv));
  } catch (cause) {
    if (cause instanceof SyncError) {
      process.stderr.write('=== 预设快照同步失败 ===\n');
      process.stderr.write(`  ${cause.message}\n`);
      process.stderr.write('  未写入任何文件。\n');
      return 1;
    }
    process.stderr.write(`=== 预设快照同步失败 ===\n  未预期的错误：${cause?.stack ?? cause}\n  未写入任何文件。\n`);
    return 1;
  }

  process.stdout.write('=== 预设快照同步 ===\n');
  process.stdout.write(`${summary.join('\n')}\n`);
  if (result.wrote.length === 0) {
    // 措辞与「写到哪个目录」无关：默认目录与 --out 目录都用这一句
    process.stdout.write('  结果：输出目录已是最新，未改动任何文件（幂等）\n');
  } else {
    process.stdout.write(`  结果：已更新 ${result.wrote.length} 个文件\n`);
  }
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main();
}
