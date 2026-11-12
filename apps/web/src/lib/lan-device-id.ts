/**
 * 本机稳定的局域网设备 id（`deviceId`）。
 *
 * 用途：UDP 发现广播与配对二维码都带上它，另一端把它写进配对记录的 `deviceId`。
 * 之后换 IP、双方一起换 Wi-Fi、重启应用都按同一个 id 认回同一台设备；
 * **只有卸载重装 / 清除应用数据才会重新生成**（清掉 localStorage / 应用数据）。
 *
 * 边界：
 * - 生成优先 `crypto.randomUUID()`（标准 UUID v4，36 字符，满足协议安全字符集）；
 * - 持久化优先 `localStorage['dt.lan.deviceId']`；隐私模式 / 存储被禁用时退回内存，
 *   只在本会话内稳定；
 * - 这里只做 id 本身，不碰网络、配对记录或界面；协议校验在 `normalizeLanDeviceId`。
 */

/** localStorage 键：与其它 `dt.lan.*` 客户端配置同前缀，只存设备 id，不含凭据。 */
export const LAN_DEVICE_ID_STORAGE_KEY = 'dt.lan.deviceId';

/** 设备 id：字母数字与 `-_.:`，1–64 字符（与 Rust / Kotlin / 发现包校验一致）。 */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** 归一设备 id：去空白后必须匹配安全字符集；不合法返回 null。 */
export function normalizeLanDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return DEVICE_ID_PATTERN.test(text) ? text : null;
}

/** 本机生成后缓存的 id：localStorage 不可用时它保证本次会话内不变。 */
let memoryId: string | null = null;
/** 单测 / 冒烟注入；非 null 时优先于存储。 */
let testOverride: string | null = null;

function storageApi(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    const local = globalThis.localStorage;
    if (local === undefined || local === null) return null;
    return typeof local.getItem === 'function' && typeof local.setItem === 'function' ? local : null;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  const local = storageApi();
  if (local === null) return null;
  try {
    return normalizeLanDeviceId(local.getItem(LAN_DEVICE_ID_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  const local = storageApi();
  if (local === null) return;
  try {
    local.setItem(LAN_DEVICE_ID_STORAGE_KEY, value);
  } catch {
    // 存储被禁用 / 配额满：只保留内存值，不阻断开配对
  }
}

/** 生成一个 UUID v4 形态的设备 id。 */
function generateDeviceId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  // 极少数非安全上下文没有 randomUUID：仍生成 UUID v4 形状（不引第三方依赖）
  if (cryptoApi !== undefined && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // 最后兜底：测试环境或运行时完全没有 Web Crypto
  return `dt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 取本机稳定设备 id：已持久化就直接用，否则生成并写回。
 *
 * 读取顺序：测试注入 → 会话内存 → localStorage → 新生成。
 * localStorage 不可用时生成结果只留在内存，本次会话内仍稳定。
 */
export function getOrCreateLanDeviceId(): string {
  if (testOverride !== null) return testOverride;
  if (memoryId !== null) return memoryId;
  const stored = readStored();
  if (stored !== null) {
    memoryId = stored;
    return stored;
  }
  const created = generateDeviceId();
  memoryId = created;
  writeStored(created);
  return created;
}

/**
 * 冒烟 / 单测注入：传 null 清除注入并忘记内存值，让下一次调用重新读存储。
 * 非法的注入值按「清除」处理，避免测试里拿到不合法 id。
 */
export function setLanDeviceIdForTests(value: string | null): void {
  testOverride = normalizeLanDeviceId(value);
  memoryId = null;
}
