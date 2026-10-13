import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, VIEW_DAY_OPTIONS, readSettings, writeSettings } from '../src/settings.ts';
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
