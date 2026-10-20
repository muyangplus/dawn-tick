const REPO = 'muyangplus/dawn-tick';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { 'User-Agent': 'dawntick-watch' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
// 等限流重置：rate_limit 不计入配额
for (let i = 0; i < 60; i++) {
  try {
    const rl = await (await fetch('https://api.github.com/rate_limit', { headers: { 'User-Agent': 'dawntick-watch' } })).json();
    const core = rl.resources?.core;
    if (core && core.remaining > 2) break;
    const waitMs = core ? Math.max(30000, core.reset * 1000 - Date.now() + 20000) : 60000;
    console.log(new Date().toISOString(), `等待限流重置，约 ${Math.ceil(waitMs / 60000)} 分钟`);
    await sleep(Math.min(waitMs, 300000));
  } catch (e) { console.log('rate_limit error', e.message); await sleep(60000); }
}
try {
  const rel = await get('/releases?per_page=4');
  for (const r of rel) console.log('RELEASE', r.tag_name, r.published_at, r.prerelease ? 'prerelease' : 'stable', `${r.assets.length} assets`, r.assets.map((a) => a.name).join(','));
  const runs = await get('/actions/workflows/publish.yml/runs?per_page=4');
  for (const r of runs.workflow_runs) console.log('RUN', r.head_branch, r.status, r.conclusion ?? '-', r.created_at, r.html_url);
  const run = runs.workflow_runs.find((r) => r.head_branch === 'v0.4.0');
  if (run) {
    const jobs = await get(`/actions/runs/${run.id}/jobs?per_page=20`);
    for (const j of jobs.jobs) console.log('JOB', j.name, j.status, j.conclusion ?? '-');
  }
} catch (e) { console.log('QUERY_FAILED', e.message); }
