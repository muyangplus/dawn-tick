import { detectPlatform, type Platform } from '../platform-detect.ts';

/** SQLite 的损坏报错都带这些字样。 */
const CORRUPT_MARKERS = [
  'malformed',
  'corrupt',
  'not a database',
  'unsupported file format',
  'code: 11',
  'code: 26',
];

/** 是否属于数据库损坏：界面据此换文案，并且不再回退到 IndexedDB。 */
export function isCorruptDatabase(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  const lower = message.toLowerCase();
  return CORRUPT_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * 是否属于「旧库缺 `_sqlx_migrations`」：桌面插件在 `load` 内先跑 Rust 迁移，
 * 旧库会从 001 重跑并在建 `users` 时撞上「表已存在」。
 * 判据取 sqlx 的迁移前缀 + SQLite 的 existing 报错 + users 表名，避免误伤其它迁移失败。
 */
export function isMissingSqlxMigrations(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  const lower = message.toLowerCase();
  return (
    lower.includes('while executing migration') &&
    lower.includes('already exists') &&
    lower.includes('users')
  );
}

/** 损坏时的界面文案：事实 + 下一步。 */
export function corruptMessage(platform: Platform = detectPlatform()): string {
  return platform === 'tauri'
    ? '数据库文件损坏，重启应用会再试一次恢复'
    : '数据库文件损坏，请从备份导入恢复';
}
