import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDriver, SqlValue } from '../db.ts';
import type { Migration } from '../migrate.ts';

/** 桌面与脚本侧驱动；Web 与 Android 由各自驱动实现同一接口。 */
export function openNodeSqlite(location: string): SqlDriver {
  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON');
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    get<T>(sql: string, params: readonly SqlValue[] = []): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    run(sql: string, params: readonly SqlValue[] = []): void {
      db.prepare(sql).run(...params);
    },
    close(): void {
      db.close();
    },
  };
}

export function loadSqlMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      id: name.replace(/\.sql$/, ''),
      sql: readFileSync(join(dir, name), 'utf8'),
    }));
}
