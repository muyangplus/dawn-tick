/** 最小 ZIP 写入：只用 store（不压缩），给「整包导出」用。 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS 时间戳：不传时用固定的 1980-01-01 00:00，保证同样内容产出同样字节。 */
function dosStamp(date: Date | undefined): { time: number; date: number } {
  if (date === undefined) return { time: 0, date: 0x21 };
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class Writer {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  text(value: string): void {
    this.push(new TextEncoder().encode(value));
  }

  get offset(): number {
    return this.size;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/**
 * 打成 ZIP：ZIP64 未使用，单个条目与总大小需小于 4 GiB。
 * 文件名按 UTF-8 写入（通用位标记第 11 位置位），压缩方法固定 store。
 */
export function zipStore(entries: readonly ZipEntry[], options: { date?: Date } = {}): Uint8Array {
  const stamp = dosStamp(options.date);
  const body = new Writer();
  const directory = new Writer();

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const at = body.offset;

    body.u32(0x04034b50);
    body.u16(20);
    body.u16(0x0800);
    body.u16(0);
    body.u16(stamp.time);
    body.u16(stamp.date);
    body.u32(crc);
    body.u32(entry.data.length);
    body.u32(entry.data.length);
    body.u16(name.length);
    body.u16(0);
    body.push(name);
    body.push(entry.data);

    directory.u32(0x02014b50);
    directory.u16(20);
    directory.u16(20);
    directory.u16(0x0800);
    directory.u16(0);
    directory.u16(stamp.time);
    directory.u16(stamp.date);
    directory.u32(crc);
    directory.u32(entry.data.length);
    directory.u32(entry.data.length);
    directory.u16(name.length);
    directory.u16(0);
    directory.u16(0);
    directory.u16(0);
    directory.u16(0);
    directory.u32(0);
    directory.u32(at);
    directory.push(name);
  }

  const directoryBytes = directory.bytes();
  const tail = new Writer();
  tail.u32(0x06054b50);
  tail.u16(0);
  tail.u16(0);
  tail.u16(entries.length);
  tail.u16(entries.length);
  tail.u32(directoryBytes.length);
  tail.u32(body.offset);
  tail.u16(0);

  const out = new Writer();
  out.push(body.bytes());
  out.push(directoryBytes);
  out.push(tail.bytes());
  return out.bytes();
}
