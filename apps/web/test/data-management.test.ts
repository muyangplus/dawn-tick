import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, zipStore, exportBackup, MemoryStorage, readSettings, writeSettings } from '@dawn-tick/core';
import {
  exportFileName,
  importConfig,
  importResultText,
  parseImportText,
  presentModules,
  readImportFile,
} from '../src/data-management.ts';
import { readZipEntries } from '../src/zip-read.ts';

function createStorage(): MemoryStorage {
  return new MemoryStorage();
}

const BACKUP_JSON = JSON.stringify({
  format: 'dawn-tick-backup',
  version: 1,
  exportedAt: 1,
  stores: {
    courses: [
      {
        id: 'c-1',
        semester_id: 's-1',
        name: '高等数学',
        short_name: null,
        teacher: null,
        location: null,
        color: '#4F8DFD',
        credits: 4,
        note: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
        rev: 0,
        dirty: 0,
      },
    ],
  },
  meta: { theme: 'dark' },
});

/** 手工拼一个 deflate 压缩的 zip，验证第三方工具产出的包也能读。 */
function deflatedZip(name: string, text: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const raw = new TextEncoder().encode(text);
  const packed = new Uint8Array(deflateRawSync(raw));
  const crc = crc32(raw);
  const local = new Uint8Array(30 + nameBytes.length + packed.length);
  const view = new DataView(local.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(8, 8, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, packed.length, true);
  view.setUint32(22, raw.length, true);
  view.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(packed, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const cview = new DataView(central.buffer);
  cview.setUint32(0, 0x02014b50, true);
  cview.setUint16(4, 20, true);
  cview.setUint16(6, 20, true);
  cview.setUint16(10, 8, true);
  cview.setUint32(16, crc, true);
  cview.setUint32(20, packed.length, true);
  cview.setUint32(24, raw.length, true);
  cview.setUint16(28, nameBytes.length, true);
  cview.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const eview = new DataView(eocd.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(8, 1, true);
  eview.setUint16(10, 1, true);
  eview.setUint32(12, central.length, true);
  eview.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return out;
}

test('整包 zip 能读回备份正文', async () => {
  const bytes = zipStore([
    { name: 'backup.json', data: new TextEncoder().encode(BACKUP_JSON) },
    { name: 'logs/dawn-tick.log', data: new TextEncoder().encode('一行日志') },
  ]);
  const entries = await readZipEntries(bytes);
  assert.deepEqual([...entries.keys()], ['backup.json', 'logs/dawn-tick.log']);
  assert.equal(new TextDecoder().decode(entries.get('backup.json')), BACKUP_JSON);
});

test('第三方 deflate 压缩的包也能读', async () => {
  const bytes = deflatedZip('backup.json', BACKUP_JSON);
  const entries = await readZipEntries(bytes);
  assert.deepEqual([...entries.keys()], ['backup.json']);
  assert.equal(new TextDecoder().decode(entries.get('backup.json')), BACKUP_JSON);
});

test('校验和不一致时报错', async () => {
  const bytes = zipStore([{ name: 'backup.json', data: new TextEncoder().encode(BACKUP_JSON) }]);
  // 本地头 30 字节 + 文件名 11 字节之后就是正文
  bytes[45] = bytes[45]! ^ 0xff;
  await assert.rejects(() => readZipEntries(bytes), /校验和不一致/);
});

test('不是 zip 时给出可读提示', async () => {
  await assert.rejects(() => readZipEntries(new TextEncoder().encode('{"a":1}')), /不是 ZIP 文件/);
});

test('粘贴文本接受 JSON 与 Base64', () => {
  assert.equal(parseImportText(BACKUP_JSON).format, 'dawn-tick-backup');
  const base64 = Buffer.from(BACKUP_JSON, 'utf8').toString('base64');
  assert.equal(parseImportText(base64).format, 'dawn-tick-backup');
  assert.throws(() => parseImportText('   '), /内容为空/);
  assert.throws(() => parseImportText('%%%'), /Base64/);
});

test('选入的备份文件按后缀分流', async () => {
  const jsonFile = new File([BACKUP_JSON], 'DawnTick-backup.json', { type: 'application/json' });
  const fromJson = await readImportFile(jsonFile);
  assert.equal(fromJson.payload?.format, 'dawn-tick-backup');
  assert.equal(fromJson.error, null);

  const zipFile = new File(
    [zipStore([{ name: 'backup.json', data: new TextEncoder().encode(BACKUP_JSON) }])],
    'DawnTick-backup.zip',
    { type: 'application/zip' },
  );
  const fromZip = await readImportFile(zipFile);
  assert.equal(fromZip.payload?.format, 'dawn-tick-backup');
  assert.equal(fromZip.error, null);

  const broken = new File([new Uint8Array([1, 2, 3])], 'DawnTick-backup.zip');
  const failed = await readImportFile(broken);
  assert.equal(failed.payload, null);
  assert.match(failed.error ?? '', /ZIP/);
});

test('导入模式文案与结果一致', async () => {
  const payload = parseImportText(BACKUP_JSON);
  assert.deepEqual(presentModules(payload), ['courses', 'settings']);
  const storage = createStorage();
  const result = await importConfig(storage, payload, { modules: ['courses'], mode: 'clear' });
  assert.equal(result.imported, 1);
  assert.match(importResultText(result, 'clear'), /先清空所选模块/);
  assert.match(importResultText({ imported: 2, skipped: 1, removed: 3, warnings: [] }, 'merge'), /合并：写入 2 条，跳过 1 条，清空 3 条/);
});

test('导出文件名按格式与日期', () => {
  const now = Date.UTC(2026, 9, 14, 4, 0, 0);
  assert.match(exportFileName('json', now), /^DawnTick-backup-2026-10-14\.json$/);
  assert.match(exportFileName('base64', now), /\.base64\.txt$/);
  assert.match(exportFileName('zip', now), /\.zip$/);
});

test('导出的设置能导入回来', async () => {
  const storage = createStorage();
  await writeSettings(storage, { theme: 'dark', themePreset: 'mono' });
  const payload = await exportBackup(storage, { modules: ['settings'] });
  const target = createStorage();
  const result = await importConfig(target, parseImportText(JSON.stringify(payload)), {
    modules: ['settings'],
    mode: 'overwrite',
  });
  assert.equal(result.imported, Object.keys(payload.meta).length);
  assert.equal((await readSettings(target)).themePreset, 'mono');
});
