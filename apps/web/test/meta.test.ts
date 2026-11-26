import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_META_KEYS, exportBackup, type Storage } from '@dawn-tick/core';
import { createStorage } from '@dawn-tick/core/testing';
import { readMetaJson, readMetaNumber, writeMetaJson } from '../src/lib/meta.ts';
import { APP_META_KEYS, ASSISTANT_CHAT_META_KEY, isKnownMetaKey } from '../src/lib/meta-keys.ts';
import { logEntries } from '../src/log.ts';

/** 测试用读桩：只暴露 readMeta。 */
function reader(read: () => Promise<string | undefined>): Pick<Storage, 'readMeta'> {
  return { readMeta: read };
}

/** 测试用写桩：只暴露 writeMeta。 */
function writer(write: (key: string, value: string) => Promise<void>): Pick<Storage, 'writeMeta'> {
  return { writeMeta: write };
}

/** 本文件的日志都落在同一个登记范围下，靠「执行期间新增的条目」区分各用例。 */
const SCOPE = 'storage' as const;

type Warning = { message: string; detail?: Record<string, unknown> };

/** 执行 run 期间新增的 warn 条目（按条目引用比对，缓冲被截断也不受影响）。 */
async function warnedDuring(run: () => Promise<unknown>): Promise<Warning[]> {
  const before = new Set(logEntries());
  await run();
  return logEntries()
    .filter((entry) => !before.has(entry) && entry.level === 'warn' && entry.scope === SCOPE)
    .map((entry) => ({ ...(entry.detail === undefined ? {} : { detail: entry.detail }), message: entry.message }));
}

const parseNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

test('readMetaJson：键缺失或空白回落且不记日志', async () => {
  const warned = await warnedDuring(async () => {
    for (const raw of [undefined, '', '   ']) {
      const value = await readMetaJson(reader(async () => raw), 'k', {
        parse: parseNumber,
        fallback: 7,
        scope: SCOPE,
      });
      assert.equal(value, 7);
    }
  });
  assert.deepEqual(warned, []);
});

test('readMetaJson：JSON 损坏回落并记 warn', async () => {
  let value: number | undefined;
  const warned = await warnedDuring(async () => {
    value = await readMetaJson(reader(async () => '{ 不是 JSON'), 'app_log', {
      parse: parseNumber,
      fallback: 7,
      scope: SCOPE,
    });
  });
  assert.equal(value, 7);
  assert.equal(warned.length, 1);
  assert.match(warned[0]?.message ?? '', /不是合法 JSON/);
  assert.equal(warned[0]?.detail?.['key'], 'app_log');
});

test('readMetaJson：校验不通过回落并记 warn', async () => {
  let value: string | undefined;
  const warned = await warnedDuring(async () => {
    value = await readMetaJson(reader(async () => '{"id":""}'), 'recent_school', {
      parse: (parsed) => {
        if (typeof parsed !== 'object' || parsed === null) return null;
        const id = (parsed as Record<string, unknown>)['id'];
        return typeof id === 'string' && id !== '' ? id : null;
      },
      fallback: 'fallback',
      scope: SCOPE,
    });
  });
  assert.equal(value, 'fallback');
  assert.equal(warned.length, 1);
  assert.match(warned[0]?.message ?? '', /结构不正确/);
});

test('readMetaJson：校验回调抛错也按失败兜底', async () => {
  let value: string | undefined;
  const warned = await warnedDuring(async () => {
    value = await readMetaJson(reader(async () => '[1,2]'), 'k', {
      parse: () => {
        throw new Error('校验器崩了');
      },
      fallback: 'safe',
      scope: SCOPE,
    });
  });
  assert.equal(value, 'safe');
  assert.equal(warned.length, 1);
});

test('readMetaJson：存储读取失败回落并记 warn', async () => {
  let value: number | undefined;
  const warned = await warnedDuring(async () => {
    value = await readMetaJson(
      reader(async () => {
        throw new Error('数据库锁住');
      }),
      'k',
      { parse: parseNumber, fallback: 0, scope: SCOPE },
    );
  });
  assert.equal(value, 0);
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
  let text = '';
  const warned = await warnedDuring(async () => {
    text = await writeMetaJson(
      writer(async (key, value) => {
        written.push({ key, value });
      }),
      'ui_layout_v1',
      { main: { order: 1 } },
      { scope: SCOPE },
    );
  });
  assert.equal(text, '{"main":{"order":1}}');
  assert.deepEqual(written, [{ key: 'ui_layout_v1', value: text }]);
  assert.deepEqual(warned, []);
});

test('writeMetaJson：序列化失败记日志并抛出', async () => {
  const warned = await warnedDuring(() =>
    assert.rejects(writeMetaJson(writer(async () => {}), 'k', { n: 1n }, { scope: SCOPE }), TypeError),
  );
  assert.equal(warned.length, 1);
});

test('writeMetaJson：写入失败记日志并抛出；scope 为 null 时静默', async () => {
  const failing = writer(async () => {
    throw new Error('临时只读');
  });
  const warned = await warnedDuring(() => assert.rejects(writeMetaJson(failing, 'k', { a: 1 }, { scope: SCOPE }), /临时只读/));
  assert.equal(warned.length, 1);

  const before = logEntries().length;
  await assert.rejects(writeMetaJson(failing, 'k', { a: 1 }, { scope: null }), /临时只读/);
  assert.equal(logEntries().length, before);
});

test('readMetaNumber：缺失或非数字回落，合法数字照读', async () => {
  assert.equal(await readMetaNumber(reader(async () => undefined), 'k', 0), 0);
  assert.equal(await readMetaNumber(reader(async () => '1793000000000'), 'k', 0), 1_793_000_000_000);
  const warned = await warnedDuring(async () => {
    assert.equal(await readMetaNumber(reader(async () => 'abc'), 'k', 5, { scope: SCOPE }), 5);
  });
  assert.equal(warned.length, 1);
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
    'course_end_convert_v1',
    'assistant_chat_v1',
  ];
  for (const key of legacy) assert.ok(isKnownMetaKey(key), `${key} 已登记`);
  assert.ok(isKnownMetaKey('backup:1793000000000'), '快照前缀已登记');
  assert.equal(isKnownMetaKey('backup'), false);
  assert.equal(isKnownMetaKey('unknown_key'), false);
});

test('助手对话键已登记，只存本机，不进备份导出', async () => {
  assert.equal(ASSISTANT_CHAT_META_KEY, 'assistant_chat_v1');
  assert.ok(APP_META_KEYS.includes(ASSISTANT_CHAT_META_KEY));
  assert.equal(BACKUP_META_KEYS.includes(ASSISTANT_CHAT_META_KEY), false);
  const storage = createStorage();
  await storage.writeMeta(ASSISTANT_CHAT_META_KEY, '{"version":1}');
  const payload = await exportBackup(storage);
  assert.equal(payload.meta[ASSISTANT_CHAT_META_KEY], undefined);
});
