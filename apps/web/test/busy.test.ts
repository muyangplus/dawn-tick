import test from 'node:test';
import assert from 'node:assert/strict';
import { busySnapshot, runBusy } from '../src/lib/busy.ts';

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
