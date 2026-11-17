import test from 'node:test';
import assert from 'node:assert/strict';
import { busySnapshot, runBusy, useBusyAction } from '../src/lib/busy.ts';

test('runBusy 期间挂上状态，结束（含抛错）一定收起', async () => {
  assert.equal(busySnapshot(), null);

  let seen: string | null = null;
  await runBusy('正在导入…', async () => {
    seen = busySnapshot()?.label ?? null;
  });
  assert.equal(seen, '正在导入…', '进行中能看到操作名');
  assert.equal(busySnapshot(), null, '结束后收起蒙版');

  await assert.rejects(
    runBusy('正在恢复…', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(busySnapshot(), null, '抛错也要收起蒙版');
});

test('嵌套 runBusy 期间状态不提前收起', async () => {
  let innerSaw: string | null = null;
  await runBusy('外层', async () => {
    await runBusy('内层', async () => {
      innerSaw = busySnapshot()?.label ?? null;
    });
    assert.notEqual(busySnapshot(), null, '内层结束后外层仍在进行');
  });
  assert.equal(innerSaw, '内层');
  assert.equal(busySnapshot(), null);
});

test('返回值原样透出', async () => {
  const value = await runBusy('计算', async () => 42);
  assert.equal(value, 42);
});

test('useBusyAction 进行中 busy 为 true，重复触发直接返回 undefined', async () => {
  // hook 要真的渲染一次才能断言：用 jsdom + react-dom/client 挂一个空探针组件
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  // Node 24 里 navigator 是只读的 getter，统一用 defineProperty 覆盖
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }

  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');

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
  assert.equal(apiRef.current?.busy, false, '初始不在进行中');

  // 用一个可控的 Promise 把任务卡在进行中，观察 busy 与重复触发保护
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let runs = 0;
  let first: Promise<string | undefined> = Promise.resolve(undefined);
  await act(async () => {
    first = apiRef.current?.run('正在保存课程…', async () => {
      runs += 1;
      await gate;
      return 'ok';
    }) ?? Promise.resolve(undefined);
  });
  assert.equal(apiRef.current?.busy, true, '任务未结束时 busy 为 true');
  assert.equal(busySnapshot()?.label, '正在保存课程…', '同时挂上整页蒙版状态');

  let duplicate: string | undefined = 'not-run';
  await act(async () => {
    duplicate = await apiRef.current?.run('正在保存课程…', async () => {
      runs += 1;
      return 'second';
    });
  });
  assert.equal(duplicate, undefined, '进行中重复触发返回 undefined');
  assert.equal(runs, 1, '重复触发不会真的再执行任务');

  await act(async () => {
    release();
    await first;
  });
  assert.equal(await first, 'ok', '任务返回值原样透出');
  assert.equal(apiRef.current?.busy, false, '结束后 busy 复位');
  assert.equal(busySnapshot(), null, '结束后蒙版收起');

  await act(async () => {
    root.unmount();
  });
});
