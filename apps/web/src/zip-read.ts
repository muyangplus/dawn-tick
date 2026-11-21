import { crc32 } from '@dawn-tick/core';
import { appBackupCopy } from './copy/app-backup.ts';

/** ZIP 读取：store 直接取，deflate 用 DecompressionStream 解压；ZIP64 不支持。 */

interface EntryMeta {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
  );
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const lowest = Math.max(0, bytes.length - 65557);
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (u32(bytes, at) === EOCD_SIGNATURE) return at;
  }
  throw new Error(appBackupCopy.zip.notZip);
}

function readCentralDirectory(bytes: Uint8Array): EntryMeta[] {
  const eocd = findEndOfCentralDirectory(bytes);
  const count = u16(bytes, eocd + 10);
  let at = u32(bytes, eocd + 16);
  const entries: EntryMeta[] = [];
  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, at) !== CENTRAL_SIGNATURE) throw new Error(appBackupCopy.zip.centralDirectoryCorrupt);
    const method = u16(bytes, at + 10);
    const crc = u32(bytes, at + 16);
    const compressedSize = u32(bytes, at + 20);
    const uncompressedSize = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localOffset = u32(bytes, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(appBackupCopy.zip.zip64Unsupported);
    }
    entries.push({ name, method, crc, compressedSize, uncompressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error(appBackupCopy.zip.deflateUnsupported);
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  await writer.write(new Uint8Array(data));
  await writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

function readEntry(bytes: Uint8Array, entry: EntryMeta): Uint8Array {
  if (u32(bytes, entry.localOffset) !== LOCAL_SIGNATURE) throw new Error(appBackupCopy.zip.localHeaderCorrupt(entry.name));
  const nameLength = u16(bytes, entry.localOffset + 26);
  const extraLength = u16(bytes, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  return bytes.subarray(start, start + entry.compressedSize);
}

/** 读出全部条目；名字按包内路径，值为解压后的字节。 */
export async function readZipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const entry of readCentralDirectory(bytes)) {
    if (entry.name.endsWith('/')) continue;
    const raw = readEntry(bytes, entry);
    let data: Uint8Array;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8) data = await inflateRaw(raw);
    else throw new Error(appBackupCopy.zip.methodUnsupported(entry.name, entry.method));
    if (crc32(data) !== entry.crc) throw new Error(appBackupCopy.zip.crcMismatch(entry.name));
    out.set(entry.name, data);
  }
  return out;
}

/** 从整包里挑出备份正文：优先 backup.json。 */
export function pickBackupText(entries: Map<string, Uint8Array>): string | null {
  const direct = entries.get('backup.json');
  if (direct !== undefined) return new TextDecoder().decode(direct);
  for (const [name, data] of entries) {
    if (name.endsWith('.json')) return new TextDecoder().decode(data);
  }
  return null;
}
