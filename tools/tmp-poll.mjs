const RUN = process.env.RUN_ID || '39368714346';
const REPO = 'muyangplus/dawn-tick';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function get(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { 'User-Agent': 'dawntick-poll' } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}
let last = '';
for (let i = 0; i < 60; i++) {
  try {
    const run = await get(`/actions/runs/${RUN}`);
    const jobs = await get(`/actions/runs/${RUN}/jobs?per_page=20`);
    const line = jobs.jobs.map(j => `${j.name}:${j.status}/${j.conclusion ?? '-'}`).join(' | ');
    if (line !== last) { console.log(new Date().toISOString(), `[${run.status}/${run.conclusion ?? '-'}]`, line); last = line; }
    if (run.status === 'completed') { console.log('RUN_COMPLETED', run.conclusion, run.html_url); break; }
  } catch (e) { console.log(new Date().toISOString(), 'poll error', e.message); }
  await sleep(40000);
}
