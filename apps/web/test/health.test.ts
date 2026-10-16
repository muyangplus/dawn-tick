import assert from 'node:assert/strict';
import test from 'node:test';
import { corruptMessage, isCorruptDatabase } from '../src/db/health.ts';

test('损坏判定认 SQLite 的损坏报错', () => {
  assert.equal(
    isCorruptDatabase(
      new Error('error returned from database: (code: 11) database disk image is malformed'),
    ),
    true,
  );
  assert.equal(isCorruptDatabase(new Error('database disk image is malformed')), true);
  assert.equal(isCorruptDatabase(new Error('file is not a database')), true);
  assert.equal(isCorruptDatabase(new Error('(code: 26) file is not a database')), true);
});

test('锁冲突与权限问题不算损坏', () => {
  assert.equal(isCorruptDatabase(new Error('database is locked')), false);
  assert.equal(isCorruptDatabase(new Error('unable to open database file')), false);
  assert.equal(isCorruptDatabase(new Error('attempt to write a readonly database')), false);
  assert.equal(isCorruptDatabase(''), false);
  assert.equal(isCorruptDatabase(undefined), false);
});

test('损坏文案按平台给下一步', () => {
  assert.equal(corruptMessage('tauri'), '数据库文件损坏，重启应用会再试一次恢复');
  assert.equal(corruptMessage('capacitor'), '数据库文件损坏，请从备份导入恢复');
  assert.equal(corruptMessage('web'), '数据库文件损坏，请从备份导入恢复');
});
