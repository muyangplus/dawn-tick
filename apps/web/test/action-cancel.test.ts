import test from 'node:test';
import assert from 'node:assert/strict';
import { toast } from 'sonner';
import { busySnapshot, cancelBusy } from '../src/lib/busy.ts';
import { logEntries } from '../src/log.ts';

test('useAction：cancellable 的动作被取消时返回 cancelled，不记失败、不弹失败或成功提示', async () => {
  // 与 action.test.ts 一样用 jsdom 挂空探针组件
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
  const { useAction } = await import('../src/lib/action.ts');

  type Api = ReturnType<typeof useAction>;
  type Result = Awaited<ReturnType<Api['run']>>;
  const apiRef: { current: Api | null } = { current: null };
  function Probe(): null {
    apiRef.current = useAction();
    return null;
  }
  const host = dom.window.document.createElement('div');
  dom.window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Probe));
  });

  const logsBefore = new Set(logEntries());
  const toastsBefore = toast.getHistory().length;
  let seen: AbortSignal | null = null;
  let afterAbort = false;
  let pending: Promise<Result> | null = null;
  await act(async () => {
    pending =
      apiRef.current?.run({
        scope: 'sync',
        label: '正在测试连接…',
        ok: '连接成功',
        fail: { what: '连接失败' },
        cancellable: true,
        task: async (signal) => {
          seen = signal;
          // 不认 signal 的底层调用：等取消后才返回
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
          afterAbort = true;
          return 'late';
        },
      }) ?? null;
  });
  assert.equal(apiRef.current?.busy, true);
  assert.equal(busySnapshot()?.cancellable, true, 'cancellable 透传到蒙版状态');
  assert.equal((seen as AbortSignal | null)?.aborted, false);

  await act(async () => {
    assert.equal(cancelBusy(), 'cancelled');
    if (pending !== null) await pending;
  });
  assert.deepEqual(await pending, { ok: false, value: undefined, error: null, cancelled: true });
  assert.equal((seen as AbortSignal | null)?.aborted, true, 'task 收到的 signal 已中止');
  assert.equal(afterAbort, true);
  assert.equal(apiRef.current?.busy, false, '取消后按钮复位');
  assert.equal(busySnapshot(), null, '蒙版收起');
  assert.deepEqual(
    logEntries().filter((entry) => !logsBefore.has(entry) && (entry.level === 'error' || entry.level === 'warn')),
    [],
    '取消不记失败日志',
  );
  assert.equal(toast.getHistory().length, toastsBefore, '取消不弹成功/失败 toast（「已取消」由返回键那边给）');

  // 不开 cancellable：同一 hook 的动作按写入处理，取消无效、照常成功
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writeSignal: AbortSignal | null = null;
  let writing: Promise<Result> | null = null;
  await act(async () => {
    writing =
      apiRef.current?.run({
        scope: 'backup',
        label: '正在写入…',
        task: async (signal) => {
          writeSignal = signal;
          await gate;
          return 3;
        },
      }) ?? null;
  });
  assert.equal(busySnapshot()?.cancellable, false);
  assert.equal(cancelBusy(), 'locked');
  assert.equal((writeSignal as AbortSignal | null)?.aborted, false, '写入的 signal 不中止');
  await act(async () => {
    release();
    if (writing !== null) await writing;
  });
  assert.deepEqual(await writing, { ok: true, value: 3, error: null });

  // 普通失败仍然是失败：没有 cancelled 字段
  let failure: Result | null = null;
  await act(async () => {
    failure =
      (await apiRef.current?.run({
        scope: 'sync',
        label: '正在测试连接…',
        cancellable: true,
        log: false,
        task: async () => {
          throw new Error('401');
        },
      })) ?? null;
  });
  assert.deepEqual(failure, { ok: false, value: undefined, error: '401' });

  await act(async () => {
    root.unmount();
  });
});
