import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackStack, handlePageBack, pageBackStack, rootBackStack } from '../src/lib/back-stack.ts';

async function setupReact() {
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
  const react = await import('react');
  const { createRoot } = await import('react-dom/client');
  const host = dom.window.document.createElement('div');
  dom.window.document.body.append(host);
  return { react, root: createRoot(host) };
}

test('useBackHandler：enabled 时登记到页面栈，关掉或卸载即注销，处理函数取最新一次渲染', async () => {
  const { react, root } = await setupReact();
  const { act, createElement } = react;
  const { useBackHandler } = await import('../src/lib/use-back.ts');

  const calls: string[] = [];
  function Probe({ enabled, tag }: { enabled: boolean; tag: string }): null {
    useBackHandler(enabled, () => calls.push(tag));
    return null;
  }

  await act(async () => {
    root.render(createElement(Probe, { enabled: false, tag: 'v1' }));
  });
  assert.equal(pageBackStack.size(), 0, '未启用时不登记');

  await act(async () => {
    root.render(createElement(Probe, { enabled: true, tag: 'v1' }));
  });
  assert.equal(pageBackStack.size(), 1);

  // 只换处理函数不重新登记，但执行的是最新的
  await act(async () => {
    root.render(createElement(Probe, { enabled: true, tag: 'v2' }));
  });
  assert.equal(pageBackStack.size(), 1);
  assert.equal(handlePageBack(), true);
  assert.deepEqual(calls, ['v2']);

  await act(async () => {
    root.render(createElement(Probe, { enabled: false, tag: 'v2' }));
  });
  assert.equal(pageBackStack.size(), 0, '关掉后注销');

  await act(async () => {
    root.render(createElement(Probe, { enabled: true, tag: 'v3' }));
  });
  assert.equal(pageBackStack.size(), 1);
  await act(async () => {
    root.unmount();
  });
  assert.equal(pageBackStack.size(), 0, '卸载后注销');
});

test('useBackHandler：在 BackScopeContext 里登记到弹窗自己的栈，不进页面栈', async () => {
  const { react, root } = await setupReact();
  const { act, createElement } = react;
  const { BackScopeContext, useBackHandler } = await import('../src/lib/use-back.ts');

  const scope = createBackStack();
  let stepped = 0;
  function Step(): null {
    useBackHandler(true, () => {
      stepped += 1;
    });
    return null;
  }
  await act(async () => {
    root.render(createElement(BackScopeContext.Provider, { value: scope }, createElement(Step)));
  });
  assert.equal(scope.size(), 1);
  assert.equal(pageBackStack.size(), 0);
  assert.equal(handlePageBack(), false, '页面层看不到弹窗里的步骤');
  assert.equal(scope.handle(), true);
  assert.equal(stepped, 1);

  await act(async () => {
    root.unmount();
  });
  assert.equal(scope.size(), 0);
});

test('useBackScope：每个组件实例一个稳定的栈，重渲染不换', async () => {
  const { react, root } = await setupReact();
  const { act, createElement } = react;
  const { useBackScope } = await import('../src/lib/use-back.ts');

  const seen: unknown[] = [];
  function Probe({ n }: { n: number }): null {
    seen.push(useBackScope());
    void n;
    return null;
  }
  await act(async () => {
    root.render(createElement('div', null, createElement(Probe, { n: 1 }), createElement(Probe, { n: 1 })));
  });
  await act(async () => {
    root.render(createElement('div', null, createElement(Probe, { n: 2 }), createElement(Probe, { n: 2 })));
  });
  // 没包 StrictMode，渲染次数固定：两个实例 × 两次
  assert.equal(seen.length, 4);
  assert.equal(seen[0], seen[2], '同一实例重渲染拿到同一个栈');
  assert.equal(seen[1], seen[3]);
  assert.notEqual(seen[0], seen[1], '不同实例各有各的栈');
  assert.notEqual(seen[0], pageBackStack);
  await act(async () => {
    root.unmount();
  });
});

test('useRootBackHandler：登记到最外一级，页面栈有登记时排在后面', async () => {
  const { react, root } = await setupReact();
  const { act, createElement } = react;
  const { useBackHandler, useRootBackHandler } = await import('../src/lib/use-back.ts');

  const calls: string[] = [];
  function Child({ group }: { group: boolean }): null {
    useBackHandler(group, () => calls.push('group'));
    return null;
  }
  // 父组件的 effect 晚于子组件跑：靠分栈而不是登记顺序保证最外一级垫底
  function Parent({ leave, group }: { leave: boolean; group: boolean }) {
    useRootBackHandler(leave, () => calls.push('root'));
    return createElement(Child, { group });
  }

  await act(async () => {
    root.render(createElement(Parent, { leave: true, group: true }));
  });
  assert.equal(rootBackStack.size(), 1);
  assert.equal(pageBackStack.size(), 1);
  handlePageBack();
  assert.deepEqual(calls, ['group']);

  await act(async () => {
    root.render(createElement(Parent, { leave: true, group: false }));
  });
  handlePageBack();
  assert.deepEqual(calls, ['group', 'root']);

  await act(async () => {
    root.render(createElement(Parent, { leave: false, group: false }));
  });
  assert.equal(rootBackStack.size(), 0, '在课表页不登记最外一级');
  assert.equal(handlePageBack(), false);

  await act(async () => {
    root.unmount();
  });
});
