import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  VIEW_DAY_OPTIONS,
  WAL_MODES,
  readSettings,
  writeSettings,
} from '../src/settings.ts';
import { createStorage } from './helpers.ts';

test('周视图天数可选 1–7 天', async () => {
  assert.deepEqual([...VIEW_DAY_OPTIONS], [1, 2, 3, 4, 5, 6, 7]);
  const storage = createStorage();
  for (const days of VIEW_DAY_OPTIONS) {
    const settings = await writeSettings(storage, { viewDays: days });
    assert.equal(settings.viewDays, days);
  }
  assert.equal((await readSettings(storage)).viewDays, 7);
});

test('周视图天数超出范围被拒绝', async () => {
  const storage = createStorage();
  await assert.rejects(() => writeSettings(storage, { viewDays: 0 }), /周视图天数/);
  await assert.rejects(() => writeSettings(storage, { viewDays: 8 }), /周视图天数/);
  assert.equal((await readSettings(storage)).viewDays, DEFAULT_SETTINGS.viewDays);
});

test('课表视图开关：今天为第一天默认开、不显示周末默认关', async () => {
  const storage = createStorage();
  const defaults = await readSettings(storage);
  assert.equal(defaults.weekStartsToday, true);
  assert.equal(defaults.hideWeekends, false);

  const changed = await writeSettings(storage, { weekStartsToday: false, hideWeekends: true });
  assert.equal(changed.weekStartsToday, false);
  assert.equal(changed.hideWeekends, true);
  assert.equal(await storage.readMeta('week_starts_today'), '0');
  assert.equal(await storage.readMeta('hide_weekends'), '1');

  const reloaded = await readSettings(storage);
  assert.equal(reloaded.weekStartsToday, false);
  assert.equal(reloaded.hideWeekends, true);
});

test('日志模式默认跟随存储位置，可手动开或关', async () => {
  assert.deepEqual([...WAL_MODES], ['auto', 'on', 'off']);
  const storage = createStorage();
  assert.equal((await readSettings(storage)).walMode, 'auto');
  assert.equal((await writeSettings(storage, { walMode: 'off' })).walMode, 'off');
  assert.equal((await storage.readMeta('wal_mode')), 'off');
  assert.equal((await writeSettings(storage, { walMode: 'on' })).walMode, 'on');
  assert.equal((await readSettings(storage)).walMode, 'on');
});

test('非法日志模式被拒绝', async () => {
  const storage = createStorage();
  await assert.rejects(
    () => writeSettings(storage, { walMode: 'yes' as unknown as 'on' }),
    /数据库日志模式/,
  );
  assert.equal((await readSettings(storage)).walMode, DEFAULT_SETTINGS.walMode);
});

test('备份设置默认开、保留 10 份且范围受限', async () => {
  const storage = createStorage();
  const initial = await readSettings(storage);
  assert.equal(initial.autoBackup, true);
  assert.equal(initial.backupOnStart, true);
  assert.equal(initial.backupDaily, true);
  assert.equal(initial.backupKeep, 10);

  const saved = await writeSettings(storage, {
    autoBackup: false,
    backupOnStart: false,
    backupDaily: false,
    backupKeep: 3,
  });
  assert.equal(saved.autoBackup, false);
  assert.equal(saved.backupKeep, 3);
  assert.equal(await storage.readMeta('backup_keep'), '3');

  await assert.rejects(() => writeSettings(storage, { backupKeep: 0 }), /保留份数/);
  await assert.rejects(() => writeSettings(storage, { backupKeep: 101 }), /保留份数/);
  assert.equal((await readSettings(storage)).backupKeep, 3, '非法值不落库');
});
