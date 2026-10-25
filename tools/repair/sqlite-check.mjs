//! SQLite `quick_check` 检查引擎：sqlite3 CLI → node:sqlite（Node 24+）→ py -3 / python3。
//!
//! 三种引擎都只读打开，返回 `{ ok, detail }`；都不可用时 `createChecker()` 返回 null，
//! 由修复脚本给出“无法检查、未改动文件”的明确提示。

import { spawnSync } from 'node:child_process';

/** quick_check 的 SQL 与输出约定由 SQLite 固定，三种引擎共用。 */
const QUICK_CHECK_SQL = 'PRAGMA quick_check;';

function runCapture(command, args, timeout = 20_000) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function sqliteCliAvailable() {
  try {
    return runCapture('sqlite3', ['-version'], 5_000).status === 0;
  } catch {
    return false;
  }
}

function pythonCandidates() {
  const script =
    'import sqlite3, sys\n' +
    'db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)\n' +
    'for row in db.execute("PRAGMA quick_check"):\n' +
    '    print(row[0])\n' +
    'db.close()\n';
  return [
    ['py', ['-3', '-c', script]],
    ['python3', ['-c', script]],
    ['python', ['-c', script]],
  ];
}

function evaluateRows(rows) {
  const cleaned = rows.map((row) => String(row ?? '').trim()).filter((row) => row !== '');
  if (cleaned.length === 0) return { ok: true, detail: '' };
  const ok = cleaned.every((row) => row.toLowerCase() === 'ok');
  return { ok, detail: ok ? '' : cleaned.join('; ') };
}

/** sqlite3 CLI：`-readonly` 只读打开，损坏时退出码非 0 且错误在 stderr。 */
function checkWithCli(file) {
  const result = runCapture('sqlite3', ['-readonly', file, QUICK_CHECK_SQL]);
  if (result.status === 0) return evaluateRows((result.stdout ?? '').trim().split(/\r?\n/));
  const stderr = (result.stderr ?? '').trim();
  return { ok: false, detail: stderr === '' ? `sqlite3 退出码 ${result.status}` : stderr };
}

/** Node 24 内置 sqlite：进程内只读打开，不依赖 PATH。 */
function checkWithNodeSqlite(DatabaseSync, file) {
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return evaluateRows(db.prepare(QUICK_CHECK_SQL).all().map((row) => Object.values(row)[0]));
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      db?.close();
    } catch {
      // 关闭失败不改变检查结论
    }
  }
}

/** `py -3` / `python3`：没有 Node 24 时的最后兜底。 */
function checkWithPython(command, baseArgs, file) {
  const result = runCapture(command, [...baseArgs, file]);
  if (result.status === 0) return evaluateRows((result.stdout ?? '').trim().split(/\r?\n/));
  const stderr = (result.stderr ?? '').trim();
  return { ok: false, detail: stderr === '' ? `${command} 退出码 ${result.status}` : stderr };
}

async function loadNodeSqlite() {
  try {
    const module = await import('node:sqlite');
    return module.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

/**
 * 选择检查引擎。`DAWNTICK_REPAIR_CHECKER=cli|node|python` 可强制指定（测试用）；
 * 都不可用时返回 null，由调用方给“无法检查”的明确提示。
 */
export async function createChecker() {
  const preference = process.env.DAWNTICK_REPAIR_CHECKER ?? '';
  const build = (kind, DatabaseSync, python) => {
    if (kind === 'cli') return { name: 'sqlite3 CLI', check: (file) => checkWithCli(file) };
    if (kind === 'node' && DatabaseSync !== null) {
      return {
        name: `node:sqlite（Node ${process.version}）`,
        check: (file) => checkWithNodeSqlite(DatabaseSync, file),
      };
    }
    if (kind === 'python' && python !== undefined) {
      return {
        name: `${python[0]} sqlite3`,
        check: (file) => checkWithPython(python[0], python[1], file),
      };
    }
    return null;
  };
  const findPython = () =>
    pythonCandidates().find(([command, args]) => {
      try {
        return runCapture(command, [...args, '--version'], 5_000).status === 0;
      } catch {
        return false;
      }
    });

  // 显式指定时不再探测其它引擎：测试与排障都希望快且确定
  if (preference === 'cli') return sqliteCliAvailable() ? build('cli') : null;
  if (preference === 'node') return build('node', await loadNodeSqlite());
  if (preference === 'python') return build('python', null, findPython());
  if (preference !== '') return null;

  if (sqliteCliAvailable()) return build('cli');
  const nodeChecker = build('node', await loadNodeSqlite());
  if (nodeChecker !== null) return nodeChecker;
  return build('python', null, findPython());
}
