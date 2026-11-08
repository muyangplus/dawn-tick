import {
  describeScanError,
  isScanAvailable,
  scanCodeOnce,
  setScanStubForTests,
  stopScanCode,
} from './lib/scan.ts';

/**
 * 配对面板沿用的扫码入口：实现已泛化到 `lib/scan.ts` 的「扫一扫」。
 *
 * 保留这些名字是为了配对面板、单测与既有调用方无需改语义；新代码应直接用
 * `lib/scan.ts` 的 `scanCodeOnce()` / `parseScannedPayload()`。
 */

/** 测试 / 冒烟注入的扫码桩：`scan()` 返回文本，`null` 表示用户取消。 */
export interface PairScannerStub {
  scan(): Promise<string | null>;
  /** 默认 true；false 时 `isScanAvailable()` 返回 false（模拟非 Android）。 */
  available?: boolean;
}

/** 冒烟 / 单测注入；传 null 恢复真实实现。 */
export function setPairScannerForTests(next: PairScannerStub | null): void {
  setScanStubForTests(next);
}

/** 配对面板的「扫码配对」与通用「扫一扫」使用同一次相机扫描。 */
export function scanPairPayload(): Promise<string | null> {
  return scanCodeOnce();
}

/** 外部取消：关闭相机并让扫码以 `null` 结束。 */
export function stopScan(): Promise<void> {
  return stopScanCode();
}

export { describeScanError, isScanAvailable };
