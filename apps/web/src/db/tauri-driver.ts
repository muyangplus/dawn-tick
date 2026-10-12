import type { SqlDriver, SqlValue } from '@dawn-tick/core';

/** Tauri 端驱动：底层是 tauri-plugin-sql（sqlx）。表结构由 Rust 侧迁移建立。 */
export async function openTauriDriver(databaseUrl?: string): Promise<SqlDriver> {
  // 数据库位置由原生侧给出（数据目录锁死在程序目录下的 com.dawntick.app）
  const { invoke } = await import('@tauri-apps/api/core');
  const url = databaseUrl ?? (await invoke<string>('database_url'));
  const plugin = await import('@tauri-apps/plugin-sql');
  const db = await plugin.default.load(url);
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
