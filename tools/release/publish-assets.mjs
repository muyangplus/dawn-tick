/**
 * 把本次构建产物推送到独立 assets 仓库（`muyangplus/dawn-tick-assets`）。
 *
 * 为什么独立仓库：Gitee Releases/API 在 GitHub Actions 的网络下实测超时，
 * 附件还有容量与数量限制；产物改放 GitHub 上的独立仓库后，Gitee 侧只需要
 * 从 GitHub 镜像这个仓库（拉取式），客户端从两边 raw 读同一份文件。
 *
 * 布局：按渠道用三条单提交分支 `dev` / `beta` / `release`，每次发布
 * `--orphan` 新建单提交再 force-push，天然只保留该渠道最新一套，仓库体积可控。
 * 每条分支固定包含：
 *   DawnTick-<版本>-<渠道>-windows-x64-setup.exe
 *   DawnTick-<版本>-<渠道>-windows-x64-portable.zip
 *   DawnTick-<版本>-<渠道>-android-arm64-v8a.apk
 *   DawnTick-<版本>-<渠道>-android-armeabi-v7a.apk
 *   DawnTick-<版本>-<渠道>-web.zip
 *   SHA256SUMS.txt（发布步骤已生成）
 *   version.json（发布步骤已生成：v2，客户端取源、下载与校验的唯一清单）
 *
 * 本脚本不再生成 mirror.json：只校验并原样复制 version.json，保证 GitHub Release
 * 与 assets 仓库用的是同一份清单。校验失败（缺文件、体积 / SHA256 不符、schema
 * 不是 2）直接报错，不把不一致的清单推到客户端。
 *
 * 用法（CI）：
 *   OUT_DIR=out CHANNEL=beta TAG=v0.6.6 \
 *   ASSETS_TOKEN=... ASSETS_REPO=muyangplus/dawn-tick-assets \
 *   node tools/release/publish-assets.mjs
 *
 * 约定：
 * - 只依赖 Node 内置模块与系统 git，不引第三方库；
 * - token 只从环境变量读，日志与报错里一律替换成 ***；
 * - 未配置 ASSETS_TOKEN 时明确跳过（返回 0），fork / 本地预览不需要该 secret；
 * - 仓库不存在时给出「先创建 public 仓库」的可读错误，不静默失败。
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKSUMS_FILE,
  PLATFORM_KEYS,
  PLATFORM_SUFFIXES,
  VERSION_JSON_FILE,
  VERSION_SCHEMA,
  sha256File,
} from './version-json.mjs';

export const VERSION_FILE = VERSION_JSON_FILE;
export const DEFAULT_ASSETS_REPO = 'muyangplus/dawn-tick-assets';
export const CHANNELS = ['dev', 'beta', 'release'];

/** 渠道 → assets 仓库分支：三条分支各自只留该渠道最新一套文件。 */
export const CHANNEL_BRANCH = { dev: 'dev', beta: 'beta', release: 'release' };

/** 需要同步的产物后缀：与发布步骤的 out/ 一致。 */
export const ASSET_SUFFIXES = PLATFORM_KEYS.map((key) => PLATFORM_SUFFIXES[key]);

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** 渠道名 → 分支名；未知渠道直接报错（避免把产物推到意料之外的分支）。 */
export function channelBranch(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`未知渠道：${channel}（可选 ${CHANNELS.join(' / ')}）`);
  return CHANNEL_BRANCH[channel];
}

/** 从 out/ 挑出要推送的文件并补上体积与摘要（跳过目录、临时文件与旧 mirror.json）。 */
export function selectAssets(dir) {
  return readdirSync(dir)
    .filter((name) => {
      if (!statSync(join(dir, name)).isFile()) return false;
      if (name === CHECKSUMS_FILE || name === VERSION_FILE) return true;
      return ASSET_SUFFIXES.some((suffix) => name.endsWith(suffix));
    })
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return { name, path, size: statSync(path).size, sha256: sha256File(path) };
    });
}

/** 读 out/version.json：缺失或不是 JSON 时给出可读错误。 */
export function readVersionJson(dir) {
  const path = join(dir, VERSION_FILE);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`缺少 ${VERSION_FILE}：${path}（先运行 tools/release/version-json.mjs）`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${VERSION_FILE} 不是合法 JSON：${path}`);
  }
}

function asRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value;
}

/**
 * 校验 version.json v2 与 out/ 中的实际文件一致：
 * schema=2、五个产物齐全（Android 两个 ABI 包）、名字后缀对应平台、体积与 SHA256
 * 和本地文件相同、校验清单存在。返回归一化后的清单（供调用方读 version / tag）。
 */
export function validateVersionJson(manifest, files) {
  const record = asRecord(manifest);
  if (record === null) throw new Error(`${VERSION_FILE} 不是对象`);
  if (record.schema !== VERSION_SCHEMA) {
    throw new Error(`${VERSION_FILE} 的 schema 不是 ${VERSION_SCHEMA}（需要 v2 清单）`);
  }
  if (!CHANNELS.includes(record.channel)) throw new Error(`未知渠道：${record.channel}`);
  if (typeof record.version !== 'string' || record.version.trim() === '') throw new Error('缺少版本号');
  if (typeof record.tag !== 'string' || record.tag.trim() === '') throw new Error('缺少标签');
  if (record.checksums !== CHECKSUMS_FILE) {
    throw new Error(`${VERSION_FILE} 的 checksums 不是 ${CHECKSUMS_FILE}`);
  }
  const filesRecord = asRecord(record.files);
  if (filesRecord === null) throw new Error(`${VERSION_FILE} 缺少 files`);

  const byName = new Map(files.map((file) => [file.name, file]));
  const normalized = {};
  const missing = [];
  for (const key of PLATFORM_KEYS) {
    const entry = asRecord(filesRecord[key]);
    if (entry === null) {
      missing.push(key);
      continue;
    }
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Error(`${VERSION_FILE} 缺少文件 ${key} 的 name`);
    }
    if (!Number.isInteger(entry.size) || entry.size < 0) {
      throw new Error(`${key} 的 size 不是有效字节数`);
    }
    if (typeof entry.sha256 !== 'string' || !SHA256_HEX.test(entry.sha256)) {
      throw new Error(`${key} 的 sha256 不是 64 位十六进制`);
    }
    if (!entry.name.endsWith(PLATFORM_SUFFIXES[key])) {
      throw new Error(`${key} 的文件名 ${entry.name} 不是 ${PLATFORM_SUFFIXES[key]} 产物`);
    }
    const actual = byName.get(entry.name);
    if (actual === undefined) {
      missing.push(key);
      continue;
    }
    if (actual.size !== entry.size) {
      throw new Error(
        `发布产物 ${entry.name} 的体积与 ${VERSION_FILE} 不一致（清单 ${entry.size}，实际 ${actual.size}）`,
      );
    }
    if (actual.sha256 !== entry.sha256.toLowerCase()) {
      throw new Error(`发布产物 ${entry.name} 的 SHA256 与 ${VERSION_FILE} 不一致`);
    }
    normalized[key] = { name: entry.name.trim(), size: entry.size, sha256: entry.sha256.toLowerCase() };
  }
  if (missing.length > 0) {
    throw new Error(`缺少发布产物：${missing.join('、')}（渠道 ${record.channel}）`);
  }
  if (!byName.has(CHECKSUMS_FILE)) throw new Error(`缺少 ${CHECKSUMS_FILE}`);
  return { ...record, files: normalized };
}

/** 读并校验 out/version.json，返回 v2 清单。 */
export function loadVersionJson(dir) {
  return validateVersionJson(readVersionJson(dir), selectAssets(dir));
}

/** 把 token 从任意文本里抹掉：git 报错常回显带凭据的远端地址。 */
export function redact(text, token) {
  if (typeof token !== 'string' || token === '') return text;
  return String(text).split(token).join('***');
}

/** GitHub 对不存在/无权限的私有仓库都回 `Repository not found`：给出建仓提示。 */
export function describeGitFailure(output, repo = DEFAULT_ASSETS_REPO) {
  if (/repository not found|could not read from remote repository|not found/i.test(output)) {
    return (
      `assets 仓库不存在或无权访问：${repo}。` +
      `请先在 GitHub 创建 public 仓库 ${DEFAULT_ASSETS_REPO}，并确认 ASSETS_TOKEN 有 contents 写权限`
    );
  }
  return `推送 assets 仓库失败：${output.trim() || 'git 未返回原因'}`;
}

/** 执行一条 git 命令；失败时抛带干净输出的错误（token 不外泄）。 */
export function runGit(args, { cwd, token, repo = DEFAULT_ASSETS_REPO }) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.status !== 0) {
    const output = redact(`${result.stdout ?? ''}${result.stderr ?? ''}`, token);
    throw new Error(describeGitFailure(output, repo));
  }
  return result.stdout ?? '';
}

/** 远端地址：用 x-access-token 形式，token 只出现在这一条命令里。 */
export function remoteUrl(repo, token) {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

/**
 * 推送到 assets 仓库对应渠道分支（单提交 force-push）。
 *
 * 只复制 out/ 里已通过 v2 校验的文件，不生成任何派生清单；`tag` 给出时会与
 * version.json 的 tag 比对，防止把别的渠道 / 版本推到当前分支。
 *
 * @returns {{ skipped: boolean, branch?: string, files?: number, bytes?: number, version?: string }}
 */
export function publishAssets({
  outDir = 'out',
  channel,
  tag = '',
  token = '',
  repo = DEFAULT_ASSETS_REPO,
  dryRun = false,
  run = runGit,
}) {
  if (token === '' && !dryRun) {
    console.log('未配置 ASSETS_TOKEN，跳过 assets 仓库同步（GitHub Release 已照常发布）');
    return { skipped: true };
  }
  const branch = channelBranch(channel);
  const manifest = loadVersionJson(outDir);
  if (manifest.channel !== channel) {
    throw new Error(`${VERSION_FILE} 的渠道 ${manifest.channel} 与本次渠道 ${channel} 不一致`);
  }
  if (tag !== '' && manifest.tag !== tag) {
    throw new Error(`${VERSION_FILE} 的标签 ${manifest.tag} 与本次标签 ${tag} 不一致`);
  }
  const pushed = selectAssets(outDir);
  const bytes = pushed.reduce((total, file) => total + file.size, 0);
  if (dryRun) {
    console.log(
      `dry-run：${repo}#${branch}，${pushed.length} 个文件 / ${bytes} 字节，version.json v2 校验通过（${manifest.version} / ${manifest.tag}）`,
    );
    return { skipped: false, dryRun: true, branch, files: pushed.length, bytes, version: manifest.version };
  }

  // 临时目录独立于主仓库：产物绝不进入 dawn-tick 工作区
  const staging = mkdtempSync(join(tmpdir(), 'dawn-tick-assets-'));
  const remote = remoteUrl(repo, token);
  const git = (args) => run(args, { cwd: staging, token, repo });

  git(['init', '--quiet']);
  git(['checkout', '--orphan', branch]);
  for (const file of pushed) {
    writeFileSync(join(staging, file.name), readFileSync(file.path));
  }
  git(['add', '--all']);
  git([
    '-c',
    'user.name=dawn-tick-ci',
    '-c',
    'user.email=ci@dawn-tick.invalid',
    'commit',
    '--quiet',
    '-m',
    `release: ${branch} ${manifest.version}（${manifest.tag}）`,
  ]);
  git(['push', '--force', remote, `HEAD:refs/heads/${branch}`]);

  console.log(`assets 仓库已更新：${repo}#${branch}，${pushed.length} 个文件 / ${bytes} 字节`);
  return { skipped: false, branch, files: pushed.length, bytes, version: manifest.version };
}

function parseArgs() {
  return new Map(
    process.argv
      .slice(2)
      .filter((item) => item.startsWith('--'))
      .map((raw) => {
        const [key, ...rest] = raw.replace(/^--/, '').split('=');
        return [key, rest.join('=')];
      }),
  );
}

function main() {
  const args = parseArgs();
  const outDir = args.get('out') ?? process.env.OUT_DIR ?? 'out';
  const channel = args.get('channel') ?? process.env.CHANNEL ?? '';
  const tag = args.get('tag') ?? process.env.TAG ?? '';
  const token = process.env.ASSETS_TOKEN ?? '';
  const repo = process.env.ASSETS_REPO ?? DEFAULT_ASSETS_REPO;
  if (channel === '') throw new Error('缺少渠道：--channel 或 CHANNEL');
  const result = publishAssets({ outDir, channel, tag, token, repo, dryRun: args.has('dry-run') });
  if (result.skipped) console.log('assets 同步已跳过');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/publish-assets.mjs');
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`assets 仓库同步失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
