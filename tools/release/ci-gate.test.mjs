import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitCi, parseArgs, verdictForRuns } from './ci-gate.mjs';

test('运行列表判定', () => {
  assert.equal(verdictForRuns([]), 'missing');
  assert.equal(verdictForRuns(undefined), 'missing');
  assert.equal(
    verdictForRuns([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }]),
    'success',
  );
  assert.equal(
    verdictForRuns([{ status: 'completed', conclusion: 'failure' }]),
    'failure',
  );
  assert.equal(
    verdictForRuns([{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'cancelled' }]),
    'running',
  );
  assert.equal(
    verdictForRuns([{ status: 'completed', conclusion: 'cancelled' }]),
    'failure',
  );
});

test('参数解析', () => {
  const options = parseArgs(['--ref=dev', '--timeout=600', '--interval=5', '--workflow=ci.yml']);
  assert.equal(options.ref, 'dev');
  assert.equal(options.timeoutSeconds, 600);
  assert.equal(options.intervalSeconds, 5);
  assert.equal(options.workflow, 'ci.yml');

  const defaults = parseArgs([]);
  assert.equal(defaults.timeoutSeconds, 2400);
  assert.equal(defaults.intervalSeconds, 30);
});

function stubFetch(runsSequence) {
  let calls = 0;
  return async (path) => {
    if (path.startsWith('/repos/o/r/commits/')) return { sha: 'abc123' };
    const index = Math.min(calls, runsSequence.length - 1);
    calls += 1;
    return { workflow_runs: runsSequence[index] };
  };
}

test('CI 通过时立即返回', async () => {
  const result = await awaitCi(
    { repo: 'o/r', token: 't', ref: 'dev', workflow: 'ci.yml', timeoutSeconds: 60, intervalSeconds: 1 },
    { fetchImpl: stubFetch([[{ status: 'completed', conclusion: 'success' }]]), sleep: async () => {}, log: () => {} },
  );
  assert.equal(result.ok, true);
  assert.equal(result.sha, 'abc123');
});

test('CI 运行中时轮询后通过', async () => {
  const sequence = [
    [{ status: 'in_progress', conclusion: null }],
    [{ status: 'in_progress', conclusion: null }],
    [{ status: 'completed', conclusion: 'success' }],
  ];
  let slept = 0;
  const result = await awaitCi(
    { repo: 'o/r', token: 't', ref: 'dev', workflow: 'ci.yml', timeoutSeconds: 600, intervalSeconds: 1 },
    { fetchImpl: stubFetch(sequence), sleep: async () => { slept += 1; }, log: () => {} },
  );
  assert.equal(result.ok, true);
  assert.equal(slept, 2);
});

test('CI 失败时停止发布', async () => {
  const result = await awaitCi(
    { repo: 'o/r', token: 't', ref: 'v0.1.0', workflow: 'ci.yml', timeoutSeconds: 60, intervalSeconds: 1 },
    { fetchImpl: stubFetch([[{ status: 'completed', conclusion: 'failure' }]]), sleep: async () => {}, log: () => {} },
  );
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'failure');
});

test('无记录时等待至超时', async () => {
  const result = await awaitCi(
    { repo: 'o/r', token: 't', ref: 'dev', workflow: 'ci.yml', timeoutSeconds: 0, intervalSeconds: 1 },
    { fetchImpl: stubFetch([[]]), sleep: async () => {}, log: () => {} },
  );
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'timeout');
});
