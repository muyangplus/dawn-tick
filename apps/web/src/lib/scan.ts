import { isAndroidApp } from './capabilities.ts';
import { errorMessage } from './errors.ts';
import { logInfo, logWarn } from '../log.ts';
import { parsePairPayload, type PairPayload } from '../lan-pair-payload.ts';
import type { BarcodeFormat, BarcodeScannerPlugin } from '@capacitor-mlkit/barcode-scanning';

/**
 * 通用「扫一扫」：只负责拿到一条条码文本，以及把文本归一成可处理的载荷。
 *
 * 边界：
 * - 相机实现仍是 `@capacitor-mlkit/barcode-scanning` 的 `startScan`（打包进 APK 的
 *   ML Kit 模型，不依赖 Google Play 服务），Web / 桌面永不加载；
 * - 只返回第一段非空文本；用户取消返回 `null`；
 * - 解析不绑定配对：`parseScannedPayload` 把标准配对链接归为 `pair`，其它内容保留为
 *   `text`，未知 scheme 附带说明，后续可以按 `kind` 扩展（复制、导入、打开链接等）；
 * - 单测与冒烟通过 `setScanStubForTests` 注入桩，不加载 Capacitor。
 */

/** 测试 / 冒烟注入的扫码桩：`scan()` 返回文本，`null` 表示用户取消。 */
export interface ScanStub {
  scan(): Promise<string | null>;
  /** 默认 true；false 时 `isScanAvailable()` 返回 false（模拟非 Android）。 */
  available?: boolean;
}

let scannerStub: ScanStub | null = null;
let activeCancel: (() => void) | null = null;

/** 冒烟 / 单测注入；传 null 恢复真实实现。 */
export function setScanStubForTests(next: ScanStub | null): void {
  scannerStub = next;
}

/** 只有 Android 原生（且有扫码组件）才显示扫一扫；Web 与桌面返回 false。 */
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
    return '当前安装包没有扫码组件，请安装最新版本后重试';
  }
  if (lower.includes('camera') && (lower.includes('in use') || lower.includes('busy'))) {
    return '相机正被其它应用占用，请关闭后重试';
  }
  return text === '' ? '扫码失败，请重试' : text;
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
    logWarn('scan', '加载扫码组件失败', { message: errorMessage(cause) });
    return null;
  }
}

/**
 * 打开全屏扫码并返回第一条条码文本；用户取消（或调用 `stopScanCode()`）返回 `null`。
 * 非 Android、没有组件、权限被拒、启动失败都会抛出可读错误。
 */
export async function scanCodeOnce(): Promise<string | null> {
  if (scannerStub !== null) {
    try {
      return await scannerStub.scan();
    } catch (cause: unknown) {
      throw new Error(describeScanError(errorMessage(cause)));
    }
  }
  if (!isAndroidApp()) {
    throw new Error('扫一扫只在安卓版可用；可以改用「粘贴配对信息」');
  }
  const loaded = await loadScanner();
  if (loaded === null) {
    throw new Error('当前安装包没有扫码组件，请安装最新版本后重试');
  }
  const { scanner, qrCode } = loaded;
  let supported = false;
  try {
    supported = (await scanner.isSupported()).supported === true;
  } catch (cause: unknown) {
    logWarn('scan', '查询扫码支持失败', { message: errorMessage(cause) });
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
          logInfo('scan', '扫码已取消');
          resolve(null);
        } else {
          logInfo('scan', '扫码已读取', { length: text.length });
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

/** 外部取消：关闭相机并让 `scanCodeOnce()` 以 `null` 结束；没有扫描时是空操作。 */
export async function stopScanCode(): Promise<void> {
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

/** 扫到的一段文本：配对载荷，或保留给其他用途的普通文本。 */
export type ScannedPayload =
  | { kind: 'pair'; payload: PairPayload }
  | {
      kind: 'text';
      text: string;
      /** 文本自带的 scheme（`https`、`dawn-tick` 等）；纯文本为 null。 */
      scheme: string | null;
      /** 给用户看的补充说明：空内容、未知 scheme、像配对但解析失败等。 */
      note?: string;
    };

/**
 * 从扫一扫跨页交给「设备与同步」的一次配对请求。
 * `id` 每次递增，组件据此只消费一次，避免重渲染时重复发起配对。
 */
export interface ScannedPairRequest {
  id: number;
  payload: PairPayload;
}

/** 取 URL scheme：`dawn-tick://x` → `dawn-tick`；没有 scheme 返回 null。 */
export function scannedScheme(text: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(text.trim());
  return match === null ? null : (match[1] ?? '').toLowerCase();
}

/**
 * 把扫码文本归一成可处理的载荷。
 *
 * - `dawn-tick://pair?…` 与 `http(s)://host/pair?…` → `{kind:'pair', payload}`；
 * - 其它 `dawn-tick://…`：保留原文并说明「不是有效配对信息」；
 * - http(s) 普通链接与纯文本 → `{kind:'text', text, scheme}`；
 * - 其它 scheme：保留原文并说明暂不支持，避免静默丢弃。
 */
export function parseScannedPayload(input: string): ScannedPayload {
  const text = typeof input === 'string' ? input.trim() : '';
  const scheme = scannedScheme(text);
  if (text === '') return { kind: 'text', text, scheme: null, note: '扫码结果为空' };

  if (scheme === 'dawn-tick' || scheme === 'http' || scheme === 'https' || scheme === null) {
    const parsed = parsePairPayload(text);
    if (parsed.ok) return { kind: 'pair', payload: parsed.payload };
    if (scheme === 'dawn-tick') {
      return {
        kind: 'text',
        text,
        scheme,
        note: `这是晓刻链接，但不能作为配对信息：${parsed.error}`,
      };
    }
  }
  if (scheme === null || scheme === 'http' || scheme === 'https') {
    return { kind: 'text', text, scheme };
  }
  return {
    kind: 'text',
    text,
    scheme,
    note: `暂不支持 ${scheme}:// 链接；内容已保留，可以复制或后续扩展处理`,
  };
}
