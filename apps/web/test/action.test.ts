import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from '../src/lib/errors.ts';

test('errorMessage 归一 Error / 字符串 / 空值 / 其他', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage('直接是字符串'), '直接是字符串');
  assert.equal(errorMessage(null), '未知错误');
  assert.equal(errorMessage(undefined), '未知错误');
  assert.equal(errorMessage(null, '原生调用失败'), '原生调用失败');
  assert.equal(errorMessage(42), '42');
});

test('useAction：成功透出返回值，失败归一错误并对取消/重复触发返回 ok=false', async () => {
  // hook 要真的渲染一次才能断言：与 busy.test.ts 一样用 jsdom 挂空探针组件
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
  assert.equal(apiRef.current?.busy, false, '初始不在进行中');

  // 成功：返回值与 ok 状态
  let success: Result | null = null;
  await act(async () => {
    success = (await apiRef.current?.run({ scope: 'test', label: '正在计算…', task: async () => 42 })) ?? null;
  });
  assert.deepEqual(success, { ok: true, value: 42, error: null });
  assert.equal(apiRef.current?.busy, false);

  // 失败：错误归一，不向调用方抛出
  let failure: Result | null = null;
  await act(async () => {
    failure =
      (await apiRef.current?.run({
        scope: 'test',
        label: '正在保存…',
        task: async () => {
          throw new Error('boom');
        },
      })) ?? null;
  });
  assert.deepEqual(failure, { ok: false, value: undefined, error: 'boom' });

  // confirm 返回 false：任务不执行，且不进入 busy
  let ran = 0;
  let cancelled: Result | null = null;
  await act(async () => {
    cancelled =
      (await apiRef.current?.run({
        scope: 'test',
        label: '正在删除…',
        confirm: () => false,
        task: async () => {
          ran += 1;
        },
      })) ?? null;
  });
  assert.deepEqual(cancelled, { ok: false, value: undefined, error: null });
  assert.equal(ran, 0, '取消后不执行任务');

  // 重复触发：进行中再点一次，直接返回 ok=false 且不重复执行
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let runs = 0;
  let first: Promise<Result> | null = null;
  await act(async () => {
    first = apiRef.current?.run({
      scope: 'test',
      label: '正在导入…',
      task: async () => {
        runs += 1;
        await gate;
        return 'done';
      },
    }) ?? null;
  });
  assert.equal(apiRef.current?.busy, true, '任务未结束时 busy 为 true');

  let duplicate: Result | null = null;
  await act(async () => {
    duplicate =
      (await apiRef.current?.run({
        scope: 'test',
        label: '正在导入…',
        task: async () => {
          runs += 1;
          return 'second';
        },
      })) ?? null;
  });
  assert.deepEqual(duplicate, { ok: false, value: undefined, error: null });
  assert.equal(runs, 1, '重复触发不会真的再执行任务');

  await act(async () => {
    release();
    if (first !== null) await first;
  });
  assert.deepEqual(await first, { ok: true, value: 'done', error: null });
  assert.equal(apiRef.current?.busy, false, '结束后 busy 复位');
  assert.equal(dom.window.document.body.contains(host), true);

  await act(async () => {
    root.unmount();
  });
});
