export type SqlValue = string | number | null;

/** 三端 SQLite 驱动统一接口。原生插件为异步 API，故全部返回 Promise。 */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  close(): Promise<void>;
}

export async function hasTable(db: SqlDriver, table: string): Promise<boolean> {
  const row = await db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  return row !== undefined;
}
