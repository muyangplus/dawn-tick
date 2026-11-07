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
 *   DawnTick-<版本>-<渠道>-windows-x64-portable.zip
 *   DawnTick-<版本>-<渠道>-windows-x64-setup.exe
 *   DawnTick-<版本>-<渠道>-android.apk
 *   DawnTick-<版本>-<渠道>-web.zip
 *   SHA256SUMS.txt（发布步骤已生成）
 *   version.json（发布步骤已生成）
 *   mirror.json（本脚本生成：客户端取源与下载的唯一清单）
 *
 * 用法（CI）：
 *   OUT_DIR=out CHANNEL=beta TAG=v0.6.6 VERSION=0.6.6 GITHUB_SHA=abc1234 \
 *   ASSETS_TOKEN=... ASSETS_REPO=muyangplus/dawn-tick-assets \
 *   NOTES_FILE=$RUNNER_TEMP/release-notes.md node tools/release/publish-assets.mjs
 *
 * 约定：
 * - 只依赖 Node 内置模块与系统 git，不引第三方库；
 * - token 只从环境变量读，日志与报错里一律替换成 ***；
 * - 未配置 ASSETS_TOKEN 时明确跳过（返回 0），fork / 本地预览不需要该 secret；
 * - 仓库不存在时给出「先创建 public 仓库」的可读错误，不静默失败。
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MIRROR_FILE = 'mirror.json';
export const VERSION_FILE = 'version.json';
export const CHECKSUMS_FILE = 'SHA256SUMS.txt';
export const DEFAULT_ASSETS_REPO = 'muyangplus/dawn-tick-assets';
export const DEFAULT_GITHUB_REPO = 'muyangplus/dawn-tick';
export const CHANNELS = ['dev', 'beta', 'release'];

/** 渠道 → assets 仓库分支：三条分支各自只留该渠道最新一套文件。 */
export const CHANNEL_BRANCH = { dev: 'dev', beta: 'beta', release: 'release' };

/** 需要同步的产物：与发布步骤的 out/ 一致。 */
export const ASSET_SUFFIXES = [
  '-windows-x64-setup.exe',
  '-windows-x64-portable.zip',
  '-android.apk',
  '-web.zip',
];

/** 渠道名 → 分支名；未知渠道直接报错（避免把产物推到意料之外的分支）。 */
export function channelBranch(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`未知渠道：${channel}（可选 ${CHANNELS.join(' / ')}）`);
  return CHANNEL_BRANCH[channel];
}

/** 计算文件 sha256（小写十六进制）。 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 从 out/ 挑出要推送的文件并补上体积与摘要（跳过目录与临时文件）。 */
export function selectAssets(dir) {
  return readdirSync(dir)
    .filter((name) => {
      const path = join(dir, name);
      if (!statSync(path).isFile()) return false;
      if (name === CHECKSUMS_FILE || name === VERSION_FILE || name === MIRROR_FILE) return true;
      return ASSET_SUFFIXES.some((suffix) => name.endsWith(suffix));
    })
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return { name, path, size: statSync(path).size, sha256: sha256File(path) };
    });
}

/** 按平台把产物名映射到 mirror.json 的 files 键。 */
function platformFiles(files) {
  const pick = (suffix) => files.find((file) => file.name.endsWith(suffix));
  const entry = (file) => (file === undefined ? null : { name: file.name, size: file.size, sha256: file.sha256 });
  return {
    windowsSetup: entry(pick('-windows-x64-setup.exe')),
    windowsPortable: entry(pick('-windows-x64-portable.zip')),
    android: entry(pick('-android.apk')),
    web: entry(pick('-web.zip')),
  };
}

/** 缺哪些必需产物：返回键名列表，空数组表示齐全。 */
export function missingPlatforms(files) {
  const mapped = platformFiles(files);
  return Object.entries(mapped)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

/**
 * 生成 mirror.json：客户端据此拼绝对 URL、选便携/安装包并按 sha256 校验。
 * 四个平台缺任一都报错：半套产物发出去客户端只会拿到不可用的更新。
 */
export function buildMirrorJson({ channel, version, tag, commit = '', releasedAt = Date.now(), notes = '', files }) {
  const branch = channelBranch(channel);
  if (typeof version !== 'string' || version.trim() === '') throw new Error('缺少版本号');
  if (typeof tag !== 'string' || tag.trim() === '') throw new Error('缺少标签');
  const missing = missingPlatforms(files);
  if (missing.length > 0) throw new Error(`缺少发布产物：${missing.join('、')}（渠道 ${branch}）`);
  const shortCommit = typeof commit === 'string' ? commit.trim().slice(0, 7) : '';
  return {
    schema: 1,
    channel,
    version: version.trim(),
    tag: tag.trim(),
    commit: shortCommit,
    releasedAt,
    notes: typeof notes === 'string' ? notes.trim() : '',
    files: platformFiles(files),
    checksums: CHECKSUMS_FILE,
  };
}

/** 读发布说明：优先 GitHub Release 正文（含 Full Changelog），缺失时退回 NOTES_FILE / version.json。 */
export function readNotes(notesFile, outDir) {
  if (typeof notesFile === 'string' && notesFile !== '') {
    try {
      return readFileSync(notesFile, 'utf8');
    } catch {
      // 文件不存在时继续尝试 version.json
    }
  }
  try {
    const manifest = JSON.parse(readFileSync(join(outDir, VERSION_FILE), 'utf8'));
    return typeof manifest?.notes === 'string' ? manifest.notes : '';
  } catch {
    return '';
  }
}

/**
 * 读已发布 Release 的正文：Full Changelog 由 publish.sh 拼进正文、不在 NOTES_FILE 里，
 * mirror.json 的 notes 要与 Release 一致。拿不到（本地/网络异常）返回 null。
 */
export async function fetchReleaseBody({
  repo = DEFAULT_GITHUB_REPO,
  tag,
  token = '',
  timeoutMs = 10_000,
} = {}) {
  if (typeof tag !== 'string' || tag === '') return null;
  const headers = { accept: 'application/vnd.github+json' };
  if (token !== '') headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.body === 'string' && body.body.trim() !== '' ? body.body : null;
  } catch {
    return null;
  }
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
 * @returns {{ skipped: boolean, branch?: string, files?: number, bytes?: number }}
 */
export function publishAssets({
  outDir = 'out',
  channel,
  tag,
  version,
  commit = '',
  notes = '',
  token = '',
  repo = DEFAULT_ASSETS_REPO,
  releasedAt = Date.now(),
  dryRun = false,
  run = runGit,
}) {
  if (token === '' && !dryRun) {
    console.log('未配置 ASSETS_TOKEN，跳过 assets 仓库同步（GitHub Release 已照常发布）');
    return { skipped: true };
  }
  const branch = channelBranch(channel);
  const files = selectAssets(outDir);
  const mirror = buildMirrorJson({ channel, version, tag, commit, releasedAt, notes, files });
  const mirrorPath = join(outDir, MIRROR_FILE);
  writeFileSync(mirrorPath, `${JSON.stringify(mirror, null, 2)}\n`);
  const pushed = [...selectAssets(outDir)];
  const bytes = pushed.reduce((total, file) => total + file.size, 0);
  if (dryRun) {
    console.log(`dry-run：${repo}#${branch}，${pushed.length} 个文件 / ${bytes} 字节，mirror.json 已写入 ${mirrorPath}`);
    return { skipped: false, dryRun: true, branch, files: pushed.length, bytes };
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
    `release: ${branch} ${mirror.version}（${mirror.tag}）`,
  ]);
  git(['push', '--force', remote, `HEAD:refs/heads/${branch}`]);

  console.log(`assets 仓库已更新：${repo}#${branch}，${pushed.length} 个文件 / ${bytes} 字节`);
  return { skipped: false, branch, files: pushed.length, bytes };
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

async function main() {
  const args = parseArgs();
  const outDir = args.get('out') ?? process.env.OUT_DIR ?? 'out';
  const channel = args.get('channel') ?? process.env.CHANNEL ?? '';
  const tag = args.get('tag') ?? process.env.TAG ?? '';
  const version = args.get('version') ?? process.env.VERSION ?? '';
  const token = process.env.ASSETS_TOKEN ?? '';
  const repo = process.env.ASSETS_REPO ?? DEFAULT_ASSETS_REPO;
  const githubRepo = process.env.GITHUB_REPO ?? DEFAULT_GITHUB_REPO;
  const ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  const notesFile = args.get('notes-file') ?? process.env.NOTES_FILE ?? '';
  if (tag === '') throw new Error('缺少标签：--tag 或 TAG');
  if (version === '') throw new Error('缺少版本号：--version 或 VERSION');
  // 优先用 GitHub Release 正文：Full Changelog 只拼在正文里，NOTES_FILE 没有
  const releaseBody = await fetchReleaseBody({ repo: githubRepo, tag, token: ghToken });
  const notes = releaseBody ?? readNotes(notesFile, outDir);
  const result = publishAssets({
    outDir,
    channel,
    tag,
    version,
    commit: process.env.GITHUB_SHA ?? '',
    notes,
    token,
    repo,
    dryRun: args.has('dry-run'),
  });
  if (result.skipped) console.log('assets 同步已跳过');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/publish-assets.mjs');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`assets 仓库同步失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
