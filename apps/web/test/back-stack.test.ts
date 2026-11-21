import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackStack, handlePageBack, pageBackStack, rootBackStack } from '../src/lib/back-stack.ts';

test('createBackStack：后登记的先处理，栈空返回 false', () => {
  const stack = createBackStack();
  assert.equal(stack.handle(), false, '空栈不处理');
  assert.equal(stack.size(), 0);

  const calls: string[] = [];
  const offA = stack.push(() => calls.push('a'));
  const offB = stack.push(() => calls.push('b'));
  assert.equal(stack.size(), 2);

  assert.equal(stack.handle(), true);
  assert.deepEqual(calls, ['b'], '栈顶先执行');
  // handle 只执行不出栈：退一级后由登记方自己注销（enabled 变 false）
  assert.equal(stack.size(), 2);

  offB();
  assert.equal(stack.handle(), true);
  assert.deepEqual(calls, ['b', 'a']);
  offA();
  assert.equal(stack.size(), 0);
  assert.equal(stack.handle(), false);
});

test('createBackStack：注销中间一项不影响其余顺序，重复注销无副作用', () => {
  const stack = createBackStack();
  const calls: string[] = [];
  stack.push(() => calls.push('a'));
  const offB = stack.push(() => calls.push('b'));
  stack.push(() => calls.push('c'));

  offB();
  offB();
  assert.equal(stack.size(), 2, '重复注销不多删');
  stack.handle();
  assert.deepEqual(calls, ['c']);
});

test('createBackStack：同一函数登记两次可分别注销', () => {
  const stack = createBackStack();
  let count = 0;
  const handler = (): void => {
    count += 1;
  };
  const offFirst = stack.push(handler);
  const offSecond = stack.push(handler);
  assert.equal(stack.size(), 2);

  offFirst();
  assert.equal(stack.size(), 1, '只注销第一次登记');
  assert.equal(stack.handle(), true);
  assert.equal(count, 1);

  offSecond();
  assert.equal(stack.size(), 0);
  assert.equal(stack.handle(), false);
});

test('createBackStack：各栈互不影响', () => {
  const one = createBackStack();
  const two = createBackStack();
  const off = one.push(() => undefined);
  assert.equal(one.size(), 1);
  assert.equal(two.size(), 0);
  assert.equal(two.handle(), false);
  off();
});

test('handlePageBack：先页面栈，页面栈空了才轮到最外一级，与登记先后无关', () => {
  assert.equal(pageBackStack.size(), 0);
  assert.equal(rootBackStack.size(), 0);
  assert.equal(handlePageBack(), false, '两层都空：不处理');

  const calls: string[] = [];
  // 最外一级先登记（父组件 effect 晚跑也一样）：仍排在页面栈之后
  const offRoot = rootBackStack.push(() => calls.push('root'));
  const offGroup = pageBackStack.push(() => calls.push('group'));

  assert.equal(handlePageBack(), true);
  assert.deepEqual(calls, ['group'], '页面栈有登记时最外一级不动');

  offGroup();
  assert.equal(handlePageBack(), true);
  assert.deepEqual(calls, ['group', 'root']);

  offRoot();
  assert.equal(handlePageBack(), false);
  assert.deepEqual(calls, ['group', 'root']);
});

test('handlePageBack：页面栈多层时只退栈顶一级', () => {
  const calls: string[] = [];
  const offRoot = rootBackStack.push(() => calls.push('root'));
  const offOuter = pageBackStack.push(() => calls.push('outer'));
  const offInner = pageBackStack.push(() => calls.push('inner'));

  handlePageBack();
  assert.deepEqual(calls, ['inner']);
  offInner();
  handlePageBack();
  assert.deepEqual(calls, ['inner', 'outer']);
  offOuter();
  offRoot();
  assert.equal(pageBackStack.size(), 0);
  assert.equal(rootBackStack.size(), 0);
});
