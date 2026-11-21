import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { toast } from 'sonner';
import { pageBackStack, rootBackStack } from '../src/lib/back-stack.ts';
import { backOnBusy, installBackHandlers } from '../src/lib/back-dispatch.ts';
import { busySnapshot, isBusyCancelled, runBusy } from '../src/lib/busy.ts';

// 全文件共用一个 jsdom：back-dispatch 只认全局 window / document / HTMLElement
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  KeyboardEvent: dom.window.KeyboardEvent,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const { document } = dom.window;

function escape(target: EventTarget = document.body, key = 'Escape'): KeyboardEvent {
  const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** 这次之后新弹出的 toast 文案。 */
function toastsSince(count: number): string[] {
  return toast
    .getHistory()
    .slice(count)
    .map((item) => String((item as { title?: unknown }).title ?? ''));
}

function hang(): { task: (signal: AbortSignal) => Promise<never>; signal: () => AbortSignal | null } {
  let seen: AbortSignal | null = null;
  return {
    task: (signal) => {
      seen = signal;
      return new Promise<never>(() => undefined);
    },
    signal: () => seen,
  };
}

test('backOnBusy：没有进行中的操作返回 false，不弹提示', () => {
  const before = toast.getHistory().length;
  assert.equal(backOnBusy(), false);
  assert.deepEqual(toastsSince(before), []);
});

test('Esc 退页面一级：先页面栈再最外一级，处理了才 preventDefault', () => {
  const uninstall = installBackHandlers();
  try {
    const calls: string[] = [];
    const offRoot = rootBackStack.push(() => calls.push('root'));
    const offGroup = pageBackStack.push(() => calls.push('group'));

    const first = escape();
    assert.deepEqual(calls, ['group']);
    assert.equal(first.defaultPrevented, true);

    offGroup();
    escape();
    assert.deepEqual(calls, ['group', 'root']);

    offRoot();
    const idle = escape();
    assert.deepEqual(calls, ['group', 'root']);
    assert.equal(idle.defaultPrevented, false, '没有可退的一级时不吞 Esc（安卓据此退到后台）');
  } finally {
    uninstall();
  }
});

test('Esc 不退页面：其他按键、已被处理的 Esc、有弹窗、焦点在输入框里', () => {
  const uninstall = installBackHandlers();
  const calls: string[] = [];
  const off = pageBackStack.push(() => calls.push('page'));
  try {
    escape(document.body, 'Enter');
    escape(document.body, 'ArrowLeft');
    assert.deepEqual(calls, [], '只认 Escape');

    // 弹窗（Radix）先处理并 preventDefault：页面不再退
    const handledByDialog = (event: Event): void => event.preventDefault();
    document.body.addEventListener('keydown', handledByDialog);
    escape();
    document.body.removeEventListener('keydown', handledByDialog);
    assert.deepEqual(calls, []);

    // 有弹窗开着：交给弹窗自己
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    escape();
    dialog.remove();
    assert.deepEqual(calls, []);

    // 输入框里的 Esc 留给输入框（清空 / 收起候选）
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      document.body.append(field);
      escape(field);
      field.remove();
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom 不实现 isContentEditable：按浏览器行为补上
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(editable);
    escape(editable);
    editable.remove();
    assert.deepEqual(calls, []);

    // 普通按钮上的 Esc 照常退
    const button = document.createElement('button');
    document.body.append(button);
    escape(button);
    button.remove();
    assert.deepEqual(calls, ['page']);
  } finally {
    off();
    uninstall();
  }
});

test('卸载后 Esc 不再处理', () => {
  const uninstall = installBackHandlers();
  uninstall();
  const calls: string[] = [];
  const off = pageBackStack.push(() => calls.push('page'));
  const event = escape();
  off();
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});

test('只读操作进行中按 Esc：取消、提示「已取消」，Esc 被截住，页面与弹窗都不动', async () => {
  const uninstall = installBackHandlers();
  const calls: string[] = [];
  const off = pageBackStack.push(() => calls.push('page'));
  const laterListeners: string[] = [];
  const spy = (): void => {
    laterListeners.push('body');
  };
  document.body.addEventListener('keydown', spy);
  try {
    const job = hang();
    const pending = runBusy('正在检查更新…', job.task, { cancellable: true });
    const before = toast.getHistory().length;

    const event = escape();
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(laterListeners, [], '捕获阶段截住：弹窗（目标上的监听）看不到这次 Esc');
    assert.deepEqual(calls, [], '不顺手退页面');
    assert.deepEqual(toastsSince(before), ['已取消']);
    assert.equal(job.signal()?.aborted, true);
    await assert.rejects(pending, (cause: unknown) => isBusyCancelled(cause));
    assert.equal(busySnapshot(), null, '蒙版收起');

    // 取消之后再按一次：回到普通的页面返回
    escape();
    assert.deepEqual(calls, ['page']);
    assert.deepEqual(laterListeners, ['body']);
  } finally {
    document.body.removeEventListener('keydown', spy);
    off();
    uninstall();
  }
});

test('写入操作进行中按 Esc：提示「正在写入数据，不能中断」，不取消、不退页面、Esc 不往下传', async () => {
  const uninstall = installBackHandlers();
  const calls: string[] = [];
  const off = pageBackStack.push(() => calls.push('page'));
  const laterListeners: string[] = [];
  const spy = (): void => {
    laterListeners.push('body');
  };
  document.body.addEventListener('keydown', spy);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen: AbortSignal | null = null;
  try {
    const pending = runBusy('正在保存课程…', async (signal) => {
      seen = signal;
      await gate;
      return 'saved';
    });
    const before = toast.getHistory().length;

    const event = escape();
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(laterListeners, [], '弹窗看不到这次 Esc，不会被顺手关掉');
    assert.deepEqual(calls, []);
    assert.deepEqual(toastsSince(before), ['正在写入数据，不能中断']);
    assert.equal((seen as AbortSignal | null)?.aborted, false);
    assert.equal(busySnapshot()?.label, '正在保存课程…', '蒙版仍在');

    release();
    assert.equal(await pending, 'saved');
    assert.equal(busySnapshot(), null);
  } finally {
    document.body.removeEventListener('keydown', spy);
    off();
    uninstall();
  }
});

test('只读与写入同时进行：按写入处理，两个都不取消', async () => {
  const uninstall = installBackHandlers();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = hang();
  try {
    const readPending = runBusy('正在测试连接…', read.task, { cancellable: true });
    readPending.catch(() => undefined);
    const writePending = runBusy('正在写入快照…', () => gate);
    const before = toast.getHistory().length;
    escape();
    assert.deepEqual(toastsSince(before), ['正在写入数据，不能中断']);
    assert.equal(read.signal()?.aborted, false);
    release();
    await writePending;

    // 写入结束后只剩只读：这次 Esc 才取消
    const again = toast.getHistory().length;
    escape();
    assert.deepEqual(toastsSince(again), ['已取消']);
    await assert.rejects(readPending, (cause: unknown) => isBusyCancelled(cause));
    assert.equal(busySnapshot(), null);
  } finally {
    uninstall();
  }
});
