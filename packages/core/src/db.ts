export type SqlValue = string | number | null;

/** 三端 SQLite 驱动统一接口。 */
export interface SqlDriver {
  exec(sql: string): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined;
  run(sql: string, params?: readonly SqlValue[]): void;
  close(): void;
}

export function hasTable(db: SqlDriver, table: string): boolean {
  const row = db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  return row !== undefined;
}
