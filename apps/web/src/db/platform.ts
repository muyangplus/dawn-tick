import {
  backfillWeeksRaw,
  inspectSqlxBaseline,
  migrate,
  sqliteStorage,
  validatedStorage,
  writeLegacySqlxBaseline,
  type Migration,
  type SqlDriver,
  type Storage,
} from '@dawn-tick/core';
import schemaSql from '@dawn-tick/core/schema/001_init.sql?raw';
import eventKindsSql from '@dawn-tick/core/schema/002_event_kinds.sql?raw';
import customTimeSql from '@dawn-tick/core/schema/003_custom_time.sql?raw';
import timetableEntriesSql from '@dawn-tick/core/schema/004_timetable_entries.sql?raw';
import dueAtAnySql from '@dawn-tick/core/schema/005_due_at_any.sql?raw';
import schemaVersionSql from '@dawn-tick/core/schema/006_schema_version.sql?raw';
import { detectPlatform, type Platform } from '../platform-detect.ts';
import { logInfo, logWarn } from '../log.ts';
import { readStorageInfo, type StorageInfo } from '../storage-config.ts';
import { applyStoredJournalMode } from './journal.ts';
import { isCorruptDatabase, isMissingSqlxMigrations } from './health.ts';
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

/** 数据目录与恢复入口：旧库提示要告诉用户去哪儿找数据、怎么恢复。 */
function recoveryHint(info: StorageInfo | null): Record<string, string> {
  return {
    dataDir: info?.dir ?? '',
    dbFile: info?.dbFile ?? '',
    recovery: '数据未丢失：可在「设置 → 数据管理」导入备份快照，或重启应用再试一次',
  };
}

/**
 * 旧库兼容自检：有 `users` 但没有 `_sqlx_migrations` 时只提示并补写基线，不重放迁移（Q13）。
 * 桌面端只对 tauri 生效：Android 的 Capacitor 从不用 sqlx 记账，否则每次启动都会误报。
 */
async function reportLegacySqlxBaseline(driver: SqlDriver, info: StorageInfo | null): Promise<void> {
  try {
    const state = await inspectSqlxBaseline(driver);
    if (!state.legacy) return;
    logWarn('storage', '数据库缺少迁移记录（_sqlx_migrations），按旧库兼容处理', {
      ...recoveryHint(info),
      schemaVersion: state.schemaVersion || '未知',
    });
    if (await writeLegacySqlxBaseline(driver, state.schemaVersion)) {
      logInfo('storage', '已按 app_meta.schema_version 补写旧库基线', {
        schemaVersion: state.schemaVersion,
      });
    }
  } catch (error) {
    // 自检失败不影响开库
    logWarn('storage', '旧库迁移记录自检失败', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 当前打开的 SQLite 驱动；Web（IndexedDB）与未打开时为 null。快照的 VACUUM INTO 要用。 */
async function openSqliteStorage(platform: 'tauri' | 'capacitor'): Promise<Storage> {
  const info = platform === 'tauri' ? await readStorageInfo() : null;
  const driver =
    platform === 'tauri'
      ? await (await import('./tauri-driver.ts')).openTauriDriver()
      : await (await import('./capacitor-driver.ts')).openCapacitorDriver();

  const storage = sqliteStorage(driver);
  // 日志模式要在建表之前套用：建表写数据后再切就晚了（WAL 下还有其它连接时切不动）
  const portable = platform === 'tauri' ? info?.portable === true : false;
  await applyStoredJournalMode(driver, storage, { platform, portable });
  // 自检放在 JS 迁移之前：只判定库形状、补基线，不重放 Rust 侧的 001–006
  if (platform === 'tauri') await reportLegacySqlxBaseline(driver, info);
  await migrate(driver, MIGRATIONS);
  setActiveSqlDriver(driver);
  return storage;
}

/** 各端使用各自最合适的底层存储：Windows/Android 用 SQLite，Web 用 IndexedDB。 */
export async function openStorage(): Promise<Storage> {
  const storage = await openStorageInner();
  // 历史手工排课只写了 weeks_mask：开库时补一次 weeks_raw，之后再开库直接跳过
  try {
    const backfilled = await backfillWeeksRaw(storage);
    if (backfilled > 0) logInfo('storage', '回填排课周次文本', { rows: backfilled });
  } catch (error) {
    logWarn('storage', '回填排课周次文本失败', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return storage;
}

async function openStorageInner(): Promise<Storage> {
  const platform = detectPlatform();
  if (platform !== 'web') {
    try {
      return validatedStorage(await openSqliteStorage(platform));
    } catch (error) {
      // 损坏不回退到 IndexedDB：回退会掩盖损坏，看起来像数据没了
      if (isCorruptDatabase(error)) throw error;
      if (platform === 'tauri' && isMissingSqlxMigrations(error)) {
        // 迁移记账在插件 load 内先跑：旧库会从 001 重跑、撞上已有 users 而失败
        const info = await readStorageInfo();
        logWarn('storage', '数据库缺少迁移记录（_sqlx_migrations），原生 SQLite 无法打开，已回退到 IndexedDB', {
          platform,
          ...recoveryHint(info),
          message: error instanceof Error ? error.message : String(error),
        });
      } else {
        logWarn('storage', '原生 SQLite 不可用，回退到 IndexedDB', {
          platform,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return validatedStorage(await openIndexedDbStorage());
}
