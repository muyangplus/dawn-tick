import { WAL_META_KEY, type SqlDriver, type Storage } from '@dawn-tick/core';
import type { Platform } from '../platform-detect.ts';
import { logInfo, logWarn } from '../log.ts';
import { errorMessage } from '../lib/errors.ts';

/** WAL 的默认口径：便携版关（单文件），安装版与 Android 开。 */
export function walEnabledByDefault(portable: boolean, platform: Platform): boolean {
  if (platform === 'capacitor') return true;
  return !portable;
}

/** 把设置里的 wal_mode 解析成开关；null 表示这一端没有日志模式可设（Web 用 IndexedDB）。 */
export function resolveWalEnabled(
  mode: string | undefined,
  options: { portable: boolean; platform: Platform },
): boolean | null {
  if (options.platform === 'web') return null;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return walEnabledByDefault(options.portable, options.platform);
}

/** on → WAL，off → DELETE：DELETE 不产生 -wal / -shm，数据库永远是单个文件。 */
export function journalModeSql(enabled: boolean): string {
  return `PRAGMA journal_mode=${enabled ? 'WAL' : 'DELETE'}`;
}

/** 开启数据库后套用日志模式；失败只记日志，不挡住启动。 */
export async function applyJournalMode(driver: SqlDriver, enabled: boolean): Promise<string | null> {
  const sql = journalModeSql(enabled);
  const want = enabled ? 'wal' : 'delete';
  try {
    const rows = await driver.all<Record<string, string>>(sql);
    const applied = (rows[0]?.['journal_mode'] ?? '').toLowerCase();
    if (applied !== want) {
      // SQLite 改不动时返回当前模式而不是报错：有其它连接在用时就会这样
      logWarn('storage', '数据库日志模式未生效', { want, applied: applied || '未知' });
      return null;
    }
    logInfo('storage', '数据库日志模式', { mode: want });
    return applied;
  } catch (cause: unknown) {
    logWarn('storage', '设置数据库日志模式失败', {
      mode: want,
      message: errorMessage(cause),
    });
    return null;
  }
}

/** 按已保存的设置套用日志模式（设置就在这个库里，所以先开库再读）。 */
export async function applyStoredJournalMode(
  driver: SqlDriver,
  storage: Storage,
  options: { portable: boolean; platform: Platform },
): Promise<boolean> {
  let mode: string | undefined;
  try {
    mode = await storage.readMeta(WAL_META_KEY);
  } catch {
    // 全新库还没有 app_meta：按默认口径处理
    mode = undefined;
  }
  const enabled = resolveWalEnabled(mode, options);
  if (enabled === null) return false;
  return (await applyJournalMode(driver, enabled)) !== null;
}
