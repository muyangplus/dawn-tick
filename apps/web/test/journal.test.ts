import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, type SqlDriver, type SqlValue } from '@dawn-tick/core';
import {
  applyJournalMode,
  applyStoredJournalMode,
  journalModeSql,
  resolveWalEnabled,
  walEnabledByDefault,
} from '../src/db/journal.ts';

function fakeDriver(): { driver: SqlDriver; sql: string[] } {
  const sql: string[] = [];
  const driver: SqlDriver = {
    async exec(statement: string): Promise<void> {
      sql.push(statement);
    },
    async all<T>(statement: string, _params: readonly SqlValue[] = []): Promise<T[]> {
      sql.push(statement);
      return [] as T[];
    },
    async get<T>(): Promise<T | undefined> {
      return undefined;
    },
    async run(): Promise<void> {},
    async close(): Promise<void> {},
  };
  return { driver, sql };
}

test('WAL 默认口径：便携版关，安装版与 Android 开', () => {
  assert.equal(walEnabledByDefault(true, 'tauri'), false);
  assert.equal(walEnabledByDefault(false, 'tauri'), true);
  assert.equal(walEnabledByDefault(false, 'capacitor'), true);
});

test('日志模式设置：auto 跟随，on / off 手动覆盖', () => {
  assert.equal(resolveWalEnabled('auto', { portable: true, platform: 'tauri' }), false);
  assert.equal(resolveWalEnabled('auto', { portable: false, platform: 'tauri' }), true);
  assert.equal(resolveWalEnabled('on', { portable: true, platform: 'tauri' }), true);
  assert.equal(resolveWalEnabled('off', { portable: false, platform: 'tauri' }), false);
  assert.equal(resolveWalEnabled(undefined, { portable: true, platform: 'capacitor' }), true);
  assert.equal(resolveWalEnabled('on', { portable: false, platform: 'web' }), null);
});

test('SQL 口径：开 WAL、关 DELETE', () => {
  assert.equal(journalModeSql(true), 'PRAGMA journal_mode=WAL');
  assert.equal(journalModeSql(false), 'PRAGMA journal_mode=DELETE');
});

test('套用日志模式会落到驱动上', async () => {
  const { driver, sql } = fakeDriver();
  await applyJournalMode(driver, false);
  assert.deepEqual(sql, ['PRAGMA journal_mode=DELETE']);
});

test('按库里的设置套用：未设置时便携版用 DELETE', async () => {
  const storage = new MemoryStorage();
  const portable = fakeDriver();
  await applyStoredJournalMode(portable.driver, storage, { portable: true, platform: 'tauri' });
  assert.deepEqual(portable.sql, ['PRAGMA journal_mode=DELETE']);

  await storage.writeMeta('wal_mode', 'on');
  const forced = fakeDriver();
  await applyStoredJournalMode(forced.driver, storage, { portable: true, platform: 'tauri' });
  assert.deepEqual(forced.sql, ['PRAGMA journal_mode=WAL']);

  const web = fakeDriver();
  await applyStoredJournalMode(web.driver, storage, { portable: false, platform: 'web' });
  assert.deepEqual(web.sql, []);
});

test('驱动报错不影响启动', async () => {
  const failing: SqlDriver = {
    async exec(): Promise<void> {},
    async all(): Promise<never[]> {
      throw new Error('busy');
    },
    async get<T>(): Promise<T | undefined> {
      return undefined;
    },
    async run(): Promise<void> {},
    async close(): Promise<void> {},
  };
  await applyJournalMode(failing, true);
});
