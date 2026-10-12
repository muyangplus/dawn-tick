#!/usr/bin/env node
// 从其他位置的数据导出备份：读取别处的 dawn-tick.db，生成可被应用导入的备份 JSON。
//
// 用法：
//   node tools/backup/export-anywhere.mjs --list
//   node tools/backup/export-anywhere.mjs --db "<数据库路径>" [--out "<输出文件>"] [--modules all|semesters,courses,events,reminders,settings]
//   node tools/backup/export-anywhere.mjs --scan "<目录>" [--out "<输出文件>"]
//   node tools/backup/export-anywhere.mjs --from-backup "<备份.json>" ["<另一个.json>" ...] [--out "<输出文件>"]
//
// 网页版（浏览器 IndexedDB）的数据：在网页版里打开 设置 → 数据 → 导出备份 得到 json，再用 --from-backup 处理或直接导入。

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BACKUP_FORMAT,
  BACKUP_MODULES,
  BACKUP_VERSION,
  moduleStores,
  exportBackup,
  summarizeBackup,
} from '../../packages/core/src/backup.ts';
import { sqliteStorage } from '../../packages/core/src/sqlite-storage.ts';
import { openNodeSqlite } from '../../packages/core/src/drivers/node-sqlite.ts';
import { STORE_KEYS } from '../../packages/core/src/storage.ts';

const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function knownLocations() {
  const list = [];
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'com.dawntick.app', 'dawn-tick.db'));
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'DawnTick', 'dawn-tick.db'));
  list.push(path.resolve('out-local/com.dawntick.app/dawn-tick.db'));
  return list;
}

function describe(file) {
  if (!existsSync(file)) return `${file}（不存在）`;
  const size = statSync(file).size;
  return `${file}（${(size / 1024).toFixed(1)} KB）`;
}

function scan(directory) {
  const found = [];
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'dawn-tick.db') found.push(path.join(directory, entry.name));
    if (entry.isDirectory()) {
      const nested = path.join(directory, entry.name, 'dawn-tick.db');
      if (existsSync(nested)) found.push(nested);
    }
  }
  return found;
}

async function run() {
  if (args.includes('--help') || args.length === 0) {
    console.log('用法：');
    console.log('  --list                              查看已知数据位置');
    console.log('  --db <路径> [--out <文件>]          从 SQLite 库导出');
    console.log('  --scan <目录> [--out <文件>]        在目录（含一层子目录）里找库并导出');
    console.log('  --from-backup <a.json> [b.json ...] 合并/过滤已有备份');
    console.log(`  --modules ${BACKUP_MODULES.join(',')}|all`);
    return;
  }

  const modulesArg = argValue('--modules');
  const pickModules = (available) => {
    if (modulesArg === undefined || modulesArg === 'all') return [...available];
    return modulesArg
      .split(',')
      .map((item) => item.trim())
      .filter((item) => available.includes(item));
  };

  if (args.includes('--list')) {
    console.log('已知数据位置：');
    for (const file of knownLocations()) console.log(`  ${describe(file)}`);
    const extra = argValue('--scan');
    if (extra !== undefined) {
      console.log(`扫描 ${extra}：`);
      const found = scan(extra);
      if (found.length === 0) console.log('  （未找到 dawn-tick.db）');
      for (const file of found) console.log(`  ${describe(file)}`);
    }
    return;
  }

  const backupIndex = args.indexOf('--from-backup');
  if (backupIndex >= 0) {
    const files = [];
    const valueFlags = new Set(['--db', '--out', '--scan', '--modules', '--from-backup']);
    for (let index = backupIndex + 1; index < args.length; index += 1) {
      const item = args[index];
      if (item.startsWith('--')) {
        if (valueFlags.has(item)) index += 1;
        continue;
      }
      files.push(item);
    }
    if (files.length === 0) {
      console.error('--from-backup 后面要给至少一个备份 json');
      process.exitCode = 1;
      return;
    }
    const modules = pickModules([...BACKUP_MODULES]);
    if (modules.length === 0) {
      console.error(`--modules 只接受：${BACKUP_MODULES.join(',')} 或 all`);
      process.exitCode = 1;
      return;
    }
    const merged = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), stores: {}, meta: {}, modules };
    const counts = new Map();
    for (const file of files) {
      if (!existsSync(file)) {
        console.error(`备份不存在：${file}`);
        process.exitCode = 1;
        return;
      }
      const payload = JSON.parse(readFileSync(file, 'utf8'));
      if (payload.format !== BACKUP_FORMAT) {
        console.error(`不是晓刻备份：${file}`);
        process.exitCode = 1;
        return;
      }
      for (const store of moduleStores(modules)) {
        const rows = payload.stores?.[store];
        if (!Array.isArray(rows)) continue;
        const key = STORE_KEYS[store];
        const bucket = new Map((merged.stores[store] ?? []).map((row) => [String(row[key]), row]));
        for (const row of rows) bucket.set(String(row[key]), row);
        merged.stores[store] = [...bucket.values()];
        counts.set(store, (counts.get(store) ?? 0) + rows.length);
      }
      for (const [key, value] of Object.entries(payload.meta ?? {})) {
        if (typeof value === 'string') merged.meta[key] = value;
      }
    }
    const target = argValue('--out') ?? `dawn-tick-backup-merged-${new Date().toISOString().slice(0, 10)}.json`;
    await writeFile(target, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`来源：${files.join('、')}`);
    console.log(`已导出：${target}`);
    console.log(summarizeBackup(merged));
    return;
  }

  const explicit = argValue('--db');
  let source = explicit;
  if (source === undefined) {
    const directory = argValue('--scan');
    if (directory !== undefined) {
      const found = scan(directory);
      if (found.length === 0) {
        console.error(`在 ${directory} 下没有找到 dawn-tick.db`);
        process.exitCode = 1;
        return;
      }
      source = found[0];
      console.log(`使用找到的数据库：${source}`);
    }
  }
  if (source === undefined) {
    console.error('请用 --db <路径> 指定数据库，或用 --scan <目录> 搜索');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(source)) {
    console.error(`数据库不存在：${source}`);
    process.exitCode = 1;
    return;
  }

  const modules = pickModules([...BACKUP_MODULES]);
  if (modules.length === 0) {
    console.error(`--modules 只接受：${BACKUP_MODULES.join(',')} 或 all`);
    process.exitCode = 1;
    return;
  }

  const storage = sqliteStorage(openNodeSqlite(source));
  try {
    const payload = await exportBackup(storage, { modules });
    const target =
      argValue('--out') ?? path.join(path.dirname(source), `dawn-tick-backup-${new Date().toISOString().slice(0, 10)}.json`);
    await writeFile(target, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`来源：${source}`);
    console.log(`已导出：${target}`);
    console.log(summarizeBackup(payload));
  } finally {
    await storage.close();
  }
}

await run();
