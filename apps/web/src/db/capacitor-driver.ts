import type { SqlDriver, SqlValue } from '@dawn-tick/core';
import { logWarn } from '../log.ts';
import { errorMessage } from '../lib/errors.ts';

/** 驱动用到的连接对象（@capacitor-community/sqlite 的 SQLiteDBConnection 子集）。 */
export interface CapacitorDb {
  open(): Promise<void>;
  isDBOpen(): Promise<{ result?: boolean }>;
  execute(sql: string): Promise<unknown>;
  query(sql: string, values: SqlValue[]): Promise<{ values?: unknown[] }>;
  run(sql: string, values: SqlValue[]): Promise<unknown>;
  close(): Promise<void>;
}

/** 连接管理（@capacitor-community/sqlite 的 SQLiteConnection 子集）；单测注入假实现。 */
export interface CapacitorConnections {
  checkConnectionsConsistency(): Promise<{ result?: boolean }>;
  isConnection(database: string, readonly: boolean): Promise<{ result?: boolean }>;
  retrieveConnection(database: string, readonly: boolean): Promise<CapacitorDb>;
  createConnection(database: string, encrypted: boolean, mode: string, version: number, readonly: boolean): Promise<CapacitorDb>;
  closeConnection(database: string, readonly: boolean): Promise<void>;
}

/**
 * 拿到一个已打开的连接。
 * 网页重新载入（「重试」、WebView 重建）后原生侧的同名连接还在，直接 createConnection 会报已存在：
 * 先对账，有就复用；打开失败时关掉连接重建一次。
 */
export async function openCapacitorDb(connections: CapacitorConnections, database: string, version: number): Promise<CapacitorDb> {
  const consistent = (await connections.checkConnectionsConsistency()).result === true;
  const exists = (await connections.isConnection(database, false)).result === true;
  const reuse = consistent && exists;
  try {
    const db = reuse
      ? await connections.retrieveConnection(database, false)
      : await connections.createConnection(database, false, 'no-encryption', version, false);
    if ((await db.isDBOpen()).result !== true) await db.open();
    return db;
  } catch (error) {
    logWarn('storage', '原生数据库打开失败，重建连接再试一次', { reuse, message: errorMessage(error) });
    try {
      await connections.closeConnection(database, false);
    } catch (closeError) {
      // 连接本就不在时关闭会报错，不影响重建
      logWarn('storage', '原生数据库连接关闭失败', { message: errorMessage(closeError) });
    }
    const db = await connections.createConnection(database, false, 'no-encryption', version, false);
    await db.open();
    return db;
  }
}

/** Android 端驱动：底层是 @capacitor-community/sqlite（系统 SQLite）。 */
export async function openCapacitorDriver(
  database = 'dawn_tick',
  version = 1,
): Promise<SqlDriver> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const db = await openCapacitorDb(new SQLiteConnection(CapacitorSQLite) as unknown as CapacitorConnections, database, version);

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
