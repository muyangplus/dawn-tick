import type { Storage } from '@dawn-tick/core';
import { logWarn } from '../log.ts';
import { isAndroidApp, isDesktopApp } from './capabilities.ts';
import { errorMessage } from './errors.ts';
import { invokeNative } from './native.ts';
import { PLUGIN_NAMES, loadPlugin, type SecretStorePlugin } from './plugins.ts';

/**
 * 本机机密的加密存储（当前只有 WebDAV 密码）。
 *
 * 存储形态：设置键里放自描述信封 `enc:v1:<Base64 密文>`，密文由平台密钥加解密：
 * - Windows（Tauri）走 DPAPI `CryptProtectData`，密文只能在同一台机器、同一个 Windows
 *   用户下解开，换机 / 换账户 / 重装系统后需要重新输入密码；
 * - Android 走 AndroidKeyStore 里的 AES-256-GCM 密钥，随应用卸载一起销毁。
 *
 * 兼容旧数据：读到没有信封前缀的值就按旧版明文处理，加密能力可用时立刻加密并写回；
 * 平台确实没有加密能力（纯浏览器）时保留明文，并由界面显式提示「本平台不支持加密」。
 *
 * 边界：只认识一个键（`webdav_password`），没有密钥生命周期管理；WebDAV 密码不参与备份导出。
 */

/** 设置键，与 core `settings.ts` 的 `webdav_password` 逐字一致；改名等于丢密码。 */
export const WEBDAV_PASSWORD_META_KEY = 'webdav_password';

/** 密文信封前缀：`enc:v1:<Base64 密文>`。 */
export const SECRET_ENVELOPE_PREFIX = 'enc:v1:';

/** 无原生加密能力时的固定说明（界面与测试共用一句）。 */
export const ENCRYPTION_UNAVAILABLE_TEXT = '本平台不支持加密，密码以明文保存在本机';

/** 平台密钥库：只收发 Base64 密文，不认识信封文本，也不落盘。 */
export interface SecretStore {
  /** 加密明文，返回 Base64 密文。 */
  encrypt(plaintext: string): Promise<string>;
  /** 解密 Base64 密文；密钥不可用或密文损坏时抛错。 */
  decrypt(ciphertext: string): Promise<string>;
  /** 平台密钥是否可用；不可用时调用方回退明文。 */
  isAvailable(): Promise<boolean>;
}

/** 信封解析结果：空 / 旧版明文 / 加密信封。 */
export type SecretEnvelope =
  | { kind: 'empty' }
  | { kind: 'plaintext'; value: string }
  | { kind: 'encrypted'; ciphertext: string };

/** 是否是加密信封文本。 */
export function isSecretEnvelope(raw: string): boolean {
  return raw.startsWith(SECRET_ENVELOPE_PREFIX);
}

/**
 * 解析存储值：空串是「没设过」，带前缀是密文，其余一律按旧版明文。
 * 不做 trim：密码里的空格是内容的一部分，只有空串才算未设置。
 */
export function readSecretEnvelope(raw: string | null | undefined): SecretEnvelope {
  if (raw === null || raw === undefined || raw === '') return { kind: 'empty' };
  if (!isSecretEnvelope(raw)) return { kind: 'plaintext', value: raw };
  return { kind: 'encrypted', ciphertext: raw.slice(SECRET_ENVELOPE_PREFIX.length) };
}

/** 把 Base64 密文封成信封文本；空密文是调用方的 bug，直接拒绝。 */
export function sealSecret(ciphertext: string): string {
  if (ciphertext === '') throw new Error('加密结果为空，拒绝写入');
  return `${SECRET_ENVELOPE_PREFIX}${ciphertext}`;
}

/** 只需要读写 `app_meta`：调用方传完整 Storage 也能用。 */
export type PasswordStorage = Pick<Storage, 'readMeta' | 'writeMeta'>;

function createTauriSecretStore(): SecretStore {
  return {
    async encrypt(plaintext: string): Promise<string> {
      const ciphertext = await invokeNative<string>('secret_encrypt', { plaintext });
      if (ciphertext === undefined || ciphertext === '') throw new Error('桌面端没有返回密文');
      return ciphertext;
    },
    async decrypt(ciphertext: string): Promise<string> {
      const value = await invokeNative<string>('secret_decrypt', { ciphertext });
      if (value === undefined) throw new Error('桌面端没有返回明文');
      return value;
    },
    // DPAPI 随 Windows 用户登录上下文提供，桌面壳里恒可用（失败会在加解密时暴露）
    isAvailable: async (): Promise<boolean> => true,
  };
}

function createAndroidSecretStore(): SecretStore {
  let loading: Promise<SecretStorePlugin | null> | null = null;
  const load = (): Promise<SecretStorePlugin | null> => {
    loading ??= loadPlugin<SecretStorePlugin>(PLUGIN_NAMES.secretStore);
    return loading;
  };
  return {
    async encrypt(plaintext: string): Promise<string> {
      const plugin = await load();
      if (plugin === null) throw new Error('安卓密钥库插件不可用');
      const result = await plugin.encrypt({ value: plaintext });
      if (typeof result.ciphertext !== 'string' || result.ciphertext === '') {
        throw new Error('安卓端没有返回密文');
      }
      return result.ciphertext;
    },
    async decrypt(ciphertext: string): Promise<string> {
      const plugin = await load();
      if (plugin === null) throw new Error('安卓密钥库插件不可用');
      const result = await plugin.decrypt({ ciphertext });
      if (typeof result.value !== 'string') throw new Error('安卓端没有返回明文');
      return result.value;
    },
    async isAvailable(): Promise<boolean> {
      const plugin = await load();
      if (plugin === null) return false;
      try {
        return (await plugin.isAvailable()).available === true;
      } catch {
        return false;
      }
    },
  };
}

/** 测试注入：`undefined` 恢复真实平台解析，`null` 显式模拟「没有加密能力」。 */
let injected: SecretStore | null | undefined;
let resolved: Promise<SecretStore | null> | undefined;

export function setSecretStoreForTests(store: SecretStore | null | undefined): void {
  injected = store;
  resolved = undefined;
}

async function detectStore(): Promise<SecretStore | null> {
  if (isDesktopApp()) return createTauriSecretStore();
  if (isAndroidApp()) return createAndroidSecretStore();
  return null;
}

async function resolveStore(): Promise<SecretStore | null> {
  if (injected !== undefined) return injected;
  resolved ??= detectStore();
  return resolved;
}

async function requireStore(): Promise<SecretStore> {
  const store = await resolveStore();
  if (store === null) throw new Error(ENCRYPTION_UNAVAILABLE_TEXT);
  return store;
}

/** 本平台是否具备加密能力；界面据此决定提示文案。 */
export async function isEncryptionAvailable(): Promise<boolean> {
  const store = await resolveStore();
  if (store === null) return false;
  try {
    return await store.isAvailable();
  } catch {
    return false;
  }
}

/** 密码的持久化状态：`migrated` 表示刚刚把旧明文升级成密文。 */
export type WebdavPasswordState = 'empty' | 'encrypted' | 'migrated' | 'plaintext' | 'error';

export interface WebdavPasswordInfo {
  /** 供本次会话使用的明文；解密失败时为空串 */
  password: string;
  state: WebdavPasswordState;
  /** 可读说明（界面直接展示）；正常态为 null */
  message: string | null;
  encryptionAvailable: boolean;
}

/** 解密任意存储值（信封透明）；旧版明文原样返回。失败抛可读错误。 */
export async function revealSecret(raw: string | null | undefined): Promise<string> {
  const envelope = readSecretEnvelope(raw);
  if (envelope.kind === 'empty') return '';
  if (envelope.kind === 'plaintext') return envelope.value;
  const store = await requireStore();
  try {
    return await store.decrypt(envelope.ciphertext);
  } catch (cause: unknown) {
    logWarn('credentials', '解密已保存的密码失败', { error: errorMessage(cause) });
    throw new Error(`已保存的密码无法解密，请重新输入（${errorMessage(cause)}）`);
  }
}

/**
 * 读取 WebDAV 密码：透明解密；旧版明文在能力可用时自动加密并写回。
 * 读取或解密失败都返回 `state: 'error'` 与可读说明，不抛出（界面要能继续渲染）。
 */
export async function readWebdavPassword(storage: PasswordStorage): Promise<WebdavPasswordInfo> {
  const available = await isEncryptionAvailable();
  let raw = '';
  try {
    raw = (await storage.readMeta(WEBDAV_PASSWORD_META_KEY)) ?? '';
  } catch (cause: unknown) {
    return {
      password: '',
      state: 'error',
      message: `读取已保存的密码失败：${errorMessage(cause)}`,
      encryptionAvailable: available,
    };
  }

  const envelope = readSecretEnvelope(raw);
  if (envelope.kind === 'empty') {
    return { password: '', state: 'empty', message: null, encryptionAvailable: available };
  }
  if (envelope.kind === 'plaintext') {
    if (!available) {
      return { password: envelope.value, state: 'plaintext', message: ENCRYPTION_UNAVAILABLE_TEXT, encryptionAvailable: false };
    }
    try {
      const store = await requireStore();
      const ciphertext = await store.encrypt(envelope.value);
      await storage.writeMeta(WEBDAV_PASSWORD_META_KEY, sealSecret(ciphertext));
      return { password: envelope.value, state: 'migrated', message: null, encryptionAvailable: true };
    } catch (cause: unknown) {
      const reason = errorMessage(cause);
      logWarn('credentials', '旧明文密码迁移加密失败', { error: reason });
      return {
        password: envelope.value,
        state: 'plaintext',
        message: `密码仍以明文保存在本机（加密失败：${reason}）`,
        encryptionAvailable: true,
      };
    }
  }
  if (!available) {
    return {
      password: '',
      state: 'error',
      message: '当前平台不支持解密已保存的密码，请重新输入',
      encryptionAvailable: false,
    };
  }
  try {
    const store = await requireStore();
    const password = await store.decrypt(envelope.ciphertext);
    return { password, state: 'encrypted', message: null, encryptionAvailable: true };
  } catch (cause: unknown) {
    const reason = errorMessage(cause);
    logWarn('credentials', '解密已保存的密码失败', { error: reason });
    return {
      password: '',
      state: 'error',
      message: '已保存的密码无法解密（可能更换了系统账户或设备），请重新输入 WebDAV 密码',
      encryptionAvailable: true,
    };
  }
}

export type SaveWebdavPasswordState = 'empty' | 'encrypted' | 'plaintext' | 'failed';

export interface SaveWebdavPasswordResult {
  state: SaveWebdavPasswordState;
  message: string | null;
  /** 失败原因（可直接展示）；成功为 null */
  error: string | null;
  encryptionAvailable: boolean;
}

/**
 * 保存 WebDAV 密码：空串表示清除；有加密能力时只写密文信封，
 * 没有能力时按旧版明文写并标记 `plaintext`；加密或写入失败时不覆盖旧值。
 */
export async function saveWebdavPassword(
  storage: PasswordStorage,
  password: string,
): Promise<SaveWebdavPasswordResult> {
  const available = await isEncryptionAvailable();
  const write = async (value: string): Promise<string | null> => {
    try {
      await storage.writeMeta(WEBDAV_PASSWORD_META_KEY, value);
      return null;
    } catch (cause: unknown) {
      logWarn('credentials', '写入已保存的密码失败', { error: errorMessage(cause) });
      return `写入失败：${errorMessage(cause)}`;
    }
  };

  if (password === '') {
    const error = await write('');
    return error === null
      ? { state: 'empty', message: null, error: null, encryptionAvailable: available }
      : { state: 'failed', message: null, error, encryptionAvailable: available };
  }
  if (!available) {
    const error = await write(password);
    return error === null
      ? { state: 'plaintext', message: ENCRYPTION_UNAVAILABLE_TEXT, error: null, encryptionAvailable: false }
      : { state: 'failed', message: null, error, encryptionAvailable: false };
  }

  let ciphertext: string;
  try {
    const store = await requireStore();
    ciphertext = await store.encrypt(password);
  } catch (cause: unknown) {
    const reason = errorMessage(cause);
    logWarn('credentials', '加密 WebDAV 密码失败', { error: reason });
    return { state: 'failed', message: null, error: `加密失败：${reason}`, encryptionAvailable: true };
  }
  let envelope: string;
  try {
    envelope = sealSecret(ciphertext);
  } catch (cause: unknown) {
    return { state: 'failed', message: null, error: errorMessage(cause), encryptionAvailable: true };
  }
  const error = await write(envelope);
  return error === null
    ? { state: 'encrypted', message: null, error: null, encryptionAvailable: true }
    : { state: 'failed', message: null, error, encryptionAvailable: true };
}
