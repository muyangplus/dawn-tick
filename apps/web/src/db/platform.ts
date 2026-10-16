import {
  migrate,
  sqliteStorage,
  validatedStorage,
  type Migration,
  type Storage,
} from '@dawn-tick/core';
import schemaSql from '@dawn-tick/core/schema/001_init.sql?raw';
import eventKindsSql from '@dawn-tick/core/schema/002_event_kinds.sql?raw';
import customTimeSql from '@dawn-tick/core/schema/003_custom_time.sql?raw';
import timetableEntriesSql from '@dawn-tick/core/schema/004_timetable_entries.sql?raw';
import dueAtAnySql from '@dawn-tick/core/schema/005_due_at_any.sql?raw';
import schemaVersionSql from '@dawn-tick/core/schema/006_schema_version.sql?raw';
import { detectPlatform, type Platform } from '../platform-detect.ts';
import { logWarn } from '../log.ts';
import { readStorageInfo } from '../storage-config.ts';
import { applyStoredJournalMode } from './journal.ts';
import { isCorruptDatabase } from './health.ts';
import { setActiveSqlDriver } from './active-driver.ts';
import { openIndexedDbStorage } from './idb-storage.ts';

export { detectPlatform };
export type { Platform };

/** 迁移按 id 升序应用；已应用的会跳过，所以每次启动都调用 migrate 是幂等的。 */
export const MIGRATIONS: Migration[] = [
  { id: '001_init', sql: schemaSql },
  { id: '002_event_kinds', sql: eventKindsSql },
  { id: '003_custom_time', sql: customTimeSql },
  { id: '004_timetable_entries', sql: timetableEntriesSql },
  { id: '005_due_at_any', sql: dueAtAnySql },
  { id: '006_schema_version', sql: schemaVersionSql },
];

/** 当前打开的 SQLite 驱动；Web（IndexedDB）与未打开时为 null。快照的 VACUUM INTO 要用。 */
async function openSqliteStorage(platform: 'tauri' | 'capacitor'): Promise<Storage> {
  const driver =
    platform === 'tauri'
      ? await (await import('./tauri-driver.ts')).openTauriDriver()
      : await (await import('./capacitor-driver.ts')).openCapacitorDriver();

  const storage = sqliteStorage(driver);
  // 日志模式要在建表之前套用：建表写数据后再切就晚了（WAL 下还有其它连接时切不动）
  const portable = platform === 'tauri' ? (await readStorageInfo())?.portable === true : false;
  await applyStoredJournalMode(driver, storage, { platform, portable });
  await migrate(driver, MIGRATIONS);
  setActiveSqlDriver(driver);
  return storage;
}

/** 各端使用各自最合适的底层存储：Windows/Android 用 SQLite，Web 用 IndexedDB。 */
export async function openStorage(): Promise<Storage> {
  const platform = detectPlatform();
  if (platform !== 'web') {
    try {
      return validatedStorage(await openSqliteStorage(platform));
    } catch (error) {
      // 损坏不回退到 IndexedDB：回退会掩盖损坏，看起来像数据没了
      if (isCorruptDatabase(error)) throw error;
      logWarn('storage', '原生 SQLite 不可用，回退到 IndexedDB', {
        platform,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return validatedStorage(await openIndexedDbStorage());
}
