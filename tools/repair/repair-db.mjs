#!/usr/bin/env node
/**
 * 一次性数据库修复工具（无第三方依赖）。
 *
 * 背景：便携版被多个实例并发打开后，`dawn-tick.db` 可能损坏成
 * `database disk image is malformed` / `unsupported file format`；应用启动自检会恢复，
 * 但已经起不来的现场需要离线修一把。本工具做四件事：
 *
 * 1. 用 `quick_check` 检查主库与 `backups/*.db`，只挑**最新且健康**的快照；
 * 2. 把损坏主库改名成 `dawn-tick.db.corrupt-<yyyyMMdd-HHmmss>` 留存；
 * 3. 把快照复制为主库，并清理主库旁的 `-wal/-shm/-journal`；
 * 4. 可选 `--stage=<快照>` 只写 `pending-restore.json`，交给下次启动自动恢复。
 *
 * 检查引擎按环境自动选择：`sqlite3` CLI → Node 24 的 `node:sqlite` → `py -3` 的 sqlite3。
 * 三者都不可用时给出明确提示，不会盲改文件。
 *
 * 用法：
 *   node tools/repair/repair-db.mjs --dir="E:\path\to\data" --dry-run
 *   node tools/repair/repair-db.mjs --dir="E:\path\to\data"
 *   node tools/repair/repair-db.mjs --dir="E:\path\to\data" --stage=dawn-tick-20261025-204530.db
 */

import {
  copyFileSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createChecker } from './sqlite-check.mjs';

export const DB_NAME = 'dawn-tick.db';
export const PENDING_RESTORE_FILE = 'pending-restore.json';
/** 快照命名与 Rust 侧 `backup_name()` 一致：dawn-tick-<yyyyMMdd-HHmmss>.db */
const SNAPSHOT_RE = /^dawn-tick-\d{8}-\d{6}\.db$/;
const SIDECARS = ['-wal', '-shm', '-journal'];

/** 快照文件名的本地时间戳：yyyyMMdd-HHmmss，与 Rust `local_stamp()` 一致。 */
export function localStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 备份目录里的快照候选：只认规范命名，按时间倒序（最新优先）。 */
export function listSnapshots(backupsDir) {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir)
    .filter((name) => SNAPSHOT_RE.test(name))
    .map((name) => {
      const path = join(backupsDir, name);
      let bytes = 0;
      try {
        bytes = statSync(path).size;
      } catch {
        bytes = 0;
      }
      return { name, path, bytes };
    })
    .sort((left, right) => right.name.localeCompare(left.name));
}

/** 主库旁边还需要一起清掉的附带文件。 */
function sidecarPaths(dir) {
  return SIDECARS.map((suffix) => ({ suffix, path: join(dir, `${DB_NAME}${suffix}`) }));
}

/** 已留存的损坏库名单（含附带文件），用于报告。 */
export function retainedCorruptFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(`${DB_NAME}.corrupt-`))
    .sort();
}

async function inspectSnapshots(checker, snapshots, lines) {
  const healthy = [];
  for (const snapshot of snapshots) {
    if (snapshot.bytes === 0) {
      lines.push(`  [空文件] ${snapshot.name}`);
      continue;
    }
    const result = checker.check(snapshot.path);
    if (result.ok) {
      healthy.push(snapshot);
      lines.push(`  [健康] ${snapshot.name}（${snapshot.bytes} 字节）`);
    } else {
      lines.push(`  [损坏] ${snapshot.name}：${result.detail}`);
    }
  }
  return healthy;
}

function writePendingRestore(dir, name) {
  const path = join(dir, PENDING_RESTORE_FILE);
  // 与 Rust 的 serde 结构一致：{"name":"<快照文件名>"}
  writeFileSync(path, JSON.stringify({ name }), 'utf8');
  return path;
}

/**
 * 执行一次修复/暂存。返回 `{ code, lines }`，CLI 负责打印与退出码。
 * `dryRun` 只报告；`stage` 只写 pending-restore.json，不碰当前数据库。
 */
export async function runRepair(options) {
  const lines = [];
  const dir = resolve(options.dir);
  const backupsDir = join(dir, 'backups');
  lines.push(`数据目录：${dir}`);

  if (!existsSync(dir)) {
    return { code: 1, lines: [...lines, `数据目录不存在：${dir}`] };
  }

  const checker = await createChecker();
  if (checker === null) {
    return {
      code: 1,
      lines: [
        ...lines,
        '无法检查 SQLite：未找到 sqlite3 CLI、Node 24 的 node:sqlite，或可用的 py -3。',
        '请安装 sqlite3 命令行工具（或使用 Node 24+）后重试；本次未改动任何文件。',
      ],
    };
  }
  lines.push(`检查方式：${checker.name}`);

  const dbPath = join(dir, DB_NAME);
  const dbExists = existsSync(dbPath);
  let mainResult = null;
  if (!dbExists) {
    lines.push(`主库：不存在（${dbPath}）`);
  } else {
    mainResult = checker.check(dbPath);
    lines.push(
      mainResult.ok
        ? `主库：健康（${statSync(dbPath).size} 字节）`
        : `主库：损坏（${mainResult.detail}）`,
    );
  }

  const snapshots = listSnapshots(backupsDir);
  lines.push(`快照目录：${backupsDir}`);
  if (snapshots.length === 0) {
    lines.push('  未找到 dawn-tick-<时间戳>.db 快照');
  }
  const healthy = await inspectSnapshots(checker, snapshots, lines);
  lines.push(`健康快照：${healthy.length} 份${healthy.length === 0 ? '' : `，最新为 ${healthy[0].name}`}`);

  const retained = retainedCorruptFiles(dir);
  lines.push(
    retained.length === 0
      ? '已留存损坏文件：无'
      : `已留存损坏文件（${retained.length} 个）：${retained.join('、')}`,
  );

  // --stage：只排队一次恢复请求，交给下次启动消费；不主动改当前数据库
  if (typeof options.stage === 'string' && options.stage !== '') {
    const name = basename(options.stage.trim());
    const candidate = snapshots.find((snapshot) => snapshot.name === name);
    if (candidate === undefined) {
      return {
        code: 1,
        lines: [...lines, `快照不存在或命名不规范：${name}（只接受 backups 目录内的快照文件名）`],
      };
    }
    const result = checker.check(candidate.path);
    if (!result.ok) {
      return { code: 1, lines: [...lines, `快照未通过 quick_check，拒绝排队恢复：${name}（${result.detail}）`] };
    }
    if (options.dryRun === true) {
      lines.push(`dry-run：将写入 ${PENDING_RESTORE_FILE}：{"name":"${name}"}（未改动任何文件）`);
      return { code: 0, lines };
    }
    const marker = writePendingRestore(dir, name);
    lines.push(`已写入 ${marker}：下次启动将自动用快照 ${name} 恢复`);
    lines.push('提示：本工具没有改动当前主库；直接启动应用即可套用恢复请求。');
    return { code: 0, lines };
  }

  if (!dbExists) {
    lines.push('结论：主库不存在，无需修复。');
    return { code: 0, lines };
  }
  if (mainResult !== null && mainResult.ok) {
    lines.push('结论：主库通过 quick_check，无需修复。');
    return { code: 0, lines };
  }
  if (healthy.length === 0) {
    lines.push('结论：没有通过 quick_check 的快照，未改动主库；请打开数据目录手动处理。');
    return { code: 1, lines };
  }

  const chosen = healthy[0];
  const stamp = localStamp();
  const corruptName = `${DB_NAME}.corrupt-${stamp}`;
  if (options.dryRun === true) {
    lines.push(`dry-run：将把损坏主库留存为 ${corruptName}，并用 ${chosen.name} 恢复主库。`);
    lines.push('dry-run：未改动任何文件。');
    return { code: 0, lines };
  }

  const corruptPath = join(dir, corruptName);
  try {
    renameSync(dbPath, corruptPath);
  } catch (error) {
    return {
      code: 1,
      lines: [
        ...lines,
        `留存损坏主库失败：${error instanceof Error ? error.message : String(error)}`,
        '请关闭正在占用数据库的程序后重试；本次未复制快照。',
      ],
    };
  }
  lines.push(`已留存损坏主库：${corruptName}`);

  // 主库旁的 -wal/-shm/-journal 跟着留存；搬不动就删除，避免新库误读旧日志
  for (const sidecar of sidecarPaths(dir)) {
    if (!existsSync(sidecar.path)) continue;
    try {
      renameSync(sidecar.path, `${corruptPath}${sidecar.suffix}`);
      lines.push(`已留存附带文件：${corruptName}${sidecar.suffix}`);
    } catch (error) {
      rmSync(sidecar.path, { force: true });
      lines.push(
        `附带文件 ${DB_NAME}${sidecar.suffix} 无法留存，已删除（${
          error instanceof Error ? error.message : String(error)
        }）`,
      );
    }
  }

  try {
    copyFileSync(chosen.path, dbPath);
  } catch (error) {
    return {
      code: 1,
      lines: [
        ...lines,
        `复制快照失败：${error instanceof Error ? error.message : String(error)}`,
        `损坏主库已留存为 ${corruptName}；请手动把 ${chosen.name} 复制为 ${DB_NAME}。`,
      ],
    };
  }

  const restored = checker.check(dbPath);
  if (!restored.ok) {
    lines.push(`恢复后主库仍未通过 quick_check：${restored.detail}`);
    lines.push(`损坏主库已留存为 ${corruptName}，请换一份快照或人工处理。`);
    return { code: 1, lines };
  }

  lines.push(`已用快照 ${chosen.name} 恢复主库（${statSync(dbPath).size} 字节），quick_check 通过。`);
  const saved = retainedCorruptFiles(dir);
  lines.push(`留存名单（${saved.length} 个）：${saved.length === 0 ? '无' : saved.join('、')}`);
  lines.push('结论：修复完成；重新启动应用即可。');
  return { code: 0, lines };
}

/** 参数解析：只支持显式 `--key=value` 与布尔开关，未知参数直接报错。 */
export function parseArgs(argv) {
  const options = { dir: '', dryRun: false, stage: null, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--dir=')) {
      options.dir = arg.slice('--dir='.length);
      continue;
    }
    if (arg.startsWith('--stage=')) {
      options.stage = arg.slice('--stage='.length);
      continue;
    }
    throw new Error(`不认识的参数：${arg}（支持 --dir= / --dry-run / --stage= / --help）`);
  }
  if (!options.help && options.dir.trim() === '') {
    throw new Error('缺少 --dir=<数据目录>');
  }
  return options;
}

const HELP = `用法：
  node tools/repair/repair-db.mjs --dir=<数据目录> [--dry-run]
  node tools/repair/repair-db.mjs --dir=<数据目录> --stage=<快照文件名>

选项：
  --dir=<目录>      应用数据目录（含 dawn-tick.db 与 backups/）
  --dry-run        只报告，不写任何文件
  --stage=<快照>   只写 pending-restore.json，下次启动自动恢复（不碰当前主库）
  --help           显示本帮助

检查引擎优先级：sqlite3 CLI → node:sqlite（Node 24+）→ py -3 / python3。
可用环境变量 DAWNTICK_REPAIR_CHECKER=cli|node|python 强制指定。`;

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    console.error(HELP);
    return 1;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const { code, lines } = await runRepair(options);
  for (const line of lines) console.log(line);
  return code;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
