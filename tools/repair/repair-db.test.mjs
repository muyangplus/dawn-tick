import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 修复工具的自检：全部在仓库 `tmp/` 下的临时数据目录里跑，不碰真实数据。
 * 需要 Node 24 的 `node:sqlite` 造库；没有时跳过（verify-all 在旧 Node 上不会挂）。
 */
const SQLITE = await (async () => {
  try {
    const module = await import('node:sqlite');
    return module.DatabaseSync ?? null;
  } catch {
    return null;
  }
})();
const SKIP = SQLITE === null ? '当前 Node 没有 node:sqlite（需要 Node 24+）' : false;
const SCRIPT = fileURLToPath(new URL('./repair-db.mjs', import.meta.url));
const DB = 'dawn-tick.db';
let counter = 0;

function scratchDir() {
  counter += 1;
  const dir = join(process.cwd(), 'tmp', `repair-db-test-${process.pid}-${counter}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'backups'), { recursive: true });
  return dir;
}

function seedDb(path, sql = 'CREATE TABLE t (a INTEGER)') {
  const db = new SQLITE(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function healthy(path) {
  const db = new SQLITE(path, { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA quick_check').all();
    return rows.every((row) => String(Object.values(row)[0]).trim().toLowerCase() === 'ok');
  } finally {
    db.close();
  }
}

function runCli(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DAWNTICK_REPAIR_CHECKER: 'node' },
    timeout: 60_000,
  });
  return { code: result.status, out: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

function snapshotNames(dir) {
  return readdirSync(dir).filter((name) => name.startsWith(`${DB}.corrupt-`));
}

test('dry-run 只报告：不改主库、不产生留存文件', { skip: SKIP }, () => {
  const dir = scratchDir();
  try {
    const db = join(dir, DB);
    writeFileSync(db, 'not a sqlite database');
    seedDb(join(dir, 'backups', 'dawn-tick-20260101-000000.db'));
    writeFileSync(join(dir, 'backups', 'dawn-tick-20260102-000000.db'), 'broken');
    writeFileSync(join(dir, 'backups', 'dawn-tick-20260103-000000.db'), '');
    seedDb(join(dir, 'backups', 'dawn-tick-20260104-000000.db'));

    const { code, out } = runCli([`--dir=${dir}`, '--dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /主库：损坏/);
    assert.match(out, /\[健康\] dawn-tick-20260104-000000\.db/);
    assert.match(out, /\[损坏\] dawn-tick-20260102-000000\.db/);
    assert.match(out, /\[空文件\] dawn-tick-20260103-000000\.db/);
    assert.match(out, /dry-run：将把损坏主库留存为 dawn-tick\.db\.corrupt-/);
    assert.match(out, /并用 dawn-tick-20260104-000000\.db 恢复主库/);
    assert.match(out, /未改动任何文件/);
    assert.equal(readFileSync(db, 'utf8'), 'not a sqlite database', '主库不应被改动');
    assert.deepEqual(snapshotNames(dir), [], 'dry-run 不应产生留存文件');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('修复：留存损坏主库与附带文件，用最新健康快照恢复', { skip: SKIP }, () => {
  const dir = scratchDir();
  try {
    const db = join(dir, DB);
    writeFileSync(db, 'broken');
    writeFileSync(join(dir, `${DB}-wal`), 'wal');
    writeFileSync(join(dir, `${DB}-shm`), 'shm');
    seedDb(join(dir, 'backups', 'dawn-tick-20260101-000000.db'), 'CREATE TABLE t (a INTEGER, b TEXT)');
    writeFileSync(join(dir, 'backups', 'dawn-tick-20260102-000000.db'), 'broken');

    const { code, out } = runCli([`--dir=${dir}`]);
    assert.equal(code, 0, out);
    assert.match(out, /已留存损坏主库：dawn-tick\.db\.corrupt-/);
    assert.match(out, /已用快照 dawn-tick-20260101-000000\.db 恢复主库/);
    assert.match(out, /结论：修复完成/);
    assert.ok(healthy(db), '恢复后的主库应通过 quick_check');
    assert.equal(existsSync(join(dir, `${DB}-wal`)), false, 'wal 应被清理');
    assert.equal(existsSync(join(dir, `${DB}-shm`)), false, 'shm 应被清理');
    const retained = snapshotNames(dir);
    assert.ok(retained.length >= 1, `应有留存文件: ${retained.join(',')}`);
    assert.ok(
      retained.some((name) => name.endsWith('-wal')),
      `wal 应一起留存: ${retained.join(',')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('没有健康快照时不改主库并给出原因', { skip: SKIP }, () => {
  const dir = scratchDir();
  try {
    const db = join(dir, DB);
    writeFileSync(db, 'broken');
    writeFileSync(join(dir, 'backups', 'dawn-tick-20260101-000000.db'), 'broken');

    const { code, out } = runCli([`--dir=${dir}`]);
    assert.equal(code, 1, out);
    assert.match(out, /没有通过 quick_check 的快照/);
    assert.equal(readFileSync(db, 'utf8'), 'broken', '没有快照时不应搬走损坏主库');
    assert.deepEqual(snapshotNames(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('主库健康时不做任何修复', { skip: SKIP }, () => {
  const dir = scratchDir();
  try {
    const db = join(dir, DB);
    seedDb(db);
    const { code, out } = runCli([`--dir=${dir}`]);
    assert.equal(code, 0, out);
    assert.match(out, /结论：主库通过 quick_check，无需修复/);
    assert.deepEqual(snapshotNames(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--stage 写入 pending-restore.json 且不碰当前主库', { skip: SKIP }, () => {
  const dir = scratchDir();
  try {
    const db = join(dir, DB);
    writeFileSync(db, 'broken');
    seedDb(join(dir, 'backups', 'dawn-tick-20260101-000000.db'));

    const name = 'dawn-tick-20260101-000000.db';
    const { code, out } = runCli([`--dir=${dir}`, `--stage=${name}`]);
    assert.equal(code, 0, out);
    assert.match(out, /下次启动将自动用快照 dawn-tick-20260101-000000\.db 恢复/);
    assert.equal(readFileSync(db, 'utf8'), 'broken', '暂存恢复不应改动主库');
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, 'pending-restore.json'), 'utf8')),
      { name },
      'pending-restore.json 格式固定为 {"name":"<快照文件名>"}',
    );

    // dry-run + stage：只报告，不写文件
    rmSync(join(dir, 'pending-restore.json'));
    const dry = runCli([`--dir=${dir}`, `--stage=${name}`, '--dry-run']);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /dry-run：将写入 pending-restore\.json/);
    assert.equal(existsSync(join(dir, 'pending-restore.json')), false);

    // 目录外/不存在的快照名必须拒绝
    const bad = runCli([`--dir=${dir}`, '--stage=../dawn-tick.db']);
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /快照不存在或命名不规范/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
