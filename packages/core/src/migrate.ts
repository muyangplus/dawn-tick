import { hasTable, type SqlDriver } from './db.ts';

export const META_TABLE = 'app_meta';
export const SCHEMA_VERSION_KEY = 'schema_version';
/** 桌面端 tauri-plugin-sql（sqlx）的迁移记账表；早期纯 JS 迁移建立的库没有它。 */
export const SQLX_MIGRATIONS_TABLE = '_sqlx_migrations';
/** 旧库补写基线的一次性标记：值是按 app_meta.schema_version 记下的版本号。 */
export const LEGACY_SQLX_BASELINE_KEY = 'legacy_sqlx_baseline_v1';

export interface Migration {
  id: string;
  sql: string;
}

/** 旧库兼容自检的结论：只读检测，不改表、不重放迁移。 */
export interface SqlxBaselineState {
  /** sqlite_master 里有 users：库已经由早期版本建立过 */
  hasUsers: boolean;
  /** 是否有 sqlx 的迁移记账表 */
  hasSqlxMigrations: boolean;
  /** app_meta 里的迁移版本，补写基线时原样记录 */
  schemaVersion: string;
  /** 有 users 却没有记账表：插件从 001 重跑会因「表已存在」失败 */
  legacy: boolean;
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

/** 只读判断库是不是「有 users、缺 `_sqlx_migrations`」的旧库。 */
export async function inspectSqlxBaseline(db: SqlDriver): Promise<SqlxBaselineState> {
  const hasUsers = await hasTable(db, 'users');
  const hasSqlxMigrations = await hasTable(db, SQLX_MIGRATIONS_TABLE);
  const schemaVersion = hasUsers ? await readSchemaVersion(db) : '';
  return { hasUsers, hasSqlxMigrations, schemaVersion, legacy: hasUsers && !hasSqlxMigrations };
}

/**
 * 按 `app_meta.schema_version` 补写旧库基线标记：只记账、不建表、不重放迁移。
 * 与 `weeks_raw` 回填同口径，重复调用幂等；没有版本号时不写。
 */
export async function writeLegacySqlxBaseline(db: SqlDriver, schemaVersion: string): Promise<boolean> {
  if (schemaVersion === '') return false;
  if ((await readMeta(db, LEGACY_SQLX_BASELINE_KEY)) === schemaVersion) return false;
  await writeMeta(db, LEGACY_SQLX_BASELINE_KEY, schemaVersion);
  return true;
}
