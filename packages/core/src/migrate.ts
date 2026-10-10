import { hasTable, type SqlDriver } from './db.ts';

export const META_TABLE = 'app_meta';
export const SCHEMA_VERSION_KEY = 'schema_version';

export interface Migration {
  id: string;
  sql: string;
}

export async function readSchemaVersion(db: SqlDriver): Promise<string> {
  if (!(await hasTable(db, META_TABLE))) return '';
  const row = await db.get<{ value: string }>(
    `SELECT value FROM ${META_TABLE} WHERE key = ?`,
    [SCHEMA_VERSION_KEY],
  );
  return row?.value ?? '';
}

export async function writeMeta(db: SqlDriver, key: string, value: string): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await db.run(
    `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function readMeta(db: SqlDriver, key: string): Promise<string | undefined> {
  if (!(await hasTable(db, META_TABLE))) return undefined;
  const row = await db.get<{ value: string }>(`SELECT value FROM ${META_TABLE} WHERE key = ?`, [key]);
  return row?.value;
}

/** 按 id 升序应用尚未执行的迁移，返回最终版本号。 */
export async function migrate(db: SqlDriver, migrations: readonly Migration[]): Promise<string> {
  const applied = await readSchemaVersion(db);
  const pending = [...migrations]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .filter((migration) => migration.id > applied);

  for (const migration of pending) {
    await db.exec(migration.sql);
    await writeMeta(db, SCHEMA_VERSION_KEY, migration.id);
  }
  return readSchemaVersion(db);
}
