import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, zipStore, exportBackup, MemoryStorage, readSettings, writeSettings } from '@dawn-tick/core';
import {
  exportConfig,
  exportFileName,
  importConfig,
  importPastedText,
  importResultText,
  parseImportText,
  presentModules,
  readImportFile,
} from '../src/data-management.ts';
import {
  decryptBackup,
  encryptBackup,
  encryptBackupBytes,
  isEncryptedBackup,
} from '../src/lib/backup-crypto.ts';
import { readZipEntries } from '../src/zip-read.ts';
import { buildPackageBytes, readPresetExtras } from '../src/package.ts';

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
  // 加密文本用 .txt，zip 仍是 .zip；内容由信封标记自描述
  assert.match(exportFileName('json', now, true), /\.enc\.txt$/);
  assert.match(exportFileName('base64', now, true), /\.base64\.txt$/);
  assert.match(exportFileName('zip', now, true), /\.zip$/);
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

test('整包导入恢复预设且不覆盖日志', async () => {
  const source = createStorage();
  await writeSettings(source, { theme: 'dark' });
  await source.writeMeta('presets_snapshot_v1', '{"version":"2026.10.1"}');
  await source.writeMeta('presets_content_v1', '{"schools":[]}');
  const payload = await exportBackup(source);
  const presets = await readPresetExtras(source);
  const bytes = buildPackageBytes({
    backupJson: JSON.stringify(payload, null, 2),
    presets,
    logs: '本机日志',
    now: 1,
  });
  const file = new File([bytes], 'DawnTick-backup.zip');
  const read = await readImportFile(file);
  assert.ok(read.payload);
  assert.deepEqual(read.extras?.presets, presets);
  assert.equal(read.extras?.logs, '本机日志');

  const target = createStorage();
  const result = await importConfig(target, read.payload!, {
    modules: ['settings'],
    mode: 'overwrite',
    extras: read.extras,
  });
  assert.equal(result.presets, true);
  assert.equal(result.logsSkipped, true);
  assert.equal(await target.readMeta('presets_snapshot_v1'), '{"version":"2026.10.1"}');
  assert.equal(await target.readMeta('presets_content_v1'), '{"schools":[]}');
  assert.match(importResultText(result, 'overwrite'), /已恢复预设/);
  assert.match(importResultText(result, 'overwrite'), /日志未覆盖/);
});

test('没带预设的整包导入不改本机预设', async () => {
  const payload = await exportBackup(createStorage());
  const bytes = buildPackageBytes({ backupJson: JSON.stringify(payload), now: 1 });
  const file = new File([bytes], 'DawnTick-backup.zip');
  const read = await readImportFile(file);
  const target = createStorage();
  await target.writeMeta('presets_snapshot_v1', 'keep-me');
  const result = await importConfig(target, read.payload!, {
    modules: ['settings'],
    mode: 'overwrite',
    extras: read.extras,
  });
  assert.equal(result.presets, false);
  assert.equal(result.logsSkipped, false);
  assert.equal(await target.readMeta('presets_snapshot_v1'), 'keep-me');
});

const EXPORT_PASSWORD = 'data-mgmt-pass-8';

test('明文导出仍是 Base64 文本，导入不需要口令', async () => {
  const source = createStorage();
  await writeSettings(source, { theme: 'dark' });
  const outcome = await exportConfig(source, {
    modules: ['settings'],
    format: 'base64',
    bundlePresets: false,
    bundleLogs: false,
    now: 1,
  });
  assert.equal(outcome.ok, true);
  assert.equal(isEncryptedBackup(outcome.text!), false);
  const imported = await importPastedText(outcome.text!);
  assert.equal(imported.locked, false);
  assert.equal(imported.payload?.format, 'dawn-tick-backup');
});

test('加密 Base64 导出需要口令，错口令可读、对口令能导入', async () => {
  const source = createStorage();
  await writeSettings(source, { theme: 'dark', themePreset: 'mono' });
  const outcome = await exportConfig(source, {
    modules: ['settings'],
    format: 'base64',
    bundlePresets: false,
    bundleLogs: false,
    password: EXPORT_PASSWORD,
    now: 1,
  });
  assert.equal(outcome.ok, true);
  assert.ok(outcome.text !== null);
  assert.equal(isEncryptedBackup(outcome.text!), true);
  assert.equal(outcome.text!.startsWith('DAWNTICK-ENC 1 '), true);

  const locked = await importPastedText(outcome.text!);
  assert.equal(locked.locked, true);
  assert.equal(locked.payload, null);

  const wrong = await importPastedText(outcome.text!, 'wrong-pass-8');
  assert.equal(wrong.locked, false);
  assert.equal(wrong.payload, null);
  assert.match(wrong.error ?? '', /口令错误|损坏/);

  const ready = await importPastedText(outcome.text!, EXPORT_PASSWORD);
  assert.equal(ready.locked, false);
  assert.equal(ready.payload?.format, 'dawn-tick-backup');
  const target = createStorage();
  await importConfig(target, ready.payload!, { modules: ['settings'], mode: 'overwrite' });
  assert.equal((await readSettings(target)).themePreset, 'mono');
});

test('加密 JSON 备份文件先返回待解锁，口令正确后再解析', async () => {
  const text = await encryptBackup(BACKUP_JSON, EXPORT_PASSWORD);
  const file = new File([text], 'DawnTick-backup.json', { type: 'application/json' });
  const locked = await readImportFile(file);
  assert.equal(locked.locked, true);
  assert.equal(locked.payload, null);

  const wrong = await readImportFile(file, 'wrong-pass-8');
  assert.equal(wrong.payload, null);
  assert.match(wrong.error ?? '', /口令错误|损坏/);

  const ready = await readImportFile(file, EXPORT_PASSWORD);
  assert.equal(ready.payload?.format, 'dawn-tick-backup');
  assert.equal(ready.error, null);
});

test('加密整包 zip 解密后仍带出预设与日志', async () => {
  const source = createStorage();
  await writeSettings(source, { theme: 'dark' });
  await source.writeMeta('presets_snapshot_v1', '{"version":"2026.10.1"}');
  const payload = await exportBackup(source);
  const presets = await readPresetExtras(source);
  const plain = buildPackageBytes({
    backupJson: JSON.stringify(payload, null, 2),
    presets,
    logs: '本机日志',
    now: 1,
  });
  const sealed = await encryptBackupBytes(plain, EXPORT_PASSWORD);
  // zip 文件内容整个是加密信封，导入侧按字节标记识别
  assert.equal(isEncryptedBackup(new TextDecoder().decode(sealed)), true);
  const file = new File([sealed], 'DawnTick-backup.zip', { type: 'application/zip' });

  const locked = await readImportFile(file);
  assert.equal(locked.locked, true);
  const wrong = await readImportFile(file, 'wrong-pass-8');
  assert.match(wrong.error ?? '', /口令错误|损坏/);

  const ready = await readImportFile(file, EXPORT_PASSWORD);
  assert.ok(ready.payload);
  assert.deepEqual(ready.extras?.presets, presets);
  assert.equal(ready.extras?.logs, '本机日志');
  assert.equal(ready.locked, false);
});

test('加密信封文本可用 decryptBackup 还原成原备份 JSON', async () => {
  const text = await encryptBackup(BACKUP_JSON, EXPORT_PASSWORD);
  assert.equal(await decryptBackup(text, EXPORT_PASSWORD), BACKUP_JSON);
});

test('加密口令不合格时导出返回可读错误而不是抛异常', async () => {
  const outcome = await exportConfig(createStorage(), {
    modules: ['settings'],
    format: 'base64',
    bundlePresets: false,
    bundleLogs: false,
    password: 'short',
    now: 1,
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /至少 8 位/);
  assert.equal(outcome.text, null);
});
