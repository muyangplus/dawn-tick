import {
  migrate,
  sqliteStorage,
  validatedStorage,
  type Migration,
  type Storage,
} from '@dawn-tick/core';
import schemaSql from '@dawn-tick/core/schema/001_init.sql?raw';
import { detectPlatform, type Platform } from '../platform-detect.ts';
import { openIndexedDbStorage } from './idb-storage.ts';

export { detectPlatform };
export type { Platform };

export const MIGRATIONS: Migration[] = [{ id: '001_init', sql: schemaSql }];

async function openSqliteStorage(platform: 'tauri' | 'capacitor'): Promise<Storage> {
  const driver =
    platform === 'tauri'
      ? await (await import('./tauri-driver.ts')).openTauriDriver()
      : await (await import('./capacitor-driver.ts')).openCapacitorDriver();

  const existing = await driver.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (existing === undefined) await migrate(driver, MIGRATIONS);
  return sqliteStorage(driver);
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
