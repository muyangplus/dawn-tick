import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_RETRY_DELAYS_MS,
  DEFAULT_CHUNK_CONCURRENCY,
  DownloadCancelledError,
  MAX_CHUNK_CONCURRENCY,
  MIN_CHUNK_BYTES,
  downloadChunked,
  planChunks,
  progressOf,
  runWithConcurrency,
} from '../src/lib/chunked-download.ts';
import { formatDownloadDetail } from '../src/lib/update-download.ts';

const KB = 1024;
const MB = 1024 * KB;

function bytesOf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = index % 251;
  return bytes;
}

function rangeHeaders(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('range');
}

function parseRange(value: string): { start: number; end: number } {
  const matched = /bytes=(\d+)-(\d+)/.exec(value);
  if (matched === null) throw new Error(`测试桩收到的 Range 不合法：${value}`);
  return { start: Number(matched[1]), end: Number(matched[2]) };
}

function responseOf(bytes: Uint8Array, status: number, headers: Record<string, string> = {}): Response {
  return new Response(bytes, { status, headers });
}

// —— 分片规划 ——

test('分片规划：总长未知或太小直接单流', () => {
  assert.deepEqual(planChunks(null), { kind: 'stream', reason: 'unknown-size' });
  assert.deepEqual(planChunks(undefined), { kind: 'stream', reason: 'unknown-size' });
  assert.deepEqual(planChunks(0), { kind: 'stream', reason: 'unknown-size' });
  assert.deepEqual(planChunks(Number.NaN), { kind: 'stream', reason: 'unknown-size' });
  assert.deepEqual(planChunks(MIN_CHUNK_BYTES), { kind: 'stream', reason: 'too-small' });
  assert.deepEqual(planChunks(MIN_CHUNK_BYTES * 2 - 1), { kind: 'stream', reason: 'too-small' });
  assert.deepEqual(planChunks(MB, 1), { kind: 'stream', reason: 'too-small' }, '并发 1 时分片没有意义');
});

test('分片规划：均分、末片吃余数、范围连续且覆盖全长', () => {
  const even = planChunks(MIN_CHUNK_BYTES * 4, 4);
  assert.equal(even.kind, 'ranged');
  if (even.kind !== 'ranged') return;
  assert.equal(even.chunks.length, 4);
  assert.deepEqual(even.chunks[0], { index: 0, start: 0, end: MIN_CHUNK_BYTES - 1 });
  assert.deepEqual(even.chunks.at(-1), {
    index: 3,
    start: MIN_CHUNK_BYTES * 3,
    end: MIN_CHUNK_BYTES * 4 - 1,
  });

  const total = MIN_CHUNK_BYTES * 3 + 12345;
  const odd = planChunks(total, 4);
  assert.equal(odd.kind, 'ranged');
  if (odd.kind !== 'ranged') return;
  assert.equal(odd.chunks.length, 3);
  let cursor = 0;
  for (const chunk of odd.chunks) {
    assert.equal(chunk.start, cursor, '范围首尾相接');
    assert.ok(chunk.end - chunk.start + 1 >= MIN_CHUNK_BYTES, '单片不小于 256KB');
    cursor = chunk.end + 1;
  }
  assert.equal(cursor, total, '末片补齐余数');
});

test('分片规划：并发上限收敛到 6，默认 4', () => {
  const capped = planChunks(MB * 20, 99);
  assert.equal(capped.kind, 'ranged');
  if (capped.kind !== 'ranged') return;
  assert.equal(capped.chunks.length, MAX_CHUNK_CONCURRENCY);

  const defaults = planChunks(MB * 20);
  assert.equal(defaults.kind, 'ranged');
  if (defaults.kind !== 'ranged') return;
  assert.equal(defaults.chunks.length, DEFAULT_CHUNK_CONCURRENCY);
});

test('进度聚合：百分比、平均速度与剩余时间', () => {
  const half = progressOf(500, 1000, 1000);
  assert.equal(half.percent, 0.5);
  assert.equal(half.speedBytesPerSec, 500);
  assert.equal(half.etaSeconds, 1);

  const clamped = progressOf(2000, 1000, 1000);
  assert.equal(clamped.percent, 1, '百分比封顶 1');

  const unknown = progressOf(1024, null, 1000);
  assert.equal(unknown.percent, null);
  assert.equal(unknown.etaSeconds, null);
  assert.equal(unknown.speedBytesPerSec, 1024);

  const idle = progressOf(0, 1000, 0);
  assert.equal(idle.speedBytesPerSec, null);
  assert.equal(idle.etaSeconds, null);

  // 进度明细文案：冒烟断言速度与剩余时间都出现在这里
  assert.equal(formatDownloadDetail(progressOf(MB, MB * 2, 1000)), '速度 1.0 MB/s · 剩余 1 秒');
  assert.equal(formatDownloadDetail(progressOf(0, null, 0)), '');
});

test('并发限制：在途任务不超过上限，结果保持入参顺序', async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 7 }, (_, index) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return index;
  });
  const results = await runWithConcurrency(tasks, 3);
  assert.ok(peak <= 3, `并发峰值 ${peak} 应不超过 3`);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6]);
});

test('并发限制：一片失败不取消其它片，全部落定后再抛错', async () => {
  const started: number[] = [];
  const tasks = Array.from({ length: 4 }, (_, index) => async () => {
    started.push(index);
    if (index === 0) throw new Error('first chunk failed');
    await new Promise((resolve) => setTimeout(resolve, 2));
    return index;
  });
  await assert.rejects(runWithConcurrency(tasks, 4), /first chunk failed/);
  assert.deepEqual(started.sort((a, b) => a - b), [0, 1, 2, 3], '其余片照常执行');
});

// —— 分片下载 ——

test('并发分片下载：按 Range 拉取、按序拼接、聚合进度', async () => {
  const total = MIN_CHUNK_BYTES * 4;
  const full = bytesOf(total);
  const requests: string[] = [];
  let active = 0;
  let peak = 0;
  let clock = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const header = rangeHeaders(init);
    assert.ok(header !== null, '分片请求必须带 Range');
    requests.push(header);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const { start, end } = parseRange(header);
    active -= 1;
    return responseOf(full.slice(start, end + 1), 206, {
      'content-range': `bytes ${start}-${end}/${total}`,
    });
  };
  const progress: Array<{ received: number; percent: number | null; speed: number | null; eta: number | null }> = [];
  const bytes = await downloadChunked({
    url: 'https://example.com/pkg.exe',
    totalBytes: total,
    fetchImpl,
    now: () => {
      clock += 10;
      return clock;
    },
    onProgress: (item) =>
      progress.push({
        received: item.received,
        percent: item.percent,
        speed: item.speedBytesPerSec,
        eta: item.etaSeconds,
      }),
  });

  assert.equal(bytes.length, total);
  assert.deepEqual(bytes, full, '拼接结果与源文件一致');
  assert.equal(requests.length, 4);
  assert.ok(peak <= DEFAULT_CHUNK_CONCURRENCY, `并发峰值 ${peak} 应不超过默认并发`);
  const last = progress.at(-1);
  assert.equal(last?.percent, 1);
  assert.ok((last?.speed ?? 0) > 0, '速度应为正');
  assert.equal(last?.eta, 0);
  assert.equal(progress.every((item) => item.received >= 0), true);
});

test('单片重试后成功：只重试失败的那一片，退避 300ms / 900ms', async () => {
  const total = MIN_CHUNK_BYTES * 3;
  const full = bytesOf(total);
  const attempts = new Map<string, number>();
  const waits: number[] = [];
  let failing = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const header = rangeHeaders(init)!;
    const seen = (attempts.get(header) ?? 0) + 1;
    attempts.set(header, seen);
    if (header === 'bytes=262144-524287' && seen === 1) {
      failing += 1;
      throw new Error('connection reset');
    }
    const { start, end } = parseRange(header);
    return responseOf(full.slice(start, end + 1), 206);
  };

  const bytes = await downloadChunked({
    url: 'https://example.com/pkg.exe',
    totalBytes: total,
    fetchImpl,
    concurrency: 3,
    wait: async (ms) => {
      waits.push(ms);
    },
  });

  assert.deepEqual(bytes, full);
  assert.equal(failing, 1, '只失败过一次');
  assert.deepEqual(waits, [CHUNK_RETRY_DELAYS_MS[0]]);
  assert.equal(attempts.get('bytes=262144-524287'), 2);
});

test('重试耗尽：三次都失败后整体报错，其它片已经跑完', async () => {
  const total = MIN_CHUNK_BYTES * 3;
  const full = bytesOf(total);
  const attempts = new Map<string, number>();
  const waits: number[] = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const header = rangeHeaders(init)!;
    attempts.set(header, (attempts.get(header) ?? 0) + 1);
    if (header === 'bytes=262144-524287') throw new Error('offline');
    const { start, end } = parseRange(header);
    return responseOf(full.slice(start, end + 1), 206);
  };

  await assert.rejects(
    downloadChunked({
      url: 'https://example.com/pkg.exe',
      totalBytes: total,
      fetchImpl,
      wait: async (ms) => {
        waits.push(ms);
      },
    }),
    /offline/,
  );
  assert.deepEqual(waits, [...CHUNK_RETRY_DELAYS_MS], '重试 2 次，退避 300/900');
  assert.equal(attempts.get('bytes=262144-524287'), 3, '首试 + 重试 2 次');
  assert.equal(attempts.size, 3, '其它片照常请求');
});

test('服务器不支持 Range（返回 200）：回退单流，进度不丢', async () => {
  const total = MIN_CHUNK_BYTES * 2;
  const full = bytesOf(total);
  const requests: Array<string | null> = [];
  let clock = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push(rangeHeaders(init));
    return responseOf(full, 200, { 'content-length': String(total) });
  };
  const percents: Array<number | null> = [];
  const bytes = await downloadChunked({
    url: 'https://example.com/pkg.exe',
    totalBytes: total,
    fetchImpl,
    now: () => {
      clock += 10;
      return clock;
    },
    onProgress: (item) => percents.push(item.percent),
  });

  assert.deepEqual(bytes, full);
  assert.equal(requests.length, 1, '探测片拿到 200 后直接当单流用，不再额外请求');
  assert.equal(percents.at(-1), 1, '回退后进度仍能到 100%');
  assert.equal(percents.some((value) => value !== null && value > 0), true, '回退过程持续上报进度');
});

test('分片中途返回 200 全量：丢弃分片改单流，结果仍正确', async () => {
  const total = MIN_CHUNK_BYTES * 3;
  const full = bytesOf(total);
  const requests: Array<string | null> = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const header = rangeHeaders(init);
    requests.push(header);
    if (header === null) return responseOf(full, 200, { 'content-length': String(total) });
    if (header === 'bytes=262144-524287') return responseOf(full, 200);
    const { start, end } = parseRange(header);
    return responseOf(full.slice(start, end + 1), 206);
  };

  const bytes = await downloadChunked({ url: 'https://example.com/pkg.exe', totalBytes: total, fetchImpl });
  assert.deepEqual(bytes, full);
  assert.equal(requests.at(-1), null, '最后一次是不带 Range 的单流请求');
});

test('未知总长：不探测 Range，直接单流并按 content-length 报进度', async () => {
  const total = MIN_CHUNK_BYTES * 2;
  const full = bytesOf(total);
  const requests: Array<string | null> = [];
  const progress: Array<{ total: number | null; percent: number | null }> = [];
  const bytes = await downloadChunked({
    url: 'https://example.com/pkg.exe',
    fetchImpl: async (_url, init) => {
      requests.push(rangeHeaders(init));
      return responseOf(full, 200, { 'content-length': String(total) });
    },
    onProgress: (item) => progress.push({ total: item.total, percent: item.percent }),
  });

  assert.deepEqual(bytes, full);
  assert.deepEqual(requests, [null]);
  assert.equal(progress.at(-1)?.total, total);
  assert.equal(progress.at(-1)?.percent, 1);
});

test('取消：分片下载抛出 DownloadCancelledError，不再继续请求', async () => {
  const total = MIN_CHUNK_BYTES * 2;
  const controller = new AbortController();
  const requests: string[] = [];
  const pending = downloadChunked({
    url: 'https://example.com/pkg.exe',
    totalBytes: total,
    signal: controller.signal,
    fetchImpl: (_url, init) => {
      requests.push(rangeHeaders(init) ?? 'none');
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
    wait: async () => undefined,
  });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof DownloadCancelledError);
  assert.equal(requests.length, 1, '取消后不再发新请求');
});
