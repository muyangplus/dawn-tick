const REPO = 'muyangplus/dawn-tick';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { 'User-Agent': 'dawntick-watch' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json();
}
let runId = null;
let last = '';
for (let i = 0; i < 60; i++) {
  try {
    if (runId === null) {
      const runs = await get('/actions/workflows/publish.yml/runs?per_page=5');
      const run = (runs.workflow_runs || []).find((r) => r.head_branch === 'v0.4.0' && r.created_at > '2026-10-20T11:20');
      if (run) { runId = run.id; console.log('RUN_FOUND', runId, run.created_at); }
    }
    if (runId !== null) {
      const run = await get(`/actions/runs/${runId}`);
      const jobs = await get(`/actions/runs/${runId}/jobs?per_page=20`);
      const line = `[${run.status}/${run.conclusion ?? '-'}] ` + jobs.jobs.map((j) => `${j.name}:${j.status}/${j.conclusion ?? '-'}`).join(' | ');
      if (line !== last) { console.log(new Date().toISOString(), line); last = line; }
      if (run.status === 'completed') {
        console.log('RUN_COMPLETED', run.conclusion);
        const rel = await get('/releases?per_page=3');
        for (const r of rel) console.log('RELEASE', r.tag_name, r.published_at, r.prerelease ? 'prerelease' : 'stable', `${r.assets.length} assets`, r.assets.map((a) => a.name).join(','));
        break;
      }
    }
  } catch (e) { console.log(new Date().toISOString(), 'poll error', e.message); }
  await sleep(90000);
}
