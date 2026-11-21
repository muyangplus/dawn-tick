import test from 'node:test';
import assert from 'node:assert/strict';
import { BusyCancelledError, busySnapshot, cancelBusy, isBusyCancelled, runBusy } from '../src/lib/busy.ts';
import { logEntries } from '../src/log.ts';

/** 可控的任务：拿到 signal 后挂起，等调用方放行。 */
function gated<T>(value: T): {
  task: (signal: AbortSignal) => Promise<T>;
  release: () => void;
  signal: () => AbortSignal | null;
} {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen: AbortSignal | null = null;
  return {
    task: async (signal) => {
      seen = signal;
      await gate;
      return value;
    },
    release: () => release(),
    signal: () => seen,
  };
}

test('cancelBusy：没有进行中的操作返回 idle', () => {
  assert.equal(busySnapshot(), null);
  assert.equal(cancelBusy(), 'idle');
  assert.equal(busySnapshot(), null);
});

test('可取消的操作：cancelBusy 立即以 BusyCancelledError 结束、中止 signal 并收起蒙版', async () => {
  const job = gated('late');
  const pending = runBusy('正在检查更新…', job.task, { cancellable: true });
  assert.deepEqual(busySnapshot(), { label: '正在检查更新…', count: 1, cancellable: true });
  assert.equal(job.signal()?.aborted, false, '取消前 signal 未中止');

  const before = new Set(logEntries());
  assert.equal(cancelBusy(), 'cancelled');
  assert.equal(job.signal()?.aborted, true, '取消后 signal 中止，底层请求可以停下');

  await assert.rejects(pending, (cause: unknown) => {
    assert.ok(cause instanceof BusyCancelledError);
    assert.equal(isBusyCancelled(cause), true);
    assert.equal((cause as Error).name, 'BusyCancelledError');
    assert.equal((cause as Error).message, '已取消（正在检查更新…）');
    return true;
  });
  assert.equal(busySnapshot(), null, '取消后蒙版收起，不等底层跑完');
  assert.equal(cancelBusy(), 'idle', '再按一次已经没有可取消的');

  const added = logEntries().filter((entry) => !before.has(entry));
  assert.deepEqual(
    added.map((entry) => [entry.level, entry.scope, entry.message, entry.detail?.['labels']]),
    [['info', 'app', '用户取消了进行中的操作', ['正在检查更新…']]],
  );

  // 不认 signal 的底层调用在后台跑完：不得再次改动蒙版
  job.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(busySnapshot(), null);
});

test('写入操作（未声明 cancellable）：cancelBusy 返回 locked，任务照常跑完', async () => {
  const job = gated(7);
  const pending = runBusy('正在保存课程…', job.task);
  assert.equal(busySnapshot()?.cancellable, false);

  assert.equal(cancelBusy(), 'locked');
  assert.equal(job.signal()?.aborted, false, '写入不被中止');
  assert.deepEqual(busySnapshot(), { label: '正在保存课程…', count: 1, cancellable: false }, '蒙版仍在');

  job.release();
  assert.equal(await pending, 7, '结果原样透出');
  assert.equal(busySnapshot(), null);
});

test('cancellable: false 与不传一样按写入处理', async () => {
  const job = gated(undefined);
  const pending = runBusy('正在导入…', job.task, { cancellable: false });
  assert.equal(cancelBusy(), 'locked');
  job.release();
  await pending;
  assert.equal(busySnapshot(), null);
});

test('同时进行只读与写入：一个都不取消；写入结束后只读的才能取消', async () => {
  const read = gated('read');
  const write = gated('write');
  const readPending = runBusy('正在测试连接…', read.task, { cancellable: true });
  const writePending = runBusy('正在写入快照…', write.task);
  assert.deepEqual(busySnapshot(), { label: '正在写入快照…', count: 2, cancellable: false }, '只要有写入就不可取消');

  assert.equal(cancelBusy(), 'locked');
  assert.equal(read.signal()?.aborted, false, '有写入在进行时只读的也不动');
  assert.equal(write.signal()?.aborted, false);

  write.release();
  assert.equal(await writePending, 'write');
  assert.deepEqual(busySnapshot(), { label: '正在测试连接…', count: 1, cancellable: true });

  assert.equal(cancelBusy(), 'cancelled');
  await assert.rejects(readPending, BusyCancelledError);
  assert.equal(busySnapshot(), null);
  read.release();
});

test('多个只读操作同时进行：一次全部取消', async () => {
  const first = gated(1);
  const second = gated(2);
  const firstPending = runBusy('正在识别…', first.task, { cancellable: true });
  const secondPending = runBusy('正在检查预设…', second.task, { cancellable: true });
  assert.deepEqual(busySnapshot(), { label: '正在检查预设…', count: 2, cancellable: true });

  assert.equal(cancelBusy(), 'cancelled');
  assert.equal(first.signal()?.aborted, true);
  assert.equal(second.signal()?.aborted, true);
  const settled = await Promise.allSettled([firstPending, secondPending]);
  assert.deepEqual(
    settled.map((item) => item.status === 'rejected' && isBusyCancelled(item.reason)),
    [true, true],
  );
  assert.equal(busySnapshot(), null);
  first.release();
  second.release();
});

test('取消后底层以 AbortError 拒绝：调用方只看到 BusyCancelledError，没有未处理的拒绝', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const pending = runBusy(
      '正在下载预设…',
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      { cancellable: true },
    );
    assert.equal(cancelBusy(), 'cancelled');
    await assert.rejects(pending, BusyCancelledError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('已完成的可取消操作不会被之后的 cancelBusy 波及', async () => {
  let seen: AbortSignal | null = null;
  const value = await runBusy(
    '正在检查…',
    async (signal) => {
      seen = signal;
      return 'done';
    },
    { cancellable: true },
  );
  assert.equal(value, 'done');
  assert.equal(cancelBusy(), 'idle');
  assert.equal((seen as AbortSignal | null)?.aborted, false);
});

test('可取消的操作照样受超时约束，超时不当作取消', async () => {
  await assert.rejects(
    runBusy('正在检查更新…', () => new Promise<never>(() => undefined), { timeoutMs: 5, cancellable: true }),
    (cause: unknown) => !isBusyCancelled(cause) && /操作超时（正在检查更新…）/.test((cause as Error).message),
  );
  assert.equal(busySnapshot(), null);
});

test('超时：先以超时报错再中止 signal，底层请求能停下，迟到结果可按 signal.aborted 丢弃', async () => {
  const job = gated('late');
  const pending = runBusy('正在识别…', job.task, { timeoutMs: 5, cancellable: true });
  assert.equal(job.signal()?.aborted, false, '超时前 signal 未中止');
  let rejection: unknown = null;
  await pending.catch((cause: unknown) => {
    rejection = cause;
  });
  assert.ok(rejection instanceof Error);
  assert.equal(isBusyCancelled(rejection), false, '超时不当作用户取消');
  assert.match((rejection as Error).message, /操作超时（正在识别…）/);
  assert.equal(job.signal()?.aborted, true, '超时后 signal 中止');
  assert.equal(busySnapshot(), null);
  job.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(busySnapshot(), null, '迟到的结果不再改动蒙版');
});

test('超时：不可取消的操作同样中止 signal', async () => {
  const job = gated('late');
  await assert.rejects(runBusy('正在生成…', job.task, { timeoutMs: 5 }), (cause: unknown) => !isBusyCancelled(cause) && /操作超时/.test((cause as Error).message));
  assert.equal(job.signal()?.aborted, true);
  job.release();
});

test('超时之前正常完成：signal 不被中止，计时器不再触发', async () => {
  let seen: AbortSignal | null = null;
  const value = await runBusy('正在识别…', async (signal) => {
    seen = signal;
    return 'ok';
  }, { timeoutMs: 5 });
  assert.equal(value, 'ok');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal((seen as AbortSignal | null)?.aborted, false);
});

test('isBusyCancelled 只认 BusyCancelledError', () => {
  assert.equal(isBusyCancelled(new BusyCancelledError('x')), true);
  assert.equal(isBusyCancelled(new Error('已取消（x）')), false);
  assert.equal(isBusyCancelled(new DOMException('aborted', 'AbortError')), false);
  assert.equal(isBusyCancelled(null), false);
  assert.equal(isBusyCancelled('BusyCancelledError'), false);
});

test('useBusyAction：取消不记「操作失败」日志，错误原样抛给调用方', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useBusyAction } = await import('../src/lib/busy.ts');

  type Api = ReturnType<typeof useBusyAction>;
  const apiRef: { current: Api | null } = { current: null };
  function Probe(): null {
    apiRef.current = useBusyAction();
    return null;
  }
  const host = dom.window.document.createElement('div');
  dom.window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Probe));
  });

  const before = new Set(logEntries());
  let pending: Promise<unknown> = Promise.resolve();
  let seen: AbortSignal | null = null;
  await act(async () => {
    pending =
      apiRef.current?.run(
        '正在测试连接…',
        (signal) => {
          seen = signal;
          return new Promise<never>(() => undefined);
        },
        { cancellable: true },
      ) ?? Promise.resolve();
    // 先挂上 catch，避免取消前就被当成未处理的拒绝
    pending.catch(() => undefined);
  });
  assert.equal(apiRef.current?.busy, true);
  assert.equal(busySnapshot()?.cancellable, true, 'cancellable 透传到 runBusy');

  await act(async () => {
    assert.equal(cancelBusy(), 'cancelled');
    await pending.catch(() => undefined);
  });
  await assert.rejects(pending, BusyCancelledError);
  assert.equal((seen as AbortSignal | null)?.aborted, true);
  assert.equal(apiRef.current?.busy, false, '取消后按钮复位');
  assert.equal(busySnapshot(), null);
  const errors = logEntries().filter((entry) => !before.has(entry) && entry.level === 'error');
  assert.deepEqual(errors, [], '取消不是失败');

  // 不传 cancellable 时按写入处理
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writePending: Promise<unknown> = Promise.resolve();
  await act(async () => {
    writePending = apiRef.current?.run('正在保存…', () => gate.then(() => 'saved')) ?? Promise.resolve();
  });
  assert.equal(busySnapshot()?.cancellable, false);
  assert.equal(cancelBusy(), 'locked');
  await act(async () => {
    release();
    await writePending;
  });
  assert.equal(await writePending, 'saved');

  await act(async () => {
    root.unmount();
  });
});
