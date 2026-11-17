import type { SqlDriver, SqlValue } from '@dawn-tick/core';
import { invokeNative } from '../lib/native.ts';

/** Tauri 端驱动：底层是 tauri-plugin-sql（sqlx）。表结构由 Rust 侧迁移建立。 */
export async function openTauriDriver(databaseUrl?: string): Promise<SqlDriver> {
  // 数据库位置由原生侧给出（数据目录固定为 %APPDATA%\com.dawntick.app）
  const nativeUrl = databaseUrl ?? (await invokeNative<string>('database_url'));
  if (nativeUrl === undefined) throw new Error('当前平台不支持原生 SQLite');
  const url = nativeUrl;
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
