import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SqlDriver, SqlValue } from '@dawn-tick/core';
import { migrate } from '@dawn-tick/core';
import { MIGRATIONS } from './migrations.ts';

interface Oo1Db {
  exec(sql: string, bind?: SqlValue[]): void;
  selectObjects(sql: string, bind?: SqlValue[]): unknown[];
  close(): void;
}

export interface WebDatabase {
  driver: SqlDriver;
  engine: string;
  storage: 'opfs' | 'memory';
  schemaVersion: string;
}

export async function openWebDatabase(fileName = '/dawn-tick.sqlite3'): Promise<WebDatabase> {
  const sqlite3 = await sqlite3InitModule();
  const oo1 = sqlite3.oo1 as unknown as {
    DB: new (file: string, flags?: string) => Oo1Db;
    OpfsDb?: new (file: string) => Oo1Db;
  };

  let db: Oo1Db;
  let storage: WebDatabase['storage'] = 'memory';
  if (typeof oo1.OpfsDb === 'function') {
    try {
      db = new oo1.OpfsDb(fileName);
      storage = 'opfs';
    } catch {
      db = new oo1.DB(':memory:', 'c');
    }
  } else {
    db = new oo1.DB(':memory:', 'c');
  }

  db.exec('PRAGMA foreign_keys = ON');

  const driver: SqlDriver = {
    exec(sql: string): void {
      db.exec(sql);
    },
    all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
      return db.selectObjects(sql, [...params]) as T[];
    },
    get<T>(sql: string, params: readonly SqlValue[] = []): T | undefined {
      return (db.selectObjects(sql, [...params]) as T[])[0];
    },
    run(sql: string, params: readonly SqlValue[] = []): void {
      db.exec(sql, [...params]);
    },
    close(): void {
      db.close();
    },
  };

  const schemaVersion = migrate(driver, MIGRATIONS);
  return { driver, engine: sqlite3.version.libVersion, storage, schemaVersion };
}
