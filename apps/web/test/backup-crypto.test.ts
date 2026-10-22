import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBase64Bytes, fromBase64Utf8, toBase64Bytes, toBase64Utf8 } from '@dawn-tick/core';
import {
  BACKUP_PASSWORD_MIN_LENGTH,
  BackupCryptoError,
  PBKDF2_ITERATIONS,
  PBKDF2_MIN_ITERATIONS,
  decryptBackup,
  decryptBackupBytes,
  encryptBackup,
  encryptBackupBytes,
  isEncryptedBackup,
  isEncryptedBackupBytes,
} from '../src/lib/backup-crypto.ts';

const PASSWORD = 'correct-horse-8';
const PLAIN = JSON.stringify({ format: 'dawn-tick-backup', version: 1, stores: {} });

interface EnvelopeBody {
  salt: string;
  iv: string;
  iterations: number;
  ciphertext: string;
}

function readBody(text: string): EnvelopeBody {
  const parts = text.trim().split(/\s+/);
  assert.equal(parts[0], 'DAWNTICK-ENC');
  assert.equal(parts[1], '1');
  return JSON.parse(fromBase64Utf8(parts[2] ?? '')) as EnvelopeBody;
}

function writeBody(body: EnvelopeBody): string {
  return `DAWNTICK-ENC 1 ${toBase64Utf8(JSON.stringify(body))}`;
}

async function rejectReason(promise: Promise<unknown>): Promise<BackupCryptoError> {
  try {
    await promise;
  } catch (cause: unknown) {
    assert.ok(cause instanceof BackupCryptoError, `期望 BackupCryptoError，实际 ${String(cause)}`);
    return cause;
  }
  assert.fail('期望失败，实际成功');
}

test('文本备份加密后能解回原文', async () => {
  const text = await encryptBackup(PLAIN, PASSWORD);
  assert.equal(isEncryptedBackup(text), true);
  assert.ok(text.startsWith('DAWNTICK-ENC 1 '));
  assert.equal(await decryptBackup(text, PASSWORD), PLAIN);
});

test('信封带版本、盐、IV、迭代次数与密文，参数满足安全下限', async () => {
  const body = readBody(await encryptBackup(PLAIN, PASSWORD));
  assert.equal(body.iterations, PBKDF2_ITERATIONS);
  assert.ok(body.iterations >= 200_000);
  assert.ok(PBKDF2_ITERATIONS >= PBKDF2_MIN_ITERATIONS);
  assert.equal(fromBase64Bytes(body.salt).length, 16);
  assert.equal(fromBase64Bytes(body.iv).length, 12);
  assert.ok(fromBase64Bytes(body.ciphertext).length > 0);
  // 密文里不应出现明文片段
  assert.equal(body.ciphertext.includes(toBase64Utf8('dawn-tick-backup')), false);
  assert.equal(body.ciphertext.includes('dawn-tick-backup'), false);
});

test('每次加密使用新的盐与 IV', async () => {
  const first = readBody(await encryptBackup(PLAIN, PASSWORD));
  const second = readBody(await encryptBackup(PLAIN, PASSWORD));
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('错误口令给出可读错误且不返回明文', async () => {
  const text = await encryptBackup(PLAIN, PASSWORD);
  const error = await rejectReason(decryptBackup(text, 'wrong-password-8'));
  assert.equal(error.reason, 'password');
  assert.match(error.message, /口令错误/);
});

test('篡改密文无法通过完整性校验', async () => {
  const body = readBody(await encryptBackup(PLAIN, PASSWORD));
  const bytes = fromBase64Bytes(body.ciphertext);
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  body.ciphertext = toBase64Bytes(bytes);
  const error = await rejectReason(decryptBackup(writeBody(body), PASSWORD));
  assert.equal(error.reason, 'password');
  assert.match(error.message, /口令错误|损坏/);
});

test('迭代次数低于下限的信封直接判为损坏', async () => {
  const body = readBody(await encryptBackup(PLAIN, PASSWORD));
  body.iterations = 1000;
  const error = await rejectReason(decryptBackup(writeBody(body), PASSWORD));
  assert.equal(error.reason, 'corrupt');
  assert.match(error.message, /迭代次数/);
});

test('信封结构损坏、版本不支持时分别报错', async () => {
  const malformed = await rejectReason(decryptBackup('DAWNTICK-ENC 1 不是 Base64', PASSWORD));
  assert.equal(malformed.reason, 'corrupt');
  assert.match(malformed.message, /损坏|格式/);

  const unsupported = await rejectReason(
    decryptBackup('DAWNTICK-ENC 2 e30=', PASSWORD),
  );
  assert.equal(unsupported.reason, 'unsupported');
  assert.match(unsupported.message, /版本/);
});

test('口令最短 8 位', async () => {
  assert.equal(BACKUP_PASSWORD_MIN_LENGTH, 8);
  const error = await rejectReason(encryptBackup(PLAIN, '1234567'));
  assert.equal(error.reason, 'weak-password');
  assert.match(error.message, /至少 8 位/);
});

test('旧明文备份不会被识别为加密信封', () => {
  assert.equal(isEncryptedBackup(PLAIN), false);
  assert.equal(isEncryptedBackup(toBase64Utf8(PLAIN)), false);
  assert.equal(isEncryptedBackup('   '), false);
  assert.equal(isEncryptedBackup(''), false);
  assert.equal(isEncryptedBackupBytes(new TextEncoder().encode(PLAIN)), false);
  assert.equal(
    isEncryptedBackupBytes(new TextEncoder().encode('DAWNTICK-ENC 2 {}')),
    false,
  );
});

test('整包 zip 字节加密后可原样解回', async () => {
  const plain = new Uint8Array(512);
  for (let index = 0; index < plain.length; index += 1) plain[index] = index % 251;
  const sealed = await encryptBackupBytes(plain, PASSWORD);
  assert.equal(isEncryptedBackupBytes(sealed), true);
  assert.ok(new TextDecoder().decode(sealed).startsWith('DAWNTICK-ENC 1 '));
  assert.deepEqual(await decryptBackupBytes(sealed, PASSWORD), plain);
  // 也接受 ArrayBuffer 入参
  const buffer = sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength);
  assert.deepEqual(await decryptBackupBytes(buffer, PASSWORD), plain);
});

test('zip 字节用错口令时报口令错误', async () => {
  const sealed = await encryptBackupBytes(new TextEncoder().encode(PLAIN), PASSWORD);
  const error = await rejectReason(decryptBackupBytes(sealed, 'another-pass-8'));
  assert.equal(error.reason, 'password');
  assert.match(error.message, /口令错误/);
});
