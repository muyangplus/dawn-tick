import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfFromPng, PDF_PAGE } from '../src/lib/pdf.ts';
import { encodePngRgb } from '../src/lib/png.ts';

const WIDTH = 4;
const HEIGHT = 3;

async function samplePng(): Promise<Uint8Array> {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 200;
    rgba[index + 1] = 120;
    rgba[index + 2] = 40;
    rgba[index + 3] = 255;
  }
  return encodePngRgb(rgba, WIDTH, HEIGHT);
}

function chunkData(png: Uint8Array, type: string): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const found = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (found === type) return png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  throw new Error(`PNG 缺少 ${type}`);
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

test('PDF 1.4 单页结构：目录、页树、页面与 A4 横向 MediaBox', async () => {
  const pdf = buildPdfFromPng(await samplePng(), { width: WIDTH, height: HEIGHT });
  const text = latin1(pdf);
  assert.ok(text.startsWith('%PDF-1.4\n'), '以 %PDF-1.4 开头');
  assert.ok(text.includes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>'));
  assert.ok(text.includes('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  assert.ok(
    text.includes('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595]'),
    '单页 A4 横向',
  );
  assert.equal(PDF_PAGE.orientation, 'landscape');
  assert.ok(text.trimEnd().endsWith('%%EOF'), '以 %%EOF 结束');
});

test('xref 偏移与 startxref 自洽，每个对象偏移都指向对象头', async () => {
  const pdf = buildPdfFromPng(await samplePng(), { width: WIDTH, height: HEIGHT });
  const text = latin1(pdf);
  const match = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  assert.ok(match !== null, '存在 startxref');
  const xrefOffset = Number(match[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');
  const lines = text.slice(xrefOffset).split('\n');
  assert.equal(lines[0], 'xref');
  assert.equal(lines[1], '0 6');
  assert.equal(lines[2], '0000000000 65535 f ');
  for (let index = 1; index <= 5; index += 1) {
    const entry = lines[2 + index] as string;
    assert.match(entry, /^\d{10} 00000 n $/);
    const offset = Number(entry.slice(0, 10));
    assert.equal(text.slice(offset, offset + `${index} 0 obj`.length), `${index} 0 obj`);
  }
});

test('图像 XObject 嵌入 PNG 的 IDAT：宽度、颜色、predictor 与流长度准确', async () => {
  const png = await samplePng();
  const idat = chunkData(png, 'IDAT');
  const pdf = buildPdfFromPng(png, { width: WIDTH, height: HEIGHT });
  const text = latin1(pdf);
  const imageAt = text.indexOf('/Subtype /Image');
  assert.ok(imageAt > 0, '存在 Image XObject');
  assert.ok(text.slice(imageAt, imageAt + 220).includes('/Width 4 /Height 3'), 'IHDR 尺寸写进字典');
  assert.ok(text.includes('/ColorSpace /DeviceRGB /BitsPerComponent 8'));
  assert.ok(text.includes('/Filter /FlateDecode'));
  assert.ok(text.includes('/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 4 >>'));

  const streamAt = text.indexOf('stream\n', imageAt) + 'stream\n'.length;
  const lengthMatch = /\/Length (\d+) >>\nstream\n/.exec(text.slice(imageAt, streamAt + 8));
  assert.ok(lengthMatch !== null);
  assert.equal(Number(lengthMatch[1]), idat.length, '/Length 等于 PNG IDAT 字节数');
  assert.deepEqual(pdf.subarray(streamAt, streamAt + idat.length), idat, '图像流字节与 IDAT 一致');
  assert.equal(text.slice(streamAt + idat.length, streamAt + idat.length + 10), '\nendstream');
});

test('页面内容流：等比缩放居中，内容长度与实际字节一致', async () => {
  const pdf = buildPdfFromPng(await samplePng(), { width: WIDTH, height: HEIGHT });
  const text = latin1(pdf);
  const objectAt = text.indexOf('4 0 obj');
  assert.ok(objectAt > 0);
  const contentStart = text.indexOf('stream\n', objectAt) + 'stream\n'.length;
  const lengthMatch = /<< \/Length (\d+) >>\nstream\n/.exec(text.slice(objectAt, contentStart));
  assert.ok(lengthMatch !== null);
  const length = Number(lengthMatch[1]);
  const content = text.slice(contentStart, contentStart + length);
  const draw = /q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\n\/Im0 Do\nQ\n$/.exec(content);
  assert.ok(draw !== null, `内容流为图像绘制：${content}`);
  const drawWidth = Number(draw[1]);
  const drawHeight = Number(draw[2]);
  const x = Number(draw[3]);
  const y = Number(draw[4]);
  assert.ok(drawWidth > 0 && drawHeight > 0 && x >= 0 && y >= 0);
  assert.ok(drawWidth <= 842 && drawHeight <= 595);
  // 4:3 的图放进 A4 横向：高度先触边，左右居中
  assert.ok(Math.abs(drawHeight - (595 - 48)) < 0.01);
  assert.ok(Math.abs(x + drawWidth / 2 - 421) < 0.01);
  assert.ok(Math.abs(y - 24) < 0.01);
});

test('非 PNG、尺寸不一致与带透明通道的 PNG 都给出可读原因', async () => {
  assert.throws(() => buildPdfFromPng(new Uint8Array([1, 2, 3]), { width: 1, height: 1 }), /PNG/);
  const png = await samplePng();
  assert.throws(() => buildPdfFromPng(png, { width: 8, height: 6 }), /尺寸/);
  const alpha = png.slice();
  alpha[25] = 6;
  assert.throws(() => buildPdfFromPng(alpha, { width: WIDTH, height: HEIGHT }), /RGB|透明/);
});
