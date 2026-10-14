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
import { detectPlatform, type Platform } from '../platform-detect.ts';
import { readStorageInfo } from '../storage-config.ts';
import { applyStoredJournalMode } from './journal.ts';
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
];

async function openSqliteStorage(platform: 'tauri' | 'capacitor'): Promise<Storage> {
  const driver =
    platform === 'tauri'
      ? await (await import('./tauri-driver.ts')).openTauriDriver()
      : await (await import('./capacitor-driver.ts')).openCapacitorDriver();

  await migrate(driver, MIGRATIONS);
  const storage = sqliteStorage(driver);
  // 便携版默认单文件（无 -wal/-shm），安装版默认 WAL；设置里可改
  const portable = platform === 'tauri' ? (await readStorageInfo())?.portable === true : false;
  await applyStoredJournalMode(driver, storage, { platform, portable });
  return storage;
}

/** 各端使用各自最合适的底层存储：Windows/Android 用 SQLite，Web 用 IndexedDB。 */
export async function openStorage(): Promise<Storage> {
  const platform = detectPlatform();
  if (platform !== 'web') {
    try {
      return validatedStorage(await openSqliteStorage(platform));
    } catch (error) {
      console.warn('原生 SQLite 不可用，回退到 IndexedDB', error);
    }
  }
  return validatedStorage(await openIndexedDbStorage());
}
