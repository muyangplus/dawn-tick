import type { SqlDriver } from '@dawn-tick/core';

/** 当前打开的 SQLite 驱动；Web（IndexedDB）与未打开时为 null。数据库快照用它跑 `VACUUM INTO`。 */
let driver: SqlDriver | null = null;

export function setActiveSqlDriver(next: SqlDriver | null): void {
  driver = next;
}

export function activeSqlDriver(): SqlDriver | null {
  return driver;
}
