import test from 'node:test';
import assert from 'node:assert/strict';
import type { Storage } from '@dawn-tick/core';
import { readMetaJson, readMetaNumber, writeMetaJson } from '../src/lib/meta.ts';
import { APP_META_KEYS, isKnownMetaKey } from '../src/lib/meta-keys.ts';
import { logEntries } from '../src/log.ts';

/** 测试用读桩：只暴露 readMeta。 */
function reader(read: () => Promise<string | undefined>): Pick<Storage, 'readMeta'> {
  return { readMeta: read };
}

/** 测试用写桩：只暴露 writeMeta。 */
function writer(write: (key: string, value: string) => Promise<void>): Pick<Storage, 'writeMeta'> {
  return { writeMeta: write };
}

function warnings(scope: string): Array<{ message: string; detail?: Record<string, unknown> }> {
  return logEntries()
    .filter((entry) => entry.level === 'warn' && entry.scope === scope)
    .map((entry) => ({ ...(entry.detail === undefined ? {} : { detail: entry.detail }), message: entry.message }));
}

const parseNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

test('readMetaJson：键缺失或空白回落且不记日志', async () => {
  const before = warnings('meta-missing').length;
  for (const raw of [undefined, '', '   ']) {
    const value = await readMetaJson(reader(async () => raw), 'k', {
      parse: parseNumber,
      fallback: 7,
      scope: 'meta-missing',
    });
    assert.equal(value, 7);
  }
  assert.equal(warnings('meta-missing').length, before);
});

test('readMetaJson：JSON 损坏回落并记 warn', async () => {
  const value = await readMetaJson(reader(async () => '{ 不是 JSON'), 'app_log', {
    parse: parseNumber,
    fallback: 7,
    scope: 'meta-corrupt',
  });
  assert.equal(value, 7);
  const warned = warnings('meta-corrupt');
  assert.equal(warned.length, 1);
  assert.match(warned[0]?.message ?? '', /不是合法 JSON/);
  assert.equal(warned[0]?.detail?.['key'], 'app_log');
});

test('readMetaJson：校验不通过回落并记 warn', async () => {
  const value = await readMetaJson(reader(async () => '{"id":""}'), 'recent_school', {
    parse: (parsed) => {
      if (typeof parsed !== 'object' || parsed === null) return null;
      const id = (parsed as Record<string, unknown>)['id'];
      return typeof id === 'string' && id !== '' ? id : null;
    },
    fallback: 'fallback',
    scope: 'meta-invalid',
  });
  assert.equal(value, 'fallback');
  const warned = warnings('meta-invalid');
  assert.equal(warned.length, 1);
  assert.match(warned[0]?.message ?? '', /结构不正确/);
});

test('readMetaJson：校验回调抛错也按失败兜底', async () => {
  const value = await readMetaJson(reader(async () => '[1,2]'), 'k', {
    parse: () => {
      throw new Error('校验器崩了');
    },
    fallback: 'safe',
    scope: 'meta-throw',
  });
  assert.equal(value, 'safe');
  assert.equal(warnings('meta-throw').length, 1);
});

test('readMetaJson：存储读取失败回落并记 warn', async () => {
  const value = await readMetaJson(
    reader(async () => {
      throw new Error('数据库锁住');
    }),
    'k',
    { parse: parseNumber, fallback: 0, scope: 'meta-read-fail' },
  );
  assert.equal(value, 0);
  const warned = warnings('meta-read-fail');
  assert.equal(warned.length, 1);
  assert.match(warned[0]?.message ?? '', /读取 app_meta 失败/);
});

test('readMetaJson：scope 传 null 时静默', async () => {
  const before = logEntries().length;
  const value = await readMetaJson(reader(async () => 'not json'), 'k', {
    parse: parseNumber,
    fallback: 1,
    scope: null,
  });
  assert.equal(value, 1);
  assert.equal(logEntries().length, before);
});

test('writeMetaJson：返回落盘文本并保留序列化结果', async () => {
  const written: Array<{ key: string; value: string }> = [];
  const text = await writeMetaJson(
    writer(async (key, value) => {
      written.push({ key, value });
    }),
    'ui_layout_v1',
    { main: { order: 1 } },
    { scope: 'meta-write-ok' },
  );
  assert.equal(text, '{"main":{"order":1}}');
  assert.deepEqual(written, [{ key: 'ui_layout_v1', value: text }]);
  assert.equal(warnings('meta-write-ok').length, 0);
});

test('writeMetaJson：序列化失败记日志并抛出', async () => {
  const before = warnings('meta-write-serialize').length;
  await assert.rejects(
    writeMetaJson(writer(async () => {}), 'k', { n: 1n }, { scope: 'meta-write-serialize' }),
    TypeError,
  );
  assert.equal(warnings('meta-write-serialize').length, before + 1);
});

test('writeMetaJson：写入失败记日志并抛出；scope 为 null 时静默', async () => {
  const failing = writer(async () => {
    throw new Error('临时只读');
  });
  await assert.rejects(writeMetaJson(failing, 'k', { a: 1 }, { scope: 'meta-write-fail' }), /临时只读/);
  assert.equal(warnings('meta-write-fail').length, 1);

  const before = logEntries().length;
  await assert.rejects(writeMetaJson(failing, 'k', { a: 1 }, { scope: null }), /临时只读/);
  assert.equal(logEntries().length, before);
});

test('readMetaNumber：缺失或非数字回落，合法数字照读', async () => {
  assert.equal(await readMetaNumber(reader(async () => undefined), 'k', 0), 0);
  assert.equal(await readMetaNumber(reader(async () => '1793000000000'), 'k', 0), 1_793_000_000_000);
  assert.equal(await readMetaNumber(reader(async () => 'abc'), 'k', 5, { scope: 'meta-number' }), 5);
  assert.equal(warnings('meta-number').length, 1);
  const before = logEntries().length;
  assert.equal(await readMetaNumber(reader(async () => 'abc'), 'k', 5, { scope: null }), 5);
  assert.equal(logEntries().length, before);
  assert.equal(
    await readMetaNumber(
      reader(async () => {
        throw new Error('读失败');
      }),
      'k',
      9,
      { scope: null },
    ),
    9,
  );
});

test('键清单锁定存量键名（改名等于丢数据）', () => {
  assert.equal(new Set(APP_META_KEYS).size, APP_META_KEYS.length, '清单内不重复');
  const legacy = [
    'app_log',
    'recent_school',
    'ui_layout_v1',
    'presets_snapshot_v1',
    'presets_content_v1',
    'widget_snapshot',
    'seen_notices',
    'time_zone_aligned',
    'notify_permission_asked',
    'webdav_last_upload',
    'webdav_last_sync',
    'backup_index',
    'time_zone',
    'log_level',
    'wal_mode',
    'schema_version',
    'sync_cursor',
  ];
  for (const key of legacy) assert.ok(isKnownMetaKey(key), `${key} 已登记`);
  assert.ok(isKnownMetaKey('backup:1793000000000'), '快照前缀已登记');
  assert.equal(isKnownMetaKey('backup'), false);
  assert.equal(isKnownMetaKey('unknown_key'), false);
});
