import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_RETRIES,
  DEFAULT_CONCURRENCY,
  DownloadCancelledError,
  MAX_CONCURRENCY,
  MIN_CHUNK_BYTES,
  downloadWithRanges,
  normalizeConcurrency,
  planChunks,
} from '../src/lib/chunked-download.ts';
import {
  ProgressMeter,
  estimateRemaining,
  estimateSpeed,
  type DownloadProgressSnapshot,
} from '../src/lib/download-progress.ts';

/** 造一段可校验的字节：每个下标取模，拼接错位时 deepEqual 会立刻发现。 */
function sampleBytes(total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) bytes[index] = index % 251;
  return bytes;
}

function rangeOf(init?: RequestInit): { start: number; end: number } | null {
  const headers = new Headers(init?.headers);
  const matched = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range') ?? '');
  if (matched === null) return null;
  return { start: Number(matched[1]), end: Number(matched[2]) };
}

/** 用 `ReadableStream` 造响应：分两块推送，模拟真实流式读取。 */
function streamResponse(
  data: Uint8Array,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const half = Math.max(1, Math.ceil(data.length / 2));
      for (let offset = 0; offset < data.length; offset += half) {
        controller.enqueue(data.slice(offset, offset + half));
      }
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: data.length === 0 ? null : stream,
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, headers: new Headers(), body: null } as unknown as Response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// —— 分片规划 ——

test('planChunks：均分边界、末片与并发夹取', () => {
  const total = 2 * 1024 * 1024;
  const chunks = planChunks(total, DEFAULT_CONCURRENCY);
  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks[0], { index: 0, start: 0, end: 524287 });
  assert.equal(chunks.at(-1)?.end, total - 1, '末片必须落在 total-1');
  assert.equal(chunks.at(-1)?.start, 3 * 524288);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.equal(chunks[index]?.start, (chunks[index - 1]?.end ?? 0) + 1, '分片首尾相接，不留缝');
  }

  // 恰好整除：每片都等于 MIN_CHUNK_BYTES
  const exact = planChunks(MIN_CHUNK_BYTES * 4, 4);
  assert.equal(exact.length, 4);
  assert.ok(exact.every((chunk) => chunk.end - chunk.start + 1 === MIN_CHUNK_BYTES));

  assert.equal(planChunks(total, 99).length, MAX_CONCURRENCY, '并发超过上限按 6 片');
  assert.equal(planChunks(total, 0).length, 1, '非法并发退化为 1 片');
  assert.equal(planChunks(MIN_CHUNK_BYTES / 2, 4).length, 1, '小于单片下限时只切一片');
  assert.equal(planChunks(total, 1).length, 1);
});

test('planChunks：未知大小不切片，走单流', () => {
  assert.deepEqual(planChunks(null), []);
  assert.deepEqual(planChunks(0), []);
  assert.deepEqual(planChunks(-1), []);
  assert.deepEqual(planChunks(Number.NaN), []);
});

test('normalizeConcurrency：默认 4、上限 6、下限 1', () => {
  assert.equal(normalizeConcurrency(undefined), DEFAULT_CONCURRENCY);
  assert.equal(normalizeConcurrency(null), DEFAULT_CONCURRENCY);
  assert.equal(normalizeConcurrency(Number.NaN), DEFAULT_CONCURRENCY);
  assert.equal(normalizeConcurrency(99), MAX_CONCURRENCY);
  assert.equal(normalizeConcurrency(0), 1);
  assert.equal(normalizeConcurrency(-3), 1);
  assert.equal(normalizeConcurrency(3.9), 3);
});

// —— 速度与剩余时间 ——

test('estimateSpeed / estimateRemaining：窗口内首尾差值', () => {
  const samples = [
    { at: 0, received: 0 },
    { at: 500, received: 500 },
    { at: 1000, received: 1500 },
  ];
  assert.equal(estimateSpeed(samples, 1000), 1500, '1 秒收 1500 字节');
  assert.equal(estimateSpeed(samples.slice(0, 1), 1000), null, '单样本不猜速度');
  assert.equal(estimateSpeed(samples, 5000), null, '窗口外的旧样本不算');
  assert.equal(estimateRemaining(3000, 1500, 1500), 1000);
  assert.equal(estimateRemaining(3000, 3000, 1500), 0);
  assert.equal(estimateRemaining(null, 10, 100), null);
  assert.equal(estimateRemaining(3000, 10, null), null);
});

test('ProgressMeter：聚合字节并给出百分比/速度/剩余时间', () => {
  let now = 0;
  const meter = new ProgressMeter(1000, () => now);
  const first = meter.add(100);
  assert.equal(first.progress, 0.1);
  assert.equal(first.bytesPerSecond, null, '首个样本没有速度');

  now = 1000;
  const second = meter.add(400);
  assert.equal(second.received, 500);
  assert.equal(second.progress, 0.5);
  assert.equal(second.bytesPerSecond, 400, '1 秒新增 400 字节');
  assert.equal(second.remainingMs, 1250);

  now = 1500;
  const third = meter.add(500);
  assert.equal(third.progress, 1);
  assert.equal(third.remainingMs, 0);

  const unknown = new ProgressMeter(null, () => 0);
  const snapshot = unknown.add(1024);
  assert.equal(snapshot.total, null);
  assert.equal(snapshot.progress, null);
  assert.equal(snapshot.remainingMs, null);
});

// —— 并发分片 ——

test('并发分片：按 Range 拉取、聚合进度并按序拼接', async () => {
  const total = MIN_CHUNK_BYTES * 4;
  const data = sampleBytes(total);
  let inFlight = 0;
  let peak = 0;
  const ranges: Array<{ start: number; end: number }> = [];

  const progress: DownloadProgressSnapshot[] = [];
  const result = await downloadWithRanges({
    url: 'https://example.com/app.exe',
    total,
    concurrency: 4,
    fetchImpl: async (_url, init) => {
      const range = rangeOf(init);
      assert.ok(range !== null, '分片请求都要带 Range');
      ranges.push(range);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight -= 1;
      const slice = data.slice(range.start, range.end + 1);
      return streamResponse(slice, 206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${range.start}-${range.end}/${total}`,
      });
    },
    onProgress: (snapshot) => progress.push(snapshot),
  });

  assert.equal(result.mode, 'chunked');
  assert.equal(result.total, total);
  assert.deepEqual(result.bytes, data, '按序拼接后的字节必须与源一致（含末片）');
  assert.equal(ranges.length, 4);
  assert.ok(peak >= 2, `确实并发（峰值 ${peak}）`);
  assert.ok(peak <= 4, `并发不超过设定值（峰值 ${peak}）`);
  assert.equal(progress.at(-1)?.received, total);
  assert.equal(progress.at(-1)?.progress, 1);
});

test('某片失败后重试成功：退避 500ms，其它片不受影响', async () => {
  const total = MIN_CHUNK_BYTES * 4;
  const data = sampleBytes(total);
  const attempts = new Map<string, number>();
  const sleeps: number[] = [];

  const result = await downloadWithRanges({
    url: 'https://example.com/app.exe',
    total,
    concurrency: 4,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetchImpl: async (_url, init) => {
      const range = rangeOf(init);
      assert.ok(range !== null);
      const key = `${range.start}-${range.end}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const slice = data.slice(range.start, range.end + 1);
      if (key === `${MIN_CHUNK_BYTES}-${MIN_CHUNK_BYTES * 2 - 1}` && attempt === 1) {
        return errorResponse(500);
      }
      return streamResponse(slice, 206, { 'content-length': String(slice.length) });
    },
  });

  assert.deepEqual(result.bytes, data);
  assert.deepEqual(sleeps, [500], '只退避一次');
  assert.equal(attempts.get(`${MIN_CHUNK_BYTES}-${MIN_CHUNK_BYTES * 2 - 1}`), 2);
});

test('重试耗尽：失败分片最多试 3 次，报可读原因', async () => {
  const total = MIN_CHUNK_BYTES * 4;
  const data = sampleBytes(total);
  let failedAttempts = 0;
  const sleeps: number[] = [];

  await assert.rejects(
    downloadWithRanges({
      url: 'https://example.com/app.exe',
      total,
      concurrency: 2,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async (_url, init) => {
        const range = rangeOf(init);
        assert.ok(range !== null);
        const slice = data.slice(range.start, range.end + 1);
        // 并发 2 时第二片从 2×MIN 开始（两片各 2×MIN）
        if (range.start === MIN_CHUNK_BYTES * 2) {
          failedAttempts += 1;
          return errorResponse(503);
        }
        return streamResponse(slice, 206, { 'content-length': String(slice.length) });
      },
    }),
    /第 2 片下载失败：更新源返回 503/,
  );

  assert.equal(failedAttempts, CHUNK_RETRIES + 1, '首次 + 2 次重试');
  assert.deepEqual(sleeps.filter((ms) => ms > 0), [500, 1000], '指数退避 500 → 1000');
});

// —— 回退单流 ——

test('服务器忽略 Range（200）：自动回退单流，进度结构一致', async () => {
  const total = MIN_CHUNK_BYTES * 4;
  const data = sampleBytes(total);
  let requests = 0;
  const progress: DownloadProgressSnapshot[] = [];

  const result = await downloadWithRanges({
    url: 'https://example.com/app.exe',
    total,
    concurrency: 4,
    fetchImpl: async (_url, init) => {
      requests += 1;
      assert.ok(rangeOf(init) !== null, '探测请求带 Range，服务端却不理它');
      // 没有 Accept-Ranges、也没有 206：响应体就是整包
      return streamResponse(data, 200, { 'content-length': String(total) });
    },
    onProgress: (snapshot) => progress.push(snapshot),
  });

  assert.equal(result.mode, 'single');
  assert.equal(requests, 1, '复用 200 的响应体，不重复请求');
  assert.deepEqual(result.bytes, data);
  assert.equal(progress.at(-1)?.received, total);
  assert.equal(progress.at(-1)?.total, total);
  assert.equal(progress.at(-1)?.progress, 1);
});

test('Range 不合法（416）：丢掉响应后按单流重下', async () => {
  const total = MIN_CHUNK_BYTES * 4;
  const data = sampleBytes(total);
  let requests = 0;

  const result = await downloadWithRanges({
    url: 'https://example.com/app.exe',
    total,
    concurrency: 4,
    fetchImpl: async (_url, init) => {
      requests += 1;
      if (requests === 1) {
        assert.ok(rangeOf(init) !== null);
        return errorResponse(416);
      }
      assert.equal(rangeOf(init), null, '回退请求不带 Range');
      return streamResponse(data, 200, { 'content-length': String(total) });
    },
  });

  assert.equal(result.mode, 'single');
  assert.equal(requests, 2);
  assert.deepEqual(result.bytes, data);
});

test('总长未知：单流一次请求，不带 Range', async () => {
  const data = sampleBytes(64 * 1024);
  let requests = 0;

  const result = await downloadWithRanges({
    url: 'https://example.com/app.exe',
    total: null,
    fetchImpl: async (_url, init) => {
      requests += 1;
      assert.equal(rangeOf(init), null);
      return streamResponse(data, 200);
    },
  });

  assert.equal(result.mode, 'single');
  assert.equal(requests, 1);
  assert.deepEqual(result.bytes, data);
  assert.equal(result.total, data.length, '未知总长用实际字节数补齐');
});

// —— 取消 ——

test('取消分片下载：抛出可读取消原因，不返回半包', async () => {
  const total = MIN_CHUNK_BYTES * 4;
  const controller = new AbortController();
  const pending = downloadWithRanges({
    url: 'https://example.com/app.exe',
    total,
    concurrency: 4,
    signal: controller.signal,
    fetchImpl: async (_url, init) => {
      assert.ok(rangeOf(init) !== null);
      // 永不主动关闭的流：只有取消才能结束
      const stream = new ReadableStream<Uint8Array>({});
      return {
        ok: true,
        status: 206,
        headers: new Headers(),
        body: stream,
      } as unknown as Response;
    },
  });
  await delay(10);
  controller.abort();

  await assert.rejects(pending, (cause: unknown) => cause instanceof DownloadCancelledError);
});
