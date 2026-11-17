import test from 'node:test';
import assert from 'node:assert/strict';
import { thenableSafePlugin } from '../src/lib/native.ts';


test('thenableSafePlugin：await 插件代理不会调用 then()', async () => {
  const calls: string[] = [];
  const fake = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'ping') return async () => 'pong';
        // 模拟 Capacitor 代理：任意属性都返回可调用函数，包括 then
        return (...args: unknown[]) => {
          calls.push(`${String(property)}(${args.length})`);
          return Promise.resolve(undefined);
        };
      },
    },
  );
  const safe = thenableSafePlugin(fake);
  const loaded = await Promise.resolve(safe);
  assert.equal(loaded, safe);
  assert.deepEqual(calls, [], 'await 时不应触发插件方法');
  assert.equal(await (safe as { ping: () => Promise<string> }).ping(), 'pong');
});
