import {
  fromBase64Bytes,
  fromBase64Utf8,
  toBase64Bytes,
  toBase64Utf8,
} from '@dawn-tick/core';

/**
 * 备份导出加密：口令 + PBKDF2-SHA256 + AES-GCM 256，只用 WebCrypto。
 *
 * 信封是自描述的纯文本（zip 用同样的信封，只是把文本按 UTF-8 写进字节流）：
 *   DAWNTICK-ENC 1 <base64(json{salt,iv,iterations,ciphertext})>
 * 明文备份不含这个前缀，导入侧先看前缀再决定是否要口令，历史备份不需要迁移。
 *
 * 口令只参与本次派生，不保存、不落盘；忘记口令没有任何恢复途径。
 */

const MAGIC = 'DAWNTICK-ENC';
const ENVELOPE_VERSION = 1;
const ENVELOPE_PREFIX = `${MAGIC} ${ENVELOPE_VERSION} `;
/** PBKDF2 迭代下限：低于它的信封视为损坏或伪造，不再解密。 */
export const PBKDF2_MIN_ITERATIONS = 200_000;
/** 与下限相同：再高会明显拖慢手机端导出，200k 是任务约定的最低安全线。 */
export const PBKDF2_ITERATIONS = 200_000;
export const BACKUP_PASSWORD_MIN_LENGTH = 8;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;
const ITERATIONS_MAX = 10_000_000;
/** 版本号也进 AAD：改版本或换信封格式都会导致认证失败。 */
const AAD = new TextEncoder().encode(`${MAGIC} ${ENVELOPE_VERSION}`);

export type BackupCryptoFailure =
  | 'password'
  | 'corrupt'
  | 'unsupported'
  | 'weak-password'
  | 'password-required'
  | 'unavailable';

/** 加解密失败：`reason` 给界面分流文案，`message` 直接可读。 */
export class BackupCryptoError extends Error {
  readonly reason: BackupCryptoFailure;

  constructor(reason: BackupCryptoFailure, message: string) {
    super(message);
    this.name = 'BackupCryptoError';
    this.reason = reason;
  }
}

interface EnvelopeBody {
  salt: string;
  iv: string;
  iterations: number;
  ciphertext: string;
}

function webCrypto(): Crypto {
  const api = globalThis.crypto;
  if (api === undefined || api.subtle === undefined) {
    throw new BackupCryptoError(
      'unavailable',
      '当前环境不支持 WebCrypto，无法加密或解密备份',
    );
  }
  return api;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  webCrypto().getRandomValues(bytes);
  return bytes;
}

/** core 的 Base64 解码返回宽泛的 Uint8Array；这里统一收窄给 WebCrypto 的 BufferSource。 */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  return fromBase64Bytes(text) as Uint8Array<ArrayBuffer>;
}

function toBytes(payload: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength) as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(payload);
}

function corrupt(message: string): BackupCryptoError {
  return new BackupCryptoError('corrupt', message);
}

function assertPassword(password: string): void {
  if (password.length < BACKUP_PASSWORD_MIN_LENGTH) {
    throw new BackupCryptoError(
      'weak-password',
      `口令至少 ${BACKUP_PASSWORD_MIN_LENGTH} 位`,
    );
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await webCrypto().subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return webCrypto().subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 把任意字节封成信封文本；文本与 zip 走同一个实现，保证格式一致。 */
async function seal(payload: Uint8Array<ArrayBuffer>, password: string): Promise<string> {
  assertPassword(password);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await webCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    key,
    payload,
  );
  const body: EnvelopeBody = {
    salt: toBase64Bytes(salt),
    iv: toBase64Bytes(iv),
    iterations: PBKDF2_ITERATIONS,
    ciphertext: toBase64Bytes(new Uint8Array(ciphertext)),
  };
  return `${ENVELOPE_PREFIX}${toBase64Utf8(JSON.stringify(body))}`;
}

function parseEnvelope(text: string): EnvelopeBody {
  const trimmed = text.trim();
  if (!trimmed.startsWith(`${MAGIC} `)) {
    throw corrupt('这不是加密信封：缺少 DAWNTICK-ENC 标记');
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 3) throw corrupt('加密信封格式不完整');
  const version = parts[1];
  if (version !== String(ENVELOPE_VERSION)) {
    throw new BackupCryptoError(
      'unsupported',
      `不支持的信封版本 ${version ?? '(缺失)'}，请升级晓刻后再试`,
    );
  }
  const encoded = parts[2];
  if (encoded === undefined) throw corrupt('加密信封缺少内容');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Utf8(encoded));
  } catch {
    throw corrupt('加密信封内容损坏（不是有效的 Base64 JSON）');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw corrupt('加密信封内容损坏（结构不对）');
  }
  const record = parsed as Record<string, unknown>;
  const salt = record['salt'];
  const iv = record['iv'];
  const iterations = record['iterations'];
  const ciphertext = record['ciphertext'];
  if (
    typeof salt !== 'string' ||
    typeof iv !== 'string' ||
    typeof ciphertext !== 'string' ||
    ciphertext === ''
  ) {
    throw corrupt('加密信封缺少盐、IV 或密文');
  }
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < PBKDF2_MIN_ITERATIONS ||
    iterations > ITERATIONS_MAX
  ) {
    throw corrupt(`加密信封的迭代次数不合理（应不少于 ${PBKDF2_MIN_ITERATIONS}）`);
  }
  return { salt, iv, iterations, ciphertext };
}

/** 解密信封文本，返回原始字节；错误口令与内容被改动都按认证失败处理。 */
async function open(text: string, password: string): Promise<Uint8Array> {
  const body = parseEnvelope(text);
  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    salt = decodeBase64(body.salt);
    iv = decodeBase64(body.iv);
    ciphertext = decodeBase64(body.ciphertext);
  } catch {
    throw corrupt('加密信封的盐、IV 或密文不是有效 Base64');
  }
  if (salt.length !== SALT_BYTES) throw corrupt('加密信封的盐长度不对');
  if (iv.length !== IV_BYTES) throw corrupt('加密信封的 IV 长度不对');
  if (ciphertext.length === 0) throw corrupt('加密信封没有密文');
  const key = await deriveKey(password, salt, body.iterations);
  try {
    const plain = await webCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      key,
      ciphertext,
    );
    return new Uint8Array(plain);
  } catch {
    throw new BackupCryptoError(
      'password',
      '口令错误，请重新输入（多次失败时请检查文件是否被改动）',
    );
  }
}

/** 是否是加密信封文本；明文 JSON / Base64 返回 false。 */
export function isEncryptedBackup(text: string): boolean {
  return text.trimStart().startsWith(`${MAGIC} `);
}

/** 是否是加密信封字节（zip 导出会在文件头写上同样的文本标记）。 */
export function isEncryptedBackupBytes(bytes: ArrayBuffer | Uint8Array): boolean {
  const head = toBytes(bytes).subarray(0, ENVELOPE_PREFIX.length);
  return new TextDecoder().decode(head) === ENVELOPE_PREFIX;
}

/** 用口令把文本备份封成信封文本。 */
export async function encryptBackup(payload: string, password: string): Promise<string> {
  return seal(new TextEncoder().encode(payload), password);
}

/** 用口令解密信封文本；失败抛 `BackupCryptoError`。 */
export async function decryptBackup(text: string, password: string): Promise<string> {
  const bytes = await open(text, password);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw corrupt('解密成功但内容不是合法 UTF-8，文件可能已损坏');
  }
}

/** 用口令把任意字节（整包 zip）封成信封字节。 */
export async function encryptBackupBytes(
  payload: ArrayBuffer | Uint8Array,
  password: string,
): Promise<Uint8Array> {
  return new TextEncoder().encode(await seal(toBytes(payload), password));
}

/** 解密信封字节，返回原始字节；zip 导入先解密再按 zip 解析。 */
export async function decryptBackupBytes(
  text: string | ArrayBuffer | Uint8Array,
  password: string,
): Promise<Uint8Array> {
  if (typeof text === 'string') return open(text, password);
  const decoded = new TextDecoder().decode(toBytes(text));
  return open(decoded, password);
}
