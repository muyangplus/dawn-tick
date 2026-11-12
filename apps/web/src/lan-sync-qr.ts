/**
 * 局域网同步：配对信息二维码。
 *
 * 边界：
 * - 只做「生成矩阵」，不引相机 / 扫码 / 第三方二维码依赖；界面用 SVG 渲染；
 * - 字节模式、纠错等级 M、版本 1–10（最多 213 字节，够标准配对链接 + 稳定 deviceId）；
 * - 版本 7+ 需要版本信息区，本实现按 QR 规范绘制；配对链接超长时给出可读错误，
 *   界面仍显示人类可读文本；
 * - 纯函数，`apps/web/test/lan-sync-qr.test.ts` 覆盖尺寸、定位 / 版本图案、确定性与超长报错。
 */

const EC_LEVEL_M = 0;
const MAX_VERSION = 10;

interface QrVersion {
  /** 模块边长：17 + 4 × 版本号 */
  size: number;
  /** 对齐图案中心（0-based 模块坐标） */
  align: number[];
  /** 每个 RS 分块的数据码字数；块数可能不等长（版本 8–10） */
  dataBlocks: number[];
  /** 每个 RS 分块的纠错码字数 */
  eccPerBlock: number;
}

/**
 * 版本表：只收 M 级、1–10；数字来自 QR 规范 Table 9（RS 分块）。
 * 版本 1–6 的分块等长，7+ 后开始出现短块，`dataBlocks` 按规范逐块列出。
 */
const VERSIONS: Record<number, QrVersion> = {
  1: { size: 21, align: [], dataBlocks: [16], eccPerBlock: 10 },
  2: { size: 25, align: [6, 18], dataBlocks: [28], eccPerBlock: 16 },
  3: { size: 29, align: [6, 22], dataBlocks: [44], eccPerBlock: 26 },
  4: { size: 33, align: [6, 26], dataBlocks: [32, 32], eccPerBlock: 18 },
  5: { size: 37, align: [6, 30], dataBlocks: [43, 43], eccPerBlock: 24 },
  6: { size: 41, align: [6, 34], dataBlocks: [27, 27, 27, 27], eccPerBlock: 16 },
  7: { size: 45, align: [6, 22, 38], dataBlocks: [31, 31, 31, 31], eccPerBlock: 18 },
  8: { size: 49, align: [6, 24, 42], dataBlocks: [38, 38, 39, 39], eccPerBlock: 22 },
  9: { size: 53, align: [6, 26, 46], dataBlocks: [36, 36, 36, 37, 37], eccPerBlock: 22 },
  10: { size: 57, align: [6, 28, 50], dataBlocks: [43, 43, 43, 43, 44], eccPerBlock: 26 },
};

/** 字节模式的字符计数位宽：版本 1–9 为 8 位，10–26 为 16 位。 */
function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

const MODE_BYTE = 0b0100;

const EXP = new Array<number>(512).fill(0);
const LOG = new Array<number>(256).fill(0);
{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255]!;
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return EXP[LOG[left]! + LOG[right]!]!;
}

/** Reed–Solomon 生成多项式（不含首项 1 的系数），长度为 degree。 */
function rsDivisor(degree: number): number[] {
  let result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let position = 0; position < degree; position += 1) {
      result[position] = gfMultiply(result[position]!, root);
      if (position + 1 < degree) result[position] = result[position]! ^ result[position + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = [...data, ...new Array<number>(divisor.length).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = result[index]!;
    if (factor === 0) continue;
    for (let position = 0; position < divisor.length; position += 1) {
      result[index + 1 + position] =
        result[index + 1 + position]! ^ gfMultiply(divisor[position]!, factor);
    }
  }
  return result.slice(data.length);
}

/** 格式信息：5 位数据 + 10 位 BCH，再异或掩码 0x5412；M 级编码为 00。 */
function formatBits(mask: number): number {
  const data = (EC_LEVEL_M << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

/** 版本信息：6 位版本号 + 12 位 BCH(18,6)，生成多项式 0x1F25；版本 7+ 才需要。 */
function versionBits(version: number): number {
  let remainder = version << 12;
  for (let index = 17; index >= 12; index -= 1) {
    if (((remainder >>> index) & 1) === 1) remainder ^= 0x1f25 << (index - 12);
  }
  return (version << 12) | (remainder & 0xfff);
}

function dataCodewords(info: QrVersion): number {
  return info.dataBlocks.reduce((total, count) => total + count, 0);
}

function byteCapacity(version: number, info: QrVersion): number {
  const bits = dataCodewords(info) * 8;
  return Math.floor((bits - 4 - charCountBits(version)) / 8);
}

function chooseVersion(length: number): { version: number; info: QrVersion } {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const info = VERSIONS[version]!;
    if (length <= byteCapacity(version, info)) return { version, info };
  }
  const limit = byteCapacity(MAX_VERSION, VERSIONS[MAX_VERSION]!);
  throw new Error(`二维码内容过长（${length} 字节，最多 ${limit} 字节）`);
}

function utf8Bytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/** 数据码字 → 分块 → 纠错 → 交织；返回最终码字位流。 */
function buildCodewords(text: string, version: number, info: QrVersion): number[] {
  const bytes = utf8Bytes(text);
  const totalData = dataCodewords(info);
  const capacityBits = totalData * 8;
  const bits: number[] = [];
  const append = (value: number, width: number): void => {
    for (let index = width - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
  };
  append(MODE_BYTE, 4);
  append(bytes.length, charCountBits(version));
  for (const byte of bytes) append(byte, 8);
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let index = 0; index < terminator; index += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) byte = (byte << 1) | bits[index + offset]!;
    data.push(byte);
  }
  for (let pad = 0; data.length < totalData; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  const divisor = rsDivisor(info.eccPerBlock);
  const blocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (const blockLength of info.dataBlocks) {
    const chunk = data.slice(offset, offset + blockLength);
    offset += blockLength;
    blocks.push(chunk);
    eccBlocks.push(rsRemainder(chunk, divisor));
  }
  const codewords: number[] = [];
  const longestBlock = Math.max(...info.dataBlocks);
  for (let index = 0; index < longestBlock; index += 1) {
    for (const block of blocks) {
      if (index < block.length) codewords.push(block[index]!);
    }
  }
  for (let index = 0; index < info.eccPerBlock; index += 1) {
    for (const block of eccBlocks) codewords.push(block[index]!);
  }
  const output: number[] = [];
  for (const codeword of codewords) {
    for (let bit = 7; bit >= 0; bit -= 1) output.push((codeword >>> bit) & 1);
  }
  return output;
}

interface Canvas {
  modules: boolean[][];
  reserved: boolean[][];
  size: number;
}

function paint(canvas: Canvas, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  canvas.modules[y]![x] = dark;
  canvas.reserved[y]![x] = true;
}

function drawFinder(canvas: Canvas, left: number, top: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      paint(canvas, left + dx, top + dy, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(canvas: Canvas, centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      paint(canvas, centerX + dx, centerY + dy, distance !== 1);
    }
  }
}

/** 版本信息区：右上 3×6 与左下 6×3，两份内容相同（版本 1–6 没有这一区）。 */
function drawVersion(canvas: Canvas, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let index = 0; index < 18; index += 1) {
    const dark = ((bits >>> index) & 1) === 1;
    const offset = index % 3;
    const row = Math.floor(index / 3);
    paint(canvas, canvas.size - 11 + offset, row, dark);
    paint(canvas, row, canvas.size - 11 + offset, dark);
  }
}

function drawFunctionPatterns(canvas: Canvas, version: number, info: QrVersion): void {
  // 时序图案先铺满，定位图案随后覆盖（定位图案包含时序线上的格子）
  for (let index = 0; index < canvas.size; index += 1) {
    paint(canvas, 6, index, index % 2 === 0);
    paint(canvas, index, 6, index % 2 === 0);
  }
  drawFinder(canvas, 0, 0);
  drawFinder(canvas, canvas.size - 7, 0);
  drawFinder(canvas, 0, canvas.size - 7);
  for (const centerY of info.align) {
    for (const centerX of info.align) {
      const topLeft = centerX === 6 && centerY === 6;
      const topRight = centerX === 6 && centerY === canvas.size - 7;
      const bottomLeft = centerX === canvas.size - 7 && centerY === 6;
      if (!topLeft && !topRight && !bottomLeft) drawAlignment(canvas, centerX, centerY);
    }
  }
  // 深色模块
  paint(canvas, 8, canvas.size - 8, true);
  // 预留格式信息区：先清空并标记，数据不会写进来
  const reserve = (x: number, y: number): void => paint(canvas, x, y, false);
  for (let index = 0; index <= 5; index += 1) reserve(8, index);
  reserve(8, 7);
  reserve(8, 8);
  reserve(7, 8);
  for (let index = 9; index < 15; index += 1) reserve(14 - index, 8);
  for (let index = 0; index < 8; index += 1) reserve(canvas.size - 1 - index, 8);
  for (let index = 8; index < 15; index += 1) reserve(8, canvas.size - 15 + index);
  drawVersion(canvas, version);
}

/** 从右下角按 2 列一组折返填入数据位。 */
function drawData(canvas: Canvas, bits: readonly number[]): void {
  let index = 0;
  for (let right = canvas.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < canvas.size; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? canvas.size - 1 - vertical : vertical;
        if (canvas.reserved[y]![x]) continue;
        canvas.modules[y]![x] = (bits[index] ?? 0) === 1;
        index += 1;
      }
    }
  }
}

/** 掩码 0：(x + y) 偶数取反；与格式信息里的 mask 编号一致。 */
function applyMask(canvas: Canvas): void {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      if (canvas.reserved[y]![x]) continue;
      if ((x + y) % 2 === 0) canvas.modules[y]![x] = !canvas.modules[y]![x];
    }
  }
}

function drawFormat(canvas: Canvas, mask: number): void {
  const bits = formatBits(mask);
  const get = (index: number): boolean => ((bits >>> index) & 1) === 1;
  for (let index = 0; index <= 5; index += 1) paint(canvas, 8, index, get(index));
  paint(canvas, 8, 7, get(6));
  paint(canvas, 8, 8, get(7));
  paint(canvas, 7, 8, get(8));
  for (let index = 9; index < 15; index += 1) paint(canvas, 14 - index, 8, get(index));
  for (let index = 0; index < 8; index += 1) paint(canvas, canvas.size - 1 - index, 8, get(index));
  for (let index = 8; index < 15; index += 1) paint(canvas, 8, canvas.size - 15 + index, get(index));
  paint(canvas, 8, canvas.size - 8, true);
}

/** 生成二维码矩阵：`true` 为深色模块，行优先。 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = utf8Bytes(text);
  const { version, info } = chooseVersion(bytes.length);
  const canvas: Canvas = {
    size: info.size,
    modules: Array.from({ length: info.size }, () => new Array<boolean>(info.size).fill(false)),
    reserved: Array.from({ length: info.size }, () => new Array<boolean>(info.size).fill(false)),
  };
  drawFunctionPatterns(canvas, version, info);
  drawData(canvas, buildCodewords(text, version, info));
  applyMask(canvas);
  drawFormat(canvas, 0);
  return canvas.modules;
}

/** 扫描端看到的文本：`IP:端口 配对码`，可直接手输到另一端。 */
export function pairingQrText(host: string, port: number, code: string): string {
  return `${host}:${port} ${code}`;
}
