import { normalizeRow } from './columns.ts';
import type { SqlDriver, SqlValue } from './db.ts';
import { STORE_KEYS, type Collection, type Storage, type StoreName } from './storage.ts';

type Row = Record<string, unknown>;

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new TypeError(`无法写入的值类型: ${typeof value}`);
}

class SqliteCollection<T> implements Collection<T> {
  readonly name: StoreName;
  private readonly db: SqlDriver;

  constructor(db: SqlDriver, name: StoreName) {
    this.db = db;
    this.name = name;
  }

  async get(key: string): Promise<T | undefined> {
    return this.db.get<T>(`SELECT * FROM ${this.name} WHERE ${STORE_KEYS[this.name]} = ?`, [key]);
  }

  async getAll(): Promise<T[]> {
    return this.db.all<T>(`SELECT * FROM ${this.name}`);
  }

  async put(value: T): Promise<void> {
    // 最后一道防线：对象键先翻译成真实列名，避免驼峰键被当成列名写进 SQL。
    const row = normalizeRow(this.name, value as Row);
    const columns = Object.keys(row).filter((column) => row[column] !== undefined);
    if (columns.length === 0) return;
    const primary = STORE_KEYS[this.name];
    const updates = columns
      .filter((column) => column !== primary)
      .map((column) => `${column} = excluded.${column}`)
      .join(', ');
    const sql =
      `INSERT INTO ${this.name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})` +
      (updates.length > 0 ? ` ON CONFLICT(${primary}) DO UPDATE SET ${updates}` : ` ON CONFLICT(${primary}) DO NOTHING`);
    await this.db.run(
      sql,
      columns.map((column) => toSqlValue(row[column])),
    );
  }

  async putMany(values: readonly T[]): Promise<void> {
    for (const value of values) await this.put(value);
  }

  async delete(key: string): Promise<void> {
    await this.db.run(`DELETE FROM ${this.name} WHERE ${STORE_KEYS[this.name]} = ?`, [key]);
  }

  async clear(): Promise<void> {
    await this.db.exec(`DELETE FROM ${this.name}`);
  }
}

/** SQLite 实现，用于 Windows（tauri-plugin-sql）、Android（Capacitor SQLite）与 Node 测试。 */
export function sqliteStorage(db: SqlDriver): Storage {
  const cache = new Map<StoreName, SqliteCollection<unknown>>();
  const collection = <T,>(name: StoreName): Collection<T> => {
    const existing = cache.get(name);
    if (existing !== undefined) return existing as SqliteCollection<T>;
    const created = new SqliteCollection<T>(db, name);
    cache.set(name, created as SqliteCollection<unknown>);
    return created;
  };

  return {
    kind: 'sqlite',
    collection,
    async readMeta(key: string): Promise<string | undefined> {
      const row = await collection<{ key: string; value: string }>('app_meta').get(key);
      return row?.value;
    },
    async writeMeta(key: string, value: string): Promise<void> {
      await collection<{ key: string; value: string }>('app_meta').put({ key, value });
    },
    async close(): Promise<void> {
      await db.close();
    },
  };
}
