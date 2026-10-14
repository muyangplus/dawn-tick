#!/usr/bin/env node
import process from 'node:process';

export const VERDICTS = ['success', 'failure', 'running', 'missing'];

/** 由某个提交上的 CI 运行列表得出判定：成功优先，其次运行中，最后失败。 */
export function verdictForRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  if (list.length === 0) return 'missing';
  if (list.some((run) => run.status === 'completed' && run.conclusion === 'success')) return 'success';
  if (list.some((run) => run.status !== 'completed')) return 'running';
  return 'failure';
}

export function parseArgs(args) {
  const options = { ref: '', workflow: 'ci.yml', timeoutSeconds: 2400, intervalSeconds: 30 };
  for (const raw of args) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    const value = rest.join('=');
    if (key === 'ref') options.ref = value;
    else if (key === 'workflow') options.workflow = value;
    else if (key === 'timeout') options.timeoutSeconds = Number(value);
    else if (key === 'interval') options.intervalSeconds = Number(value);
  }
  return options;
}

async function api(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dawn-tick-ci-gate',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`${path} 返回 HTTP ${response.status}`);
  return response.json();
}

export async function awaitCi(
  { repo, token, ref, workflow, timeoutSeconds, intervalSeconds },
  { fetchImpl = api, sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)), log = console.log } = {},
) {
  const commit = await fetchImpl(`/repos/${repo}/commits/${encodeURIComponent(ref)}`, token);
  const sha = commit.sha;
  log(`目标提交 ${sha}（来自 ${ref}）`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const data = await fetchImpl(
      `/repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=20`,
      token,
    );
    const verdict = verdictForRuns(data.workflow_runs);
    log(`CI 状态 ${verdict}`);

    if (verdict === 'success') return { ok: true, sha, verdict };
    if (verdict === 'failure') return { ok: false, sha, verdict };
    if (Date.now() >= deadline) return { ok: false, sha, verdict: 'timeout' };

    await sleep(intervalSeconds);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

  if (repo === undefined || token === undefined || options.ref.length === 0) {
    console.error('缺少 GITHUB_REPOSITORY、GH_TOKEN 或 --ref');
    return 1;
  }

  const result = await awaitCi({ repo, token, ...options });
  if (!result.ok) {
    console.error(`CI 未通过（${result.verdict}），停止发布 ${result.sha}`);
    return 1;
  }
  console.log(`::notice::CI 通过 ${result.sha}`);
  return 0;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/ci-gate.mjs');
if (invokedDirectly) {
  process.exitCode = await main();
}
