/**
 * 最小 PDF 1.4 生成（单页、横向 A4、嵌入一张 PNG 图像 XObject）。
 *
 * 边界：
 * - 不引第三方库：按 PDF 对象表手写 xref/trailer，字节偏移逐个累加；
 * - 只接受本仓库导出的 RGB PNG（8bit、无透明通道）：PNG 的 IDAT 就是
 *   zlib 压缩的「filter 0 + RGB」扫描线，正好可作 `/FlateDecode` + PNG predictor 15 的图像流；
 * - 图像按等比缩放居中放进一页 A4 横向，不裁切；`width`/`height` 必须与 PNG IHDR 一致。
 */

const PDF_HEADER = '%PDF-1.4\n';
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 24;

export interface PdfImageSize {
  width: number;
  height: number;
}

interface PngInfo {
  width: number;
  height: number;
  colorType: number;
  idat: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPng(png: Uint8Array): PngInfo {
  if (png.length < 33) throw new Error('PNG 文件不完整');
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (png[index] !== PNG_SIGNATURE[index]) throw new Error('不是有效的 PNG 文件');
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idatParts: Uint8Array[] = [];
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      png[offset + 4] as number,
      png[offset + 5] as number,
      png[offset + 6] as number,
      png[offset + 7] as number,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error('PNG 数据块长度越界');
    if (type === 'IHDR') {
      if (length < 13) throw new Error('PNG 缺少有效的 IHDR');
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      const bitDepth = png[dataStart + 8] as number;
      colorType = png[dataStart + 9] as number;
      if (bitDepth !== 8) throw new Error(`暂不支持 ${bitDepth} 位深的 PNG`);
    } else if (type === 'IDAT') {
      idatParts.push(png.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (width <= 0 || height <= 0) throw new Error('PNG 缺少图像尺寸');
  if (idatParts.length === 0) throw new Error('PNG 缺少 IDAT 数据');
  const idat = new Uint8Array(idatParts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idatParts) {
    idat.set(part, cursor);
    cursor += part.length;
  }
  return { width, height, colorType, idat };
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function number(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * 由 PNG 生成单页 PDF 字节。`size` 为画布逻辑尺寸（像素），用于校验与页面等比缩放；
 * 真正的图像宽高以 PNG IHDR 为准。
 */
export function buildPdfFromPng(png: Uint8Array, size: PdfImageSize): Uint8Array {
  const info = readPng(png);
  if (info.width !== size.width || info.height !== size.height) {
    throw new Error(`PNG 尺寸与导出尺寸不一致（${info.width}×${info.height} ≠ ${size.width}×${size.height}）`);
  }
  if (info.colorType !== 2) {
    throw new Error('PDF 导出只支持无透明通道的 RGB PNG');
  }

  const scale = Math.min(
    (PAGE_WIDTH - MARGIN * 2) / info.width,
    (PAGE_HEIGHT - MARGIN * 2) / info.height,
  );
  const drawWidth = info.width * scale;
  const drawHeight = info.height * scale;
  const drawX = (PAGE_WIDTH - drawWidth) / 2;
  const drawY = (PAGE_HEIGHT - drawHeight) / 2;
  const content =
    `q\n${number(drawWidth)} 0 0 ${number(drawHeight)} ${number(drawX)} ${number(drawY)} cm\n/Im0 Do\nQ\n`;

  const imageDict =
    `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ` +
    `/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${info.width} >> ` +
    `/Length ${info.idat.length} >>`;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushText = (text: string): void => push(ascii(text));

  pushText(PDF_HEADER);
  offsets[1] = length;
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = length;
  pushText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  offsets[3] = length;
  pushText(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 4 0 R >>\nendobj\n',
  );
  offsets[4] = length;
  pushText(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  offsets[5] = length;
  pushText(`5 0 obj\n${imageDict}\nstream\n`);
  push(info.idat);
  pushText('\nendstream\nendobj\n');

  const xrefOffset = length;
  pushText('xref\n0 6\n0000000000 65535 f \n');
  for (let index = 1; index <= 5; index += 1) {
    pushText(`${String(offsets[index] as number).padStart(10, '0')} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/** PDF 页面固定为 A4 横向；导出时可在报告/文件名里引用。 */
export const PDF_PAGE = { width: PAGE_WIDTH, height: PAGE_HEIGHT, orientation: 'landscape' } as const;
