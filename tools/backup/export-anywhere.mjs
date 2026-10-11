#!/usr/bin/env node
// 从其他位置的数据导出备份：读取别处的 dawn-tick.db，生成可被应用导入的备份 JSON。
//
// 用法：
//   node tools/backup/export-anywhere.mjs --list
//   node tools/backup/export-anywhere.mjs --db "<数据库路径>" [--out "<输出文件>"] [--modules all|semesters,courses,events,reminders,settings]
//   node tools/backup/export-anywhere.mjs --scan "<目录>" [--out "<输出文件>"]

import { existsSync, statSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BACKUP_MODULES, exportBackup, summarizeBackup } from '../../packages/core/src/backup.ts';
import { sqliteStorage } from '../../packages/core/src/sqlite-storage.ts';
import { openNodeSqlite } from '../../packages/core/src/drivers/node-sqlite.ts';

const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function knownLocations() {
  const list = [];
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'com.dawntick.app', 'dawn-tick.db'));
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'DawnTick', 'dawn-tick.db'));
  list.push(path.resolve('out-local/DawnTick-data/dawn-tick.db'));
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
    console.log('用法：--list 查看已知位置；--db <路径> 导出；--scan <目录> 搜索后导出');
    return;
  }

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

  const modulesArg = argValue('--modules');
  const modules =
    modulesArg === undefined || modulesArg === 'all'
      ? [...BACKUP_MODULES]
      : modulesArg
          .split(',')
          .map((item) => item.trim())
          .filter((item) => BACKUP_MODULES.includes(item));
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
