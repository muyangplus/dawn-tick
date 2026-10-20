import assert from 'node:assert/strict';
import test from 'node:test';
import { corruptMessage, isCorruptDatabase, isMissingSqlxMigrations } from '../src/db/health.ts';
import { fail, failureText } from '../src/lib/fail.ts';

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
  assert.equal(
    isCorruptDatabase(new Error('error returned from database: (code: 1) unsupported file format')),
    true,
  );
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

test('插件迁移撞上已有 users 时判为旧库缺迁移记录', () => {
  assert.equal(
    isMissingSqlxMigrations(
      new Error(
        'while executing migrations: error returned from database: (code: 1) table `users` already exists',
      ),
    ),
    true,
  );
  assert.equal(
    isMissingSqlxMigrations(
      'while executing migration 1: error returned from database: (code: 1) table users already exists',
    ),
    true,
  );
  // 其它迁移失败、损坏与普通错误都不算旧库
  assert.equal(
    isMissingSqlxMigrations(
      new Error('while executing migrations: error returned from database: (code: 1) no such table: app_meta'),
    ),
    false,
  );
  assert.equal(isMissingSqlxMigrations(new Error('database disk image is malformed')), false);
  assert.equal(isMissingSqlxMigrations(new Error('database is locked')), false);
  assert.equal(isMissingSqlxMigrations(''), false);
  assert.equal(isMissingSqlxMigrations(undefined), false);
});

test('fail() 统一「发生了什么 + 原因 + 下一步」句式', () => {
  const failure = fail('载入失败', '存储初始化没有完成', '请重启应用。');
  assert.equal(failure.title, '载入失败');
  assert.equal(failure.body, '存储初始化没有完成。请重启应用。');
  assert.equal(failure.text, '载入失败：存储初始化没有完成。请重启应用。');
  assert.equal(failureText('恢复失败', '没有可用备份', '请打开备份目录。'), '恢复失败：没有可用备份。请打开备份目录。');

  // 句末标点不重复；缺原因时仍保留下一步
  assert.equal(fail('载入失败', '', '请重试；').text, '载入失败：请重试。');
  assert.equal(fail('', '库里没有数据', '请先创建学期').text, '操作没有完成：库里没有数据。请先创建学期。');
});
