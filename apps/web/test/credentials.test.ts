import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '@dawn-tick/core';
import {
  ENCRYPTION_UNAVAILABLE_TEXT,
  SECRET_ENVELOPE_PREFIX,
  isEncryptionAvailable,
  isSecretEnvelope,
  readSecretEnvelope,
  readWebdavPassword,
  revealSecret,
  saveWebdavPassword,
  sealSecret,
  setSecretStoreForTests,
  type SecretStore,
} from '../src/lib/credentials.ts';

/** 纯逻辑桩：密文是 `cipher(明文)`，能验证往返但不做真实密码学。 */
function workingStore(): SecretStore {
  return {
    encrypt: async (plaintext: string) => `cipher(${plaintext})`,
    decrypt: async (ciphertext: string) => {
      const matched = /^cipher\((.*)\)$/s.exec(ciphertext);
      if (matched === null) throw new Error('密文损坏');
      return matched[1] as string;
    },
    isAvailable: async () => true,
  };
}

/** 白盒桩：只改一个方法，其余保持可用。 */
function storeWith(overrides: Partial<SecretStore>): SecretStore {
  return { ...workingStore(), ...overrides };
}

const KEY = 'webdav_password';

afterEach(() => {
  setSecretStoreForTests(undefined);
});

test('信封解析：空串、旧明文与密文三态', () => {
  assert.deepEqual(readSecretEnvelope(undefined), { kind: 'empty' });
  assert.deepEqual(readSecretEnvelope(null), { kind: 'empty' });
  assert.deepEqual(readSecretEnvelope(''), { kind: 'empty' });
  assert.deepEqual(readSecretEnvelope('p@ss'), { kind: 'plaintext', value: 'p@ss' });
  assert.deepEqual(readSecretEnvelope(`${SECRET_ENVELOPE_PREFIX}abc`), {
    kind: 'encrypted',
    ciphertext: 'abc',
  });
  assert.equal(isSecretEnvelope('p@ss'), false);
  assert.equal(isSecretEnvelope('enc:v1'), false, '少了冒号不算信封');
  assert.equal(isSecretEnvelope(`${SECRET_ENVELOPE_PREFIX}abc`), true);
  assert.equal(sealSecret('abc'), `${SECRET_ENVELOPE_PREFIX}abc`);
  assert.throws(() => sealSecret(''), /拒绝写入/, '空密文不允许落库');
});

test('保存后落库为 enc:v1 信封，读取透明解密', async () => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  const saved = await saveWebdavPassword(storage, 'p@ss');
  assert.equal(saved.state, 'encrypted');
  assert.equal(saved.error, null);
  assert.equal(saved.encryptionAvailable, true);
  assert.equal(await storage.readMeta(KEY), `enc:v1:cipher(p@ss)`);

  const info = await readWebdavPassword(storage);
  assert.equal(info.state, 'encrypted');
  assert.equal(info.password, 'p@ss');
  assert.equal(info.message, null);
  assert.equal(info.encryptionAvailable, true);
});

test('旧明文读取时自动加密迁移并写回', async () => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await storage.writeMeta(KEY, '旧密码');

  const info = await readWebdavPassword(storage);
  assert.equal(info.state, 'migrated');
  assert.equal(info.password, '旧密码');
  assert.equal(await storage.readMeta(KEY), `enc:v1:cipher(旧密码)`, '迁移后落库的是信封');

  const again = await readWebdavPassword(storage);
  assert.equal(again.state, 'encrypted', '第二次读取不再迁移');
  assert.equal(again.password, '旧密码');
});

test('无加密能力的平台保留明文并显式标记', async () => {
  setSecretStoreForTests(null);
  const storage = new MemoryStorage();
  await storage.writeMeta(KEY, 'plain');

  const info = await readWebdavPassword(storage);
  assert.equal(info.state, 'plaintext');
  assert.equal(info.password, 'plain');
  assert.equal(info.encryptionAvailable, false);
  assert.equal(info.message, ENCRYPTION_UNAVAILABLE_TEXT);
  assert.equal(await storage.readMeta(KEY), 'plain', '没有能力时保持旧值不动');

  const saved = await saveWebdavPassword(storage, 'next');
  assert.equal(saved.state, 'plaintext');
  assert.equal(await storage.readMeta(KEY), 'next');
});

test('密文解不开时清空本次会话密码并要求重新输入', async () => {
  setSecretStoreForTests(
    storeWith({
      decrypt: async () => {
        throw new Error('key lost');
      },
    }),
  );
  const storage = new MemoryStorage();
  await storage.writeMeta(KEY, 'enc:v1:broken');

  const info = await readWebdavPassword(storage);
  assert.equal(info.state, 'error');
  assert.equal(info.password, '', '解不开时不拿旧明文凑数');
  assert.match(info.message ?? '', /无法解密/);
  assert.match(info.message ?? '', /重新输入/);
  assert.equal(await storage.readMeta(KEY), 'enc:v1:broken', '失败不改写存储');
});

test('平台没有解密能力时给出可读错误', async () => {
  setSecretStoreForTests(null);
  const storage = new MemoryStorage();
  await storage.writeMeta(KEY, 'enc:v1:cipher(from-desktop)');

  const info = await readWebdavPassword(storage);
  assert.equal(info.state, 'error');
  assert.equal(info.password, '');
  assert.match(info.message ?? '', /不支持解密/);
});

test('迁移加密失败时保留明文且不阻断读取', async () => {
  setSecretStoreForTests(
    storeWith({
      encrypt: async () => {
        throw new Error('钥匙串被锁');
      },
    }),
  );
  const storage = new MemoryStorage();
  await storage.writeMeta(KEY, 'plain');

  const info = await readWebdavPassword(storage);
  assert.equal(info.state, 'plaintext');
  assert.equal(info.password, 'plain');
  assert.match(info.message ?? '', /仍以明文保存/);
  assert.equal(await storage.readMeta(KEY), 'plain');
});

test('保存时加密失败不覆盖已保存的密码', async () => {
  setSecretStoreForTests(
    storeWith({
      encrypt: async () => {
        throw new Error('钥匙串被锁');
      },
    }),
  );
  const storage = new MemoryStorage();
  await storage.writeMeta(KEY, 'enc:v1:cipher(old)');

  const result = await saveWebdavPassword(storage, 'new');
  assert.equal(result.state, 'failed');
  assert.match(result.error ?? '', /加密失败/);
  assert.equal(await storage.readMeta(KEY), 'enc:v1:cipher(old)');
});

test('保存空串清除密码', async () => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await storage.writeMeta(KEY, 'enc:v1:cipher(old)');

  const result = await saveWebdavPassword(storage, '');
  assert.equal(result.state, 'empty');
  assert.equal(await storage.readMeta(KEY), '');
  assert.equal((await readWebdavPassword(storage)).state, 'empty');
});

test('读取存储失败返回可读错误而不是抛出', async () => {
  setSecretStoreForTests(workingStore());
  const info = await readWebdavPassword({
    readMeta: async () => {
      throw new Error('database is locked');
    },
    writeMeta: async () => {},
  });
  assert.equal(info.state, 'error');
  assert.equal(info.password, '');
  assert.match(info.message ?? '', /读取已保存的密码失败/);
});

test('revealSecret 透明处理信封与旧明文', async () => {
  setSecretStoreForTests(workingStore());
  assert.equal(await revealSecret(''), '');
  assert.equal(await revealSecret(undefined), '');
  assert.equal(await revealSecret('p@ss'), 'p@ss', '旧明文原样返回');
  assert.equal(await revealSecret('enc:v1:cipher(p@ss)'), 'p@ss');
  await assert.rejects(revealSecret('enc:v1:broken'), /无法解密/);
});

test('加密能力查询：无平台能力 / 可用 / 探测抛错都归一成布尔', async () => {
  setSecretStoreForTests(null);
  assert.equal(await isEncryptionAvailable(), false);
  setSecretStoreForTests(workingStore());
  assert.equal(await isEncryptionAvailable(), true);
  setSecretStoreForTests(
    storeWith({
      isAvailable: async () => {
        throw new Error('keystore 坏了');
      },
    }),
  );
  assert.equal(await isEncryptionAvailable(), false);
});
