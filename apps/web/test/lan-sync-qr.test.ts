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

test('二维码矩阵：短内容选版本 1，标准配对链接走版本 5/6，超长报错', () => {
  assert.equal(qrMatrix('1').length, 21);
  assert.equal(qrMatrix('x'.repeat(14)).length, 21);
  assert.equal(qrMatrix('x'.repeat(15)).length, 25);
  assert.equal(qrMatrix('x'.repeat(62)).length, 33);
  // 标准配对链接约 72–90 字节：版本 5（84 字节）/ 版本 6（106 字节）
  assert.equal(qrMatrix('x'.repeat(63)).length, 37);
  assert.equal(qrMatrix('x'.repeat(84)).length, 37);
  assert.equal(qrMatrix('x'.repeat(85)).length, 41);
  assert.equal(qrMatrix('x'.repeat(106)).length, 41);
  assert.throws(() => qrMatrix('x'.repeat(107)), /二维码内容过长/);
  assert.equal(pairingQrText('10.0.0.2', 8765, '000000'), '10.0.0.2:8765 000000');
});
