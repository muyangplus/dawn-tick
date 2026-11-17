import test from 'node:test';
import assert from 'node:assert/strict';
import {
  breakFieldError,
  durationFieldError,
  filterPresets,
  paramError,
  reflowedSlots,
  timeDraft,
} from '../src/components/period-settings-model.ts';

test('重排参数越界给出说明，先报时长再报课间', () => {
  assert.equal(paramError(45, 10), null);
  assert.match(paramError(0, 10) ?? '', /每节时长/);
  assert.match(paramError(45, -1) ?? '', /课间/);
  assert.match(paramError(Number.NaN, -1) ?? '', /每节时长/);
  assert.equal(durationFieldError(45), undefined);
  assert.equal(breakFieldError(10), undefined);
  assert.ok(durationFieldError(10_000) !== undefined);
});

test('作息预设按名称、id、来源过滤，空白关键词返回全部', () => {
  const all = [
    { id: 'default', name: '默认作息', source: undefined },
    { id: 'pku', name: '北大作息', source: '北京大学' },
  ];
  assert.equal(filterPresets(all, '  ').length, 2);
  assert.deepEqual(filterPresets(all, 'PKU').map((item) => item.id), ['pku']);
  assert.deepEqual(filterPresets(all, '北京').map((item) => item.id), ['pku']);
  assert.deepEqual(filterPresets(all, '默认').map((item) => item.id), ['default']);
});

test('改结束时间按新时长重排，只改开始时间沿用设置里的时长', () => {
  const slot = { period_no: 3, start_time: '10:00', end_time: '10:45' };
  assert.deepEqual(timeDraft(slot, { endTime: '10:50' }, 45), {
    periodNo: 3,
    section: 'am',
    durationMinutes: 50,
    durationFromEdit: true,
  });
  const moved = timeDraft(slot, { startTime: '14:00' }, 40);
  assert.equal(moved.section, 'pm');
  assert.equal(moved.durationMinutes, 40);
  assert.equal(moved.durationFromEdit, false);
});

test('顺延结果只换起止时间，保留时段与备注，缺时段按开始时间推断', () => {
  const rows = [
    { period_no: 1, start_time: '08:00', end_time: '08:45', section: 'am' as const, label: '早读' },
    { period_no: 2, start_time: '08:55', end_time: '09:40', section: null, label: null },
  ];
  const out = reflowedSlots(rows, [{ periodNo: 2, start: '13:00', end: '13:45' }]);
  assert.deepEqual(out[0], { periodNo: 1, startTime: '08:00', endTime: '08:45', section: 'am', label: '早读' });
  assert.deepEqual(out[1], { periodNo: 2, startTime: '13:00', endTime: '13:45', section: 'pm', label: null });
});
