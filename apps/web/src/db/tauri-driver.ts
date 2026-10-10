import type { SqlDriver, SqlValue } from '@dawn-tick/core';

/** Tauri 端驱动：底层是 tauri-plugin-sql（sqlx）。表结构由 Rust 侧迁移建立。 */
export async function openTauriDriver(databaseUrl = 'sqlite:dawn-tick.db'): Promise<SqlDriver> {
  const plugin = await import('@tauri-apps/plugin-sql');
  const db = await plugin.default.load(databaseUrl);
  return {
    async exec(sql: string): Promise<void> {
      await db.execute(sql);
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return (await db.select<T[]>(sql, [...params])) as T[];
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
      const rows = await db.select<T[]>(sql, [...params]);
      return rows[0];
    },
    async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
      await db.execute(sql, [...params]);
    },
    async close(): Promise<void> {
      await db.close();
    },
  };
}
