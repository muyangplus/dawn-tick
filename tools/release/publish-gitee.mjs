/**
 * 把 GitHub Actions 已发布的 Release 同步到 Gitee（代码镜像之外的「发布」双写）。
 *
 * ⚠️ 已不推荐：CI 已改为把产物推到独立 GitHub assets 仓库
 * （`tools/release/publish-assets.mjs`），Gitee 侧从 GitHub 镜像该仓库；
 * Gitee Releases/API 在 Actions 网络下实测超时、附件也有容量与数量限制。
 * 本脚本只保留给维护机手动兜底（GITEE_TOKEN + --from-github），工作流不再调用。
 *
 * 历史原因：Gitee 免费仓库不能跑 CI 构建，所以安装包仍由 GitHub Actions 产出，
 * 过去由这个脚本把标签、正文与 6 个资产发到 Gitee 镜像仓库。
 *
 * 用法（本地兜底，已不推荐）：
 *   GITEE_TOKEN=... TAG=v0.6.5 CHANNEL=beta PRERELEASE=true ROLLING=false \
 *   OUT_DIR=out node tools/release/publish-gitee.mjs
 *
 * 本地/预演：
 *   node tools/release/publish-gitee.mjs --dry-run --tag=v0.6.5 --out=out
 *
 * 约定：
 * - 只依赖 Node 内置 fetch/FormData/Blob（Node 18+），不引第三方库；
 * - token 只从环境变量读，不打日志；
 * - 失败让调用方看到非零退出，不静默吞错；
 * - 未配置 GITEE_TOKEN 时明确跳过（返回 0），便于 fork/自建仓库不带该 secret。
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GITEE_API = 'https://gitee.com/api/v5';
const DEFAULT_OWNER = 'muyangplus';
const DEFAULT_REPO = 'dawn-tick';
const DEFAULT_GITHUB_REPO = 'muyangplus/dawn-tick';
/** 单请求超时：Gitee 在海外/CI 网络下可能长时间不响应，不能让发布 job 挂住。 */
const REQUEST_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
/** 整个同步的硬上限：超过就退出，由 workflow 的超时兜底。 */
const TOTAL_TIMEOUT_MS = 4 * 60_000;

function signalOf(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** 需要同步的资产：与发布步骤产出的 out/ 一致（不把 .sha256 单文件带回来）。 */
export const ASSET_SUFFIXES = ['-windows-x64-setup.exe', '-windows-x64-portable.zip', '-android.apk', '-web.zip'];

/** 从 out/ 目录挑出要上传的资产文件（跳过目录与临时文件）。 */
export function selectAssets(dir) {
  return readdirSync(dir)
    .filter((name) => {
      const path = join(dir, name);
      if (!statSync(path).isFile()) return false;
      if (name === 'SHA256SUMS.txt' || name === 'version.json') return true;
      return ASSET_SUFFIXES.some((suffix) => name.endsWith(suffix));
    })
    .sort()
    .map((name) => ({ name, path: join(dir, name) }));
}

/**
 * 决定本次是「更新已有发布」还是「重建」。
 * 滚动渠道（dev-latest）每次都换资产，先删旧发布/旧标签再新建；
 * 正式/测试版是同一标签重跑时更新正文与附件，不删标签。
 */
export function planGiteeRelease({ rolling }) {
  return rolling ? 'recreate' : 'upsert';
}

/**
 * 附件保留策略：Gitee 仓库附件有容量/数量限制，超过阈值要删旧构建。
 *
 * 规则（按顺序）：
 * 1. 当前要发布的标签、`dev-latest` 永不删除；
 * 2. 最近 `keepRecent` 个发布保留（按创建时间倒序）；
 * 3. 其余从最旧开始删，直到「已用体积 + 本次将上传体积」不超过 `maxBytes`；
 * 4. 体积未知的旧发布（API 没给 size 且 HEAD 失败）按 0 计，交给「最近 N 个」规则兜底。
 *
 * @param releases [{ tag, createdAt, bytes }]
 * @param keepTags 永不删除的标签（含本次发布的标签）
 */
export function planPrune({ releases, incomingBytes, maxBytes, keepTags = [], keepRecent = 6 }) {
  const protectedTags = new Set([...keepTags, 'dev-latest']);
  // 按创建时间倒序：最近的 keepRecent 个必须保留，其余按最旧优先删
  const ordered = [...releases].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  const keep = new Set(protectedTags);
  ordered.slice(0, Math.max(0, keepRecent)).forEach((item) => keep.add(item.tag));
  const removable = ordered.filter((item) => !keep.has(item.tag)).reverse(); // 最旧在前

  let used = ordered.reduce((total, item) => total + (item.bytes ?? 0), 0) + incomingBytes;
  const remove = [];
  for (const item of removable) {
    if (used <= maxBytes) break;
    remove.push(item.tag);
    used -= item.bytes ?? 0;
  }
  return { remove, keptBytes: used };
}

async function api(token, path, init = {}) {
  const url = new URL(`${GITEE_API}${path}`);
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { ...init, signal: signalOf(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

async function gitee(method, path, token, payload) {
  const init = { method };
  if (payload !== undefined) {
    // Gitee v5 的发布接口按表单参数解析；JSON 在部分接口会 400，统一用 form-urlencoded
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      form.set(key, String(value));
    }
    init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
    init.body = form.toString();
  }
  return api(token, path, init);
}

function reason(result) {
  if (result.body === null) return `HTTP ${result.status}`;
  if (typeof result.body === 'string') return `HTTP ${result.status}：${result.body.slice(0, 160)}`;
  const message = result.body?.message ?? result.body?.error;
  return `HTTP ${result.status}${typeof message === 'string' ? `：${message}` : ''}`;
}

async function deleteRelease(token, owner, repo, id) {
  const result = await gitee('DELETE', `/repos/${owner}/${repo}/releases/${id}`, token);
  if (!result.ok && result.status !== 404) throw new Error(`删除旧发布失败（${result.status}）`);
}

async function deleteTag(token, owner, repo, tag) {
  const refs = await gitee('GET', `/repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(tag)}`, token);
  if (!refs.ok) return; // 标签不存在或接口不可用：继续尝试创建发布
  await gitee('DELETE', `/repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(tag)}`, token);
}

async function getReleaseByTag(token, owner, repo, tag) {
  const result = await gitee('GET', `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, token);
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`读取 Gitee 发布失败（${result.status}）`);
  return result.body;
}

async function deleteAssets(token, owner, repo, releaseId) {
  const detail = await gitee('GET', `/repos/${owner}/${repo}/releases/${releaseId}`, token);
  if (!detail.ok) return;
  for (const asset of detail.body?.assets ?? []) {
    if (typeof asset?.id !== 'number') continue;
    await gitee('DELETE', `/repos/${owner}/${repo}/releases/${releaseId}/attach_files/${asset.id}`, token);
  }
}

async function uploadAsset(token, owner, repo, releaseId, asset) {
  const data = readFileSync(asset.path);
  const form = new FormData();
  form.append('file', new Blob([data]), asset.name);
  const url = new URL(`${GITEE_API}/repos/${owner}/${repo}/releases/${releaseId}/attach_files`);
  url.searchParams.set('access_token', token);
  const response = await fetch(url, {
    method: 'POST',
    body: form,
    signal: signalOf(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`上传 ${asset.name} 失败（${response.status}）：${text.slice(0, 200)}`);
  }
}

/**
 * 从 GitHub Release 下载全部资产到本地目录，供「本地同步到 Gitee」使用。
 *
 * GitHub Actions 的机器到 Gitee 的 API 网络经常超时（实测 15s 无响应），
 * 云端双写不可靠；维护机（能访问两边）用一条命令完成：先拉产物，再发 Gitee。
 */
async function downloadReleaseAssets({ ghToken, githubRepo, tag, outDir }) {
  const headers = { accept: 'application/vnd.github+json' };
  if (ghToken !== '') headers.authorization = `Bearer ${ghToken}`;
  const response = await fetch(
    `https://api.github.com/repos/${githubRepo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers, signal: signalOf(REQUEST_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`读取 GitHub 发布失败（${response.status}）`);
  const release = await response.json();
  mkdirSync(outDir, { recursive: true });
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  for (const asset of assets) {
    const name = typeof asset?.name === 'string' ? asset.name : '';
    const url = typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : '';
    if (name === '' || url === '') continue;
    const wanted =
      name === 'SHA256SUMS.txt' || name === 'version.json' || ASSET_SUFFIXES.some((suffix) => name.endsWith(suffix));
    if (!wanted) continue;
    const file = await fetch(url, { signal: signalOf(UPLOAD_TIMEOUT_MS) });
    if (!file.ok) throw new Error(`下载 ${name} 失败（${file.status}）`);
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(join(outDir, name), buffer);
    console.log(`已下载 ${name}（${buffer.length} 字节）`);
  }
  return release;
}

/** 优先复用 GitHub 已生成的正文（含 Full Changelog），拿不到时退回 NOTES/CHANGELOG 段落。 */
async function githubReleaseBody({ ghToken, githubRepo, tag }) {
  if (!ghToken) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepo}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${ghToken}` },
      signal: signalOf(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function description(notesFile) {
  if (notesFile === '') return null;
  try {
    return readFileSync(notesFile, 'utf8');
  } catch {
    return null;
  }
}

async function listReleases(token, owner, repo) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await gitee('GET', `/repos/${owner}/${repo}/releases?per_page=100&page=${page}`, token);
    if (!result.ok) throw new Error(`读取 Gitee 发布列表失败（${result.status}）`);
    const rows = Array.isArray(result.body) ? result.body : [];
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

/** 附件体积：Gitee 可能不给 size，失败时 HEAD 一次；再失败按 0 计。 */
async function assetBytes(asset) {
  if (typeof asset?.size === 'number' && asset.size > 0) return asset.size;
  const url = asset?.browser_download_url;
  if (typeof url !== 'string' || url === '') return 0;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const length = Number(response.headers.get('content-length') ?? 0);
    return Number.isFinite(length) && length > 0 ? length : 0;
  } catch {
    return 0;
  }
}

async function releaseSummary(token, owner, repo, release) {
  const detail = await gitee('GET', `/repos/${owner}/${repo}/releases/${release.id}`, token);
  const assets = Array.isArray(detail.body?.assets) ? detail.body.assets : [];
  let bytes = 0;
  for (const asset of assets) bytes += await assetBytes(asset);
  return { tag: release.tag_name, createdAt: Date.parse(release.created_at ?? '') || 0, bytes };
}

/** 删除超出保留策略的旧发布：删发布与标签（附件随发布一起移除）。 */
async function pruneReleases({ token, owner, repo, keepTags, maxBytes, keepRecent, incomingBytes }) {
  const releases = await listReleases(token, owner, repo);
  const summaries = [];
  for (const release of releases) {
    if (typeof release?.tag_name !== 'string' || typeof release?.id !== 'number') continue;
    summaries.push(await releaseSummary(token, owner, repo, release));
  }
  const plan = planPrune({ releases: summaries, incomingBytes, maxBytes, keepTags, keepRecent });
  for (const tag of plan.remove) {
    const target = releases.find((release) => release.tag_name === tag);
    if (target === undefined) continue;
    await deleteRelease(token, owner, repo, target.id);
    await deleteTag(token, owner, repo, tag);
    console.log(`已删除过期构建：${tag}`);
  }
  return plan;
}

async function main() {
  // 硬超时：任何一步网络卡住都直接退出，避免 CI 发布 job 挂到 job 级超时
  const watchdog = setTimeout(() => {
    console.error('Gitee 同步超过 4 分钟，已中止');
    process.exit(1);
  }, TOTAL_TIMEOUT_MS);
  watchdog.unref?.();
  const args = new Map(
    process.argv
      .slice(2)
      .filter((item) => item.startsWith('--'))
      .map((raw) => {
        const [key, ...rest] = raw.replace(/^--/, '').split('=');
        return [key, rest.join('=')];
      }),
  );
  const dryRun = args.has('dry-run');
  const tag = args.get('tag') ?? process.env.TAG ?? '';
  const explicitChannel = args.get('channel') ?? process.env.CHANNEL ?? '';
  let channel = explicitChannel === '' ? 'release' : explicitChannel;
  const rolling = (args.get('rolling') ?? String(process.env.ROLLING ?? '')).toLowerCase() === 'true';
  let prerelease = (args.get('prerelease') ?? String(process.env.PRERELEASE ?? '')).toLowerCase() === 'true';
  const fromGithub = args.has('from-github');
  let outDir = args.get('out') ?? process.env.OUT_DIR ?? 'out';
  const owner = process.env.GITEE_OWNER ?? DEFAULT_OWNER;
  const repo = process.env.GITEE_REPO ?? DEFAULT_REPO;
  const githubRepo = process.env.GITHUB_REPO ?? DEFAULT_GITHUB_REPO;
  const token = process.env.GITEE_TOKEN ?? '';
  const notesFile = process.env.NOTES_FILE ?? '';
  const maxBytes = Number(args.get('max-total-bytes') ?? process.env.GITEE_MAX_TOTAL_BYTES ?? 800 * 1024 * 1024);
  const keepRecent = Number(args.get('keep-releases') ?? process.env.GITEE_KEEP_RELEASES ?? 6);

  if (tag === '') throw new Error('缺少标签：--tag 或 TAG');
  if (token === '' && !dryRun) {
    console.log('未配置 GITEE_TOKEN，跳过 Gitee 发布同步');
    return;
  }
  if (fromGithub && !dryRun) {
    outDir = args.get('out') ?? join(tmpdir(), `dawn-tick-gitee-${tag}`);
    console.log(`从 GitHub 拉取 ${tag} 的发布资产到 ${outDir}`);
    const release = await downloadReleaseAssets({
      ghToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
      githubRepo,
      tag,
      outDir,
    });
    // 未显式指定渠道/预发布时按 GitHub 发布推断：dev-latest → dev；pre-release → beta
    if (explicitChannel === '') {
      channel = tag === 'dev-latest' ? 'dev' : release?.prerelease === true ? 'beta' : 'release';
    }
    if (args.get('prerelease') === undefined && process.env.PRERELEASE === undefined) {
      prerelease = release?.prerelease === true;
    }
  }

  const assets = selectAssets(outDir);
  if (dryRun) {
    console.log(`dry-run：Gitee ${owner}/${repo} 标签 ${tag} 渠道 ${channel}`);
    const incomingBytes = assets.reduce((total, asset) => total + statSync(asset.path).size, 0);
    console.log(
      `dry-run：策略 ${planGiteeRelease({ rolling })}，预发布 ${prerelease}，资产 ${assets.length} 个，共 ${incomingBytes} 字节`,
    );
    console.log(`dry-run：保留最近 ${keepRecent} 个发布，总容量上限 ${maxBytes} 字节（Gitee 附件限额）`);
    for (const asset of assets) console.log(`  - ${asset.name}（${statSync(asset.path).size} 字节）`);
    return;
  }

  const gh = await githubReleaseBody({ ghToken: process.env.GH_TOKEN ?? '', githubRepo, tag });
  const body = typeof gh?.body === 'string' && gh.body.trim() !== '' ? gh.body : description(notesFile) ?? '';
  const name = typeof gh?.name === 'string' && gh.name !== '' ? gh.name : `晓刻 ${tag}`;
  const policy = planGiteeRelease({ rolling });

  let existing = await getReleaseByTag(token, owner, repo, tag);
  if (policy === 'recreate' && existing !== null) {
    await deleteRelease(token, owner, repo, existing.id);
    await deleteTag(token, owner, repo, tag);
    existing = null;
  }

  // 先按容量/数量清理旧构建，再上传本次资产（超过 Gitee 附件限额时上传会直接失败）
  const incomingBytes = assets.reduce((total, asset) => total + statSync(asset.path).size, 0);
  await pruneReleases({ token, owner, repo, keepTags: [tag], maxBytes, keepRecent, incomingBytes });

  let releaseId;
  if (existing !== null) {
    releaseId = existing.id;
    const updated = await gitee('PATCH', `/repos/${owner}/${repo}/releases/${releaseId}`, token, {
      name,
      body,
      prerelease,
    });
    if (!updated.ok) throw new Error(`更新 Gitee 发布失败（${updated.status}）`);
    await deleteAssets(token, owner, repo, releaseId);
  } else {
    // 先带 target_commitish（滚动渠道的提交镜像可能还没同步到 Gitee，会失败）；失败再退回不带 commit 创建
    const basePayload = { tag_name: tag, name, body, prerelease };
    const commits = [process.env.GITHUB_SHA ?? '', ''];
    let created = null;
    const failures = [];
    for (const target of commits) {
      const attempt = await gitee('POST', `/repos/${owner}/${repo}/releases`, token, {
        ...basePayload,
        ...(target === '' ? {} : { target_commitish: target }),
      });
      if (attempt.ok) {
        created = attempt;
        break;
      }
      failures.push(`${target === '' ? '不带 commit' : `commit ${target.slice(0, 7)}`} → ${reason(attempt)}`);
      // 已有同名标签时再次创建会冲突：直接读回已有发布
      if (attempt.status === 409 || attempt.status === 422) {
        const existingByTag = await getReleaseByTag(token, owner, repo, tag);
        if (existingByTag !== null) {
          existing = existingByTag;
          break;
        }
      }
    }
    if (existing !== null) {
      releaseId = existing.id;
      const updated = await gitee('PATCH', `/repos/${owner}/${repo}/releases/${releaseId}`, token, {
        name,
        body,
        prerelease,
      });
      if (!updated.ok) throw new Error(`更新 Gitee 已有发布失败：${reason(updated)}`);
      await deleteAssets(token, owner, repo, releaseId);
    } else if (created !== null) {
      releaseId = created.body?.id;
    }
    if (typeof releaseId !== 'number') {
      throw new Error(`创建 Gitee 发布失败：${failures.join('；')}`);
    }
  }

  for (const asset of assets) await uploadAsset(token, owner, repo, releaseId, asset);

  const verify = await getReleaseByTag(token, owner, repo, tag);
  const uploaded = Array.isArray(verify?.assets) ? verify.assets.length : 0;
  console.log(`Gitee 发布完成：${owner}/${repo}#${tag}，${uploaded} 个资产`);
  if (uploaded !== assets.length) throw new Error(`Gitee 资产数量不一致：期望 ${assets.length}，实际 ${uploaded}`);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/publish-gitee.mjs');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Gitee 发布失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
