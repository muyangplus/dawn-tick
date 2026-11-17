/**
 * 最小 PNG 编码器（RGB 8bit、filter 0、zlib/Flate）。
 *
 * 课表图片导出先用 Canvas 2D 画图，再从这里把 RGBA 像素编码成 PNG：
 * - 不引第三方库，pngChunk / CRC32 / zlib 都在本文件内实现；
 * - 优先用 `CompressionStream('deflate')`（浏览器与 Node 24 都有），
 *   没有时退回 stored deflate，输出仍是合法 zlib；
 * - 输出恒为 RGB（无 alpha），透明通道按不透明处理，便于直接嵌入 PDF 图像 XObject。
 */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (ch) => ch.charCodeAt(0));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(asciiBytes(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib 兜底：stored deflate（BTYPE=00）分块，附 Adler-32。 */
function storedDeflate(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  do {
    const size = Math.min(65535, raw.length - offset);
    const final = offset + size >= raw.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = final;
    header[1] = size & 0xff;
    header[2] = (size >>> 8) & 0xff;
    header[3] = ~size & 0xff;
    header[4] = (~size >>> 8) & 0xff;
    blocks.push(header, raw.subarray(offset, offset + size));
    offset += size;
    if (final === 1) break;
  } while (offset < raw.length);
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  blocks.push(new Uint8Array([(b >>> 8) & 0xff, b & 0xff, (a >>> 8) & 0xff, a & 0xff]));
  return concatBytes(blocks);
}

async function deflateZlib(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'function') return storedDeflate(raw);
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** RGBA 像素 → RGB PNG 字节；尺寸与像素长度不合法时抛可读原因。 */
export async function encodePngRgb(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`PNG 尺寸无效：${width}×${height}`);
  }
  if (rgba.length < width * height * 4) throw new Error('PNG 像素数据长度不足');
  const rowLength = width * 3;
  const raw = new Uint8Array((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const source = y * width * 4;
    const target = y * (rowLength + 1);
    for (let x = 0; x < width; x += 1) {
      const from = source + x * 4;
      const to = target + 1 + x * 3;
      raw[to] = rgba[from] as number;
      raw[to + 1] = rgba[from + 1] as number;
      raw[to + 2] = rgba[from + 2] as number;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', await deflateZlib(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}
