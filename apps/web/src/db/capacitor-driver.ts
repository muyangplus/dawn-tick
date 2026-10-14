import type { SqlDriver, SqlValue } from '@dawn-tick/core';

/** Android 端驱动：底层是 @capacitor-community/sqlite（系统 SQLite）。 */
export async function openCapacitorDriver(
  database = 'dawn_tick',
  version = 1,
): Promise<SqlDriver> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const connection = new SQLiteConnection(CapacitorSQLite);
  const db = await connection.createConnection(database, false, 'no-encryption', version, false);
  await db.open();

  return {
    async exec(sql: string): Promise<void> {
      await db.execute(sql);
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const result = await db.query(sql, [...params]);
      return (result.values ?? []) as T[];
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
      const result = await db.query(sql, [...params]);
      return ((result.values ?? []) as T[])[0];
    },
    async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
      await db.run(sql, [...params]);
    },
    async close(): Promise<void> {
      await db.close();
    },
  };
}
