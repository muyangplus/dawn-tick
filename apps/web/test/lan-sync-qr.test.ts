import test from 'node:test';
import assert from 'node:assert/strict';
import { pairingQrText, qrMatrix } from '../src/lan-sync-qr.ts';

const SAMPLE = pairingQrText('192.168.1.5', 8765, '123456');

function finderDark(dx: number, dy: number): boolean {
  const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
  const center = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
  return edge || center;
}

function expectFinder(matrix: boolean[][], left: number, top: number): void {
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      assert.equal(matrix[top + dy]?.[left + dx], finderDark(dx, dy), `定位图案 (${left},${top}) 的 (${dx},${dy})`);
    }
  }
}

test('二维码矩阵：版本 2 尺寸、三个定位图案与深色模块', () => {
  const matrix = qrMatrix(SAMPLE);
  assert.equal(matrix.length, 25);
  for (const row of matrix) assert.equal(row.length, 25);
  expectFinder(matrix, 0, 0);
  expectFinder(matrix, 18, 0);
  expectFinder(matrix, 0, 18);
  assert.equal(matrix[25 - 8]?.[8], true, '深色模块必须在 (8, size-8)');
});

test('二维码矩阵：时序图案与确定性', () => {
  const matrix = qrMatrix(SAMPLE);
  for (let x = 8; x <= 16; x += 1) {
    assert.equal(matrix[6]?.[x], x % 2 === 0, `横向时序 ${x}`);
    assert.equal(matrix[x]?.[6], x % 2 === 0, `纵向时序 ${x}`);
  }
  assert.deepEqual(qrMatrix(SAMPLE), matrix);
  assert.notDeepEqual(qrMatrix('192.168.1.6 654321'), matrix);
});

test('二维码矩阵：短内容选版本 1，标准配对链接走版本 5–7，超长报错', () => {
  assert.equal(qrMatrix('1').length, 21);
  assert.equal(qrMatrix('x'.repeat(14)).length, 21);
  assert.equal(qrMatrix('x'.repeat(15)).length, 25);
  assert.equal(qrMatrix('x'.repeat(62)).length, 33);
  // 标准配对链接约 72–90 字节：版本 5（84 字节）/ 版本 6（106 字节）
  assert.equal(qrMatrix('x'.repeat(63)).length, 37);
  assert.equal(qrMatrix('x'.repeat(84)).length, 37);
  assert.equal(qrMatrix('x'.repeat(85)).length, 41);
  assert.equal(qrMatrix('x'.repeat(106)).length, 41);
  // 带稳定 deviceId 的链接约 119 字节：版本 7（122 字节）起
  assert.equal(qrMatrix('x'.repeat(107)).length, 45);
  assert.equal(qrMatrix('x'.repeat(122)).length, 45);
  assert.equal(qrMatrix('x'.repeat(123)).length, 49);
  assert.equal(qrMatrix('x'.repeat(152)).length, 49);
  assert.equal(qrMatrix('x'.repeat(153)).length, 53);
  assert.equal(qrMatrix('x'.repeat(180)).length, 53);
  assert.equal(qrMatrix('x'.repeat(181)).length, 57);
  assert.equal(qrMatrix('x'.repeat(213)).length, 57);
  assert.throws(() => qrMatrix('x'.repeat(214)), /二维码内容过长/);
  assert.equal(pairingQrText('10.0.0.2', 8765, '000000'), '10.0.0.2:8765 000000');
});

test('二维码矩阵：版本 7+ 画出版本信息区，长链接仍能生成', () => {
  const text =
    'dawn-tick://pair?schema=1&host=192.168.1.23&port=8765&code=123456&name=PC&deviceId=123e4567-e89b-42d3-a456-426614174000';
  const matrix = qrMatrix(text);
  assert.equal(matrix.length, 45);
  // 版本 7 信息位 0x07C94：index 0 = 0、index 2 = 1（右上区从 size-11 起）
  assert.equal(matrix[0]?.[34], false);
  assert.equal(matrix[0]?.[36], true);
  // 左下区内容与右上区一致
  assert.equal(matrix[34]?.[0], false);
  assert.equal(matrix[36]?.[0], true);
});
