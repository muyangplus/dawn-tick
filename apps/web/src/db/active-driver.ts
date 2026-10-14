import type { SqlDriver } from '@dawn-tick/core';

/**
 * 当前打开的 SQLite 驱动；Web（IndexedDB）与尚未打开时为 null。
 * 单独成文件：数据库快照要用它跑 `VACUUM INTO`，而不想牵进平台模块的建表 SQL 依赖。
 */
let driver: SqlDriver | null = null;

export function setActiveSqlDriver(next: SqlDriver | null): void {
  driver = next;
}

export function activeSqlDriver(): SqlDriver | null {
  return driver;
}
