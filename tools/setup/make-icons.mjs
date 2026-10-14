import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT_DIR = process.argv[2] ?? 'apps/desktop/src-tauri/icons';

/** 生成纯色圆角方块图标：主色取自 docs/06 的青春活力主题。 */
function pixel(x, y, size) {
  const cx = x - (size - 1) / 2;
  const cy = y - (size - 1) / 2;
  const radius = size / 2 - 1;
  const distance = Math.sqrt(cx * cx + cy * cy);
  if (distance > radius) return [0, 0, 0, 0];
  const t = y / size;
  const from = [255, 107, 74];
  const to = [108, 92, 231];
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
    255,
  ];
}

function icoImage(size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, size - 1 - y, size);
      const offset = (y * size + x) * 4;
      xor[offset] = b;
      xor[offset + 1] = g;
      xor[offset + 2] = r;
      xor[offset + 3] = a;
    }
  }
  const andMask = Buffer.alloc((size * size) / 8);
  return Buffer.concat([header, xor, andMask]);
}

function buildIco(size) {
  const image = icoImage(size);
  const directory = Buffer.alloc(6 + 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(1, 4);
  directory.writeUInt8(size === 256 ? 0 : size, 6);
  directory.writeUInt8(size === 256 ? 0 : size, 7);
  directory.writeUInt8(0, 8);
  directory.writeUInt8(0, 9);
  directory.writeUInt16LE(1, 10);
  directory.writeUInt16LE(32, 12);
  directory.writeUInt32LE(image.length, 14);
  directory.writeUInt32LE(22, 18);
  return Buffer.concat([directory, image]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function buildPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y, size);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(OUT_DIR, '..'), { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ['icon.ico', buildIco(32)],
  ['32x32.png', buildPng(32)],
  ['128x128.png', buildPng(128)],
  ['128x128@2x.png', buildPng(256)],
  ['icon.png', buildPng(512)],
];
for (const [name, data] of files) {
  const target = join(OUT_DIR, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  console.log(`${name} ${data.length} bytes`);
}
