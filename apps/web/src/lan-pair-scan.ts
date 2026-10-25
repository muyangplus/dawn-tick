import { isAndroidApp } from './lib/capabilities.ts';
import { errorMessage } from './lib/errors.ts';
import { logInfo, logWarn } from './log.ts';
import type { BarcodeFormat, BarcodeScannerPlugin } from '@capacitor-mlkit/barcode-scanning';

/**
 * 应用内相机扫码（仅 Android 原生）。
 *
 * 依赖：`@capacitor-mlkit/barcode-scanning`（Capacitor 8 兼容）。
 * 为什么用 `startScan` 而不是 `scan()`：
 * - `startScan` 用打包进 APK 的 ML Kit 模型，**不依赖 Google Play 服务**，
 *   国产 ROM / 无 GMS 设备也能用；`scan()` 依赖 Play 服务的条码模块，
 *   在这些设备上会直接失败；
 * - `startScan` 会把相机预览放在 WebView 后面，界面画一层透明覆盖层即可。
 *
 * 边界：
 * - 动态 `import` 插件，Web / 桌面永不加载；
 * - 只负责「拿到第一段文本」；解析配对信息在 `lan-pair-payload.ts`；
 * - 用户取消返回 `null`；不可用 / 权限被拒 / 启动失败抛出可读错误，界面直接展示；
 * - 单测与冒烟通过 `setPairScannerForTests` 注入桩，不加载 Capacitor。
 */

/** 测试 / 冒烟注入的扫码桩：`scan()` 返回文本，`null` 表示用户取消。 */
export interface PairScannerStub {
  scan(): Promise<string | null>;
  /** 默认 true；false 时 `isScanAvailable()` 返回 false（模拟非 Android）。 */
  available?: boolean;
}

let scannerStub: PairScannerStub | null = null;
let activeCancel: (() => void) | null = null;

/** 冒烟 / 单测注入；传 null 恢复真实实现。 */
export function setPairScannerForTests(next: PairScannerStub | null): void {
  scannerStub = next;
}

/** 只有 Android 原生（且有扫码组件）才显示「扫码配对」；Web 与桌面返回 false。 */
export function isScanAvailable(): boolean {
  if (scannerStub !== null) return scannerStub.available !== false;
  return isAndroidApp();
}

/** 把插件/权限错误转成可直接展示的原因。 */
export function describeScanError(message: string): string {
  const text = message.trim();
  const lower = text.toLowerCase();
  if (lower.includes('cancel')) return '已取消扫码';
  if (lower.includes('permission') || lower.includes('denied') || text.includes('相机权限')) {
    return '没有相机权限：请在系统设置 → 应用 → 权限里允许相机后重试';
  }
  if (lower.includes('not available') || lower.includes('not implemented')) {
    return '当前安装包没有扫码组件，请安装最新版本或改用粘贴配对信息';
  }
  if (lower.includes('camera') && (lower.includes('in use') || lower.includes('busy'))) {
    return '相机正被其它应用占用，请关闭后重试';
  }
  return text === '' ? '扫码失败，请重试或粘贴配对信息' : text;
}

interface LoadedScanner {
  scanner: BarcodeScannerPlugin;
  qrCode: BarcodeFormat;
}

async function loadScanner(): Promise<LoadedScanner | null> {
  if (!isAndroidApp()) return null;
  try {
    const module = await import('@capacitor-mlkit/barcode-scanning');
    return { scanner: module.BarcodeScanner, qrCode: module.BarcodeFormat.QrCode };
  } catch (cause: unknown) {
    logWarn('lan-sync', '加载扫码组件失败', { message: errorMessage(cause) });
    return null;
  }
}

/**
 * 打开全屏扫码并返回第一条条码文本；用户取消（或调用 `stopScan()`）返回 `null`。
 * 非 Android、没有组件、权限被拒、启动失败都会抛出可读错误。
 */
export async function scanPairPayload(): Promise<string | null> {
  if (scannerStub !== null) {
    try {
      return await scannerStub.scan();
    } catch (cause: unknown) {
      throw new Error(describeScanError(errorMessage(cause)));
    }
  }
  if (!isAndroidApp()) {
    throw new Error('扫码配对只在安卓版可用；可以改用「粘贴配对信息」');
  }
  const loaded = await loadScanner();
  if (loaded === null) {
    throw new Error('当前安装包没有扫码组件，请安装最新版本或改用粘贴配对信息');
  }
  const { scanner, qrCode } = loaded;
  let supported = false;
  try {
    supported = (await scanner.isSupported()).supported === true;
  } catch (cause: unknown) {
    logWarn('lan-sync', '查询扫码支持失败', { message: errorMessage(cause) });
  }
  if (!supported) throw new Error('当前设备不支持扫码；可以改用「粘贴配对信息」');

  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    let scannedHandle: { remove(): Promise<void> } | null = null;
    let errorHandle: { remove(): Promise<void> } | null = null;

    const cleanup = async (): Promise<void> => {
      activeCancel = null;
      try {
        await scanner.stopScan();
      } catch {
        // 已经停止或相机没起来：忽略
      }
      try {
        await scannedHandle?.remove();
      } catch {
        // 监听已移除
      }
      try {
        await errorHandle?.remove();
      } catch {
        // 监听已移除
      }
    };
    const finish = (text: string | null): void => {
      if (settled) return;
      settled = true;
      void cleanup().then(() => {
        if (text === null) {
          logInfo('lan-sync', '扫码配对已取消');
          resolve(null);
        } else {
          logInfo('lan-sync', '扫码配对已读取');
          resolve(text);
        }
      });
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      void cleanup().then(() => reject(new Error(describeScanError(message))));
    };
    activeCancel = () => finish(null);

    void (async () => {
      try {
        const permission = await scanner.requestPermissions();
        if (permission.camera !== 'granted') {
          fail('相机权限未授予');
          return;
        }
        scannedHandle = await scanner.addListener('barcodesScanned', (event) => {
          const text = event.barcodes
            .map((barcode) => barcode.rawValue)
            .find((value): value is string => typeof value === 'string' && value.trim() !== '');
          if (text !== undefined) finish(text.trim());
        });
        errorHandle = await scanner.addListener('scanError', (event) => {
          fail(event.message);
        });
        await scanner.startScan({ formats: [qrCode] });
        // 取消发生在 startScan 完成之前：补一次停止，避免相机在后台常开
        if (settled) {
          try {
            await scanner.stopScan();
          } catch {
            // 已经停止
          }
        }
      } catch (cause: unknown) {
        fail(errorMessage(cause));
      }
    })();
  });
}

/** 外部取消：关闭相机并让 `scanPairPayload()` 以 `null` 结束；没有扫描时是空操作。 */
export async function stopScan(): Promise<void> {
  const cancel = activeCancel;
  activeCancel = null;
  cancel?.();
  if (scannerStub !== null || !isAndroidApp()) return;
  const loaded = await loadScanner();
  try {
    await loaded?.scanner.stopScan();
  } catch {
    // 没有活动的扫描会话
  }
}
