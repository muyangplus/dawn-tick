import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipStore } from '../src/zip.ts';

const encoder = new TextEncoder();

function readU32(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

function readU16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}

interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  method: number;
}

/** 按本地文件头逐条取出 store 模式的条目；用于验证自己产出的包。 */
function parseStoreZip(bytes: Uint8Array): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let at = 0;
  while (readU32(bytes, at) === 0x04034b50) {
    const method = readU16(bytes, at + 8);
    const crc = readU32(bytes, at + 14);
    const size = readU32(bytes, at + 18);
    const nameLength = readU16(bytes, at + 26);
    const extraLength = readU16(bytes, at + 28);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    entries.push({ name, data: bytes.subarray(start, start + size), crc, method });
    at = start + size;
  }
  return entries;
}

test('crc32 与标准值一致', () => {
  assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(encoder.encode('a')), 0xe8b7be43);
});

test('打包后能按本地文件头逐条读回', () => {
  const backup = encoder.encode('{"format":"dawn-tick-backup"}');
  const log = encoder.encode('2026-10-14 12:00:00.000 +08:00 [info] 启动');
  const bytes = zipStore([
    { name: 'backup.json', data: backup },
    { name: 'logs/dawn-tick.log', data: log },
  ]);

  const entries = parseStoreZip(bytes);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['backup.json', 'logs/dawn-tick.log'],
  );
  assert.deepEqual(entries[0]?.data, backup);
  assert.deepEqual(entries[1]?.data, log);
  assert.equal(entries[0]?.method, 0, '默认不压缩');
  assert.equal(entries[0]?.crc, crc32(backup));
  assert.equal(entries[1]?.crc, crc32(log));

  // 结尾中央目录：条目数、目录偏移与大小对得上
  const eocdAt = bytes.length - 22;
  assert.equal(readU32(bytes, eocdAt), 0x06054b50);
  assert.equal(readU16(bytes, eocdAt + 8), 2);
  assert.equal(readU16(bytes, eocdAt + 10), 2);
  assert.equal(readU32(bytes, eocdAt + 16), bytes.length - 22 - readU32(bytes, eocdAt + 12));
});

test('同样内容产出同样字节，给了时间戳才变', () => {
  const entry = [{ name: 'a.txt', data: encoder.encode('a') }];
  assert.deepEqual(zipStore(entry), zipStore(entry));
  assert.notDeepEqual(zipStore(entry, { date: new Date(2026, 9, 14, 12, 0, 0) }), zipStore(entry));
});

test('中文文件名按 UTF-8 写入并标记', () => {
  const bytes = zipStore([{ name: '日志/dawn-tick.log', data: encoder.encode('x') }]);
  assert.equal(readU16(bytes, 6) & 0x0800, 0x0800, '通用位标记第 11 位应置位');
  assert.equal(parseStoreZip(bytes)[0]?.name, '日志/dawn-tick.log');
});

test('空包只有结尾记录', () => {
  const bytes = zipStore([]);
  assert.equal(bytes.length, 22);
  assert.equal(readU32(bytes, 0), 0x06054b50);
});
