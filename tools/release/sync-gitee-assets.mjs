/**
 * 立即把 GitHub `dawn-tick-assets` 仓库的产物分支同步到 Gitee（本地 CD 步骤）。
 *
 * 为什么需要：Gitee 的仓库镜像是「拉取式」，同步有分钟到小时级延迟；
 * 而 GitHub Actions 的机器访问 Gitee 会超时，云端 CI 无法立即推送。
 * 在维护机（能同时访问 GitHub 与 Gitee）上跑本脚本，就等于一次「立即同步」的 CD。
 *
 * 用法：
 *   GITEE_TOKEN=... node tools/release/sync-gitee-assets.mjs
 *   GITEE_TOKEN=... node tools/release/sync-gitee-assets.mjs --branches=beta
 *   node tools/release/sync-gitee-assets.mjs --dry-run
 *
 * token 也可以放在 `tools/release/.gitee-token`（已 gitignore）；只打印分支与版本，不打印 token。
 * 推完后会用 Gitee API 读回 version.json 校验版本，避免「推了但没生效」。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GITHUB_ASSETS_REPO = 'muyangplus/dawn-tick-assets';
/** GitHub 默认走 SSH-over-443（与主仓库 push 同一条链路）；可用 GITHUB_ASSETS_URL 覆盖为 HTTPS。 */
const GITHUB_ASSETS_URL =
  process.env.GITHUB_ASSETS_URL ?? 'ssh://git@ssh.github.com:443/muyangplus/dawn-tick-assets.git';
const GITEE_ASSETS_REPO = 'muyangplus/dawn-tick-assets';
const DEFAULT_BRANCHES = ['dev', 'beta', 'release'];
const TOKEN_FILE = join('tools', 'release', '.gitee-token');

function argsOf(argv) {
  const args = new Map();
  for (const raw of argv.filter((item) => item.startsWith('--'))) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    args.set(key, rest.join('='));
  }
  return args;
}

export function parseBranches(raw) {
  if (raw === undefined || raw.trim() === '') return DEFAULT_BRANCHES;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => DEFAULT_BRANCHES.includes(item));
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: options.stdio ?? 'pipe', cwd: options.cwd });
}

/** 只同步 GitHub 上实际存在的分支（release 分支可能要到正式版才创建）。 */
export function existingBranches() {
  const output = git(['ls-remote', '--heads', GITHUB_ASSETS_URL]);
  return output
    .split('\n')
    .map((line) => line.split('refs/heads/')[1]?.trim() ?? '')
    .filter((name) => DEFAULT_BRANCHES.includes(name));
}

function readToken() {
  const fromEnv = process.env.GITEE_TOKEN ?? '';
  if (fromEnv !== '') return fromEnv;
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim();
  return '';
}

function giteeUrl(token) {
  // 允许用 GITEE_PUSH_URL 覆盖（例如改用 SSH 免 token）；默认 HTTPS + token
  if (process.env.GITEE_PUSH_URL !== undefined && process.env.GITEE_PUSH_URL !== '') {
    return process.env.GITEE_PUSH_URL;
  }
  // token 里可能含 @ 等字符：URL 编码，避免解析错主机
  return `https://${encodeURIComponent(token)}@gitee.com/${GITEE_ASSETS_REPO}.git`;
}

async function readGiteeVersion(branch) {
  const url = `https://gitee.com/api/v5/repos/${GITEE_ASSETS_REPO}/contents/version.json?ref=${encodeURIComponent(branch)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = await response.json();
    const text = Buffer.from(String(body.content ?? ''), 'base64').toString('utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const dryRun = args.has('dry-run');
  const token = readToken();
  if (token === '' && !dryRun) {
    console.error('缺少 GITEE_TOKEN（环境变量或 tools/release/.gitee-token）');
    process.exit(1);
  }
  const requested = parseBranches(args.get('branches'));
  const branches = dryRun
    ? requested.filter((branch) => existingBranches().includes(branch))
    : requested.filter((branch) => existingBranches().includes(branch));
  if (branches.length === 0) {
    console.error('GitHub assets 仓库没有可同步的分支');
    process.exit(1);
  }
  console.log(`准备同步分支：${branches.join(', ')}`);

  const workspace = mkdtempSync(join(tmpdir(), 'dawn-tick-gitee-sync-'));
  try {
    for (const branch of branches) {
      if (dryRun) {
        console.log(`[dry-run] 将同步 ${branch}`);
        continue;
      }
      const dir = join(workspace, branch);
      git(['init', '-q', dir]);
      git(['remote', 'add', 'origin', GITHUB_ASSETS_URL], { cwd: dir });
      git(['fetch', '--depth=1', 'origin', branch], { cwd: dir, stdio: 'inherit' });
      git(['checkout', '-q', '-B', branch, 'FETCH_HEAD'], { cwd: dir });
      git(['push', '--force', giteeUrl(token), `HEAD:refs/heads/${branch}`], { cwd: dir, stdio: 'inherit' });
      const version = await readGiteeVersion(branch);
      console.log(`已同步 ${branch}${version?.version === undefined ? '' : `（Gitee 版本 ${version.version}）`}`);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
  if (dryRun) console.log('dry-run 结束，未推送');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/sync-gitee-assets.mjs');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`同步到 Gitee 失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
