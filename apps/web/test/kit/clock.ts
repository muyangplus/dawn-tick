import type { SuiteContext, TestContext } from 'node:test';

/** 用例默认的“现在”：2026-10-13（周二）10:30 Asia/Shanghai。 */
export const FIXED_NOW = Date.UTC(2026, 9, 13, 2, 30, 0);

/**
 * 只冻结 Date：setTimeout/setImmediate 保持真实——
 * 模拟 setImmediate 会让 fake-indexeddb 永远等不到回调。
 */
export function freezeDate(t: TestContext | SuiteContext, now: number = FIXED_NOW): void {
  // beforeEach 的参数类型含 SuiteContext；只有用例上下文带 mock
  if (!('mock' in t)) throw new Error('freezeDate 只能在用例或 beforeEach 中调用');
  t.mock.timers.enable({ apis: ['Date'], now });
}
