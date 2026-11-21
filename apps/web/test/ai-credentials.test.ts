import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, writeSettings, type AiClient } from '@dawn-tick/core';
import {
  AI_API_KEY_META_KEY,
  WEBDAV_PASSWORD_META_KEY,
  readStoredSecret,
  readWebdavPassword,
  saveStoredSecret,
  saveWebdavPassword,
  setSecretStoreForTests,
  type SecretStore,
} from '../src/lib/credentials.ts';
import { loadAiClient, setAiClientForTests } from '../src/lib/ai.ts';

/** 纯逻辑桩：密文是 `cipher(明文)`。 */
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

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

/** 替换全局 fetch，记下请求并回一条补全；返回请求记录与还原函数。 */
function stubFetch(content: string): { calls: FetchCall[]; restore: () => void } {
  const previous = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: string, init: FetchCall['init']) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = previous) };
}

afterEach(() => {
  setSecretStoreForTests(undefined);
  setAiClientForTests(undefined);
});

test('AI 密钥键名与 core 设置键一致', () => {
  assert.equal(AI_API_KEY_META_KEY, 'ai_api_key');
  assert.equal(WEBDAV_PASSWORD_META_KEY, 'webdav_password');
});

test('AI 密钥加密保存在 ai_api_key，读取透明解密，不动 WebDAV 密码', async () => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await saveWebdavPassword(storage, 'dav-pass');

  const saved = await saveStoredSecret(storage, AI_API_KEY_META_KEY, 'sk-123');
  assert.equal(saved.state, 'encrypted');
  assert.equal(saved.error, null);
  assert.equal(await storage.readMeta('ai_api_key'), 'enc:v1:cipher(sk-123)');
  assert.equal(await storage.readMeta('webdav_password'), 'enc:v1:cipher(dav-pass)', 'WebDAV 密码保持原样');

  const ai = await readStoredSecret(storage, AI_API_KEY_META_KEY);
  assert.equal(ai.state, 'encrypted');
  assert.equal(ai.password, 'sk-123');
  const dav = await readWebdavPassword(storage);
  assert.equal(dav.password, 'dav-pass');
});

test('WebDAV 包装函数只读写 webdav_password', async () => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await saveStoredSecret(storage, AI_API_KEY_META_KEY, 'sk-1');
  await saveWebdavPassword(storage, 'p');
  assert.equal(await storage.readMeta('ai_api_key'), 'enc:v1:cipher(sk-1)');
  assert.equal((await readStoredSecret(storage, WEBDAV_PASSWORD_META_KEY)).password, 'p');

  await saveWebdavPassword(storage, '');
  assert.equal(await storage.readMeta('webdav_password'), '');
  assert.equal((await readStoredSecret(storage, AI_API_KEY_META_KEY)).password, 'sk-1', '清空 WebDAV 密码不影响 AI 密钥');
});

test('旧明文 AI 密钥读取时加密写回同一个键', async () => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await storage.writeMeta('ai_api_key', 'sk-plain');
  const info = await readStoredSecret(storage, AI_API_KEY_META_KEY);
  assert.equal(info.state, 'migrated');
  assert.equal(info.password, 'sk-plain');
  assert.equal(await storage.readMeta('ai_api_key'), 'enc:v1:cipher(sk-plain)');
  assert.equal(await storage.readMeta('webdav_password'), undefined, '迁移不写 WebDAV 键');
});

test('清空 AI 密钥写入空串', async () => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await saveStoredSecret(storage, AI_API_KEY_META_KEY, 'sk-1');
  const cleared = await saveStoredSecret(storage, AI_API_KEY_META_KEY, '');
  assert.equal(cleared.state, 'empty');
  assert.equal(await storage.readMeta('ai_api_key'), '');
  assert.equal((await readStoredSecret(storage, AI_API_KEY_META_KEY)).state, 'empty');
});

test('无加密能力时 AI 密钥以明文保存并标记', async () => {
  setSecretStoreForTests(null);
  const storage = new MemoryStorage();
  const saved = await saveStoredSecret(storage, AI_API_KEY_META_KEY, 'sk-plain');
  assert.equal(saved.state, 'plaintext');
  assert.equal(saved.encryptionAvailable, false);
  assert.equal(await storage.readMeta('ai_api_key'), 'sk-plain');
});

test('loadAiClient：按设置组装客户端，密钥现取现解密', async (t) => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await writeSettings(storage, { aiBaseUrl: 'https://api.example.com/v1/', aiModel: 'gpt-4o-mini' });
  await saveStoredSecret(storage, AI_API_KEY_META_KEY, 'sk-secret');
  const { calls, restore } = stubFetch('[]');
  t.after(restore);

  const client = await loadAiClient(storage);
  assert.equal(await client.complete({ messages: [{ role: 'user', content: 'hi' }] }), '[]');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(calls[0]!.init.headers['Authorization'], 'Bearer sk-secret', '发出去的是解密后的密钥');
  const body = JSON.parse(calls[0]!.init.body) as { model: string };
  assert.equal(body.model, 'gpt-4o-mini');
});

test('loadAiClient：未配置时调用报缺项且不发请求', async (t) => {
  setSecretStoreForTests(workingStore());
  const storage = new MemoryStorage();
  await writeSettings(storage, { aiBaseUrl: 'https://api.example.com/v1', aiModel: 'm' });
  const { calls, restore } = stubFetch('[]');
  t.after(restore);
  const client = await loadAiClient(storage);
  await assert.rejects(client.complete({ messages: [] }), /未填写 API 密钥/);
  assert.equal(calls.length, 0);
});

test('loadAiClient：密钥解不开时直接报错', async () => {
  setSecretStoreForTests({
    ...workingStore(),
    decrypt: async () => {
      throw new Error('key lost');
    },
  });
  const storage = new MemoryStorage();
  await storage.writeMeta('ai_api_key', 'enc:v1:broken');
  await assert.rejects(loadAiClient(storage), /无法解密|API 密钥/);
});

test('loadAiClient：测试注入的客户端优先', async () => {
  const injected: AiClient = { complete: async () => 'injected' };
  setAiClientForTests(injected);
  const client = await loadAiClient(new MemoryStorage());
  assert.equal(client, injected);
  setAiClientForTests(undefined);
  setSecretStoreForTests(null);
  assert.notEqual(await loadAiClient(new MemoryStorage()), injected);
});
