import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyQuietHours,
  checkQuietHours,
  computeReminders,
  DEFAULT_QUIET_HOURS,
  encodeQuietHours,
  parseQuietHours,
  quietWindowEnd,
  type Occurrence,
  type QuietHours,
  type ReminderRow,
} from '../src/index.ts';

const SH = 'Asia/Shanghai';
const at = (iso: string): number => Date.parse(iso);

function quiet(overrides: Partial<QuietHours> = {}): QuietHours {
  return { enabled: true, mode: 'defer', rules: [{ days: [1, 2, 3, 4, 5], start: '22:00', end: '07:00' }], ...overrides };
}

test('勿扰：跨午夜时段按开始那天的星期判定', () => {
  // 2026-11-16 周一 23:00 在内，结束于周二 07:00
  assert.equal(quietWindowEnd(at('2026-11-16T23:00:00+08:00'), quiet(), SH), at('2026-11-17T07:00:00+08:00'));
  // 周二 06:59 属于周一开始的那段
  assert.equal(quietWindowEnd(at('2026-11-17T06:59:00+08:00'), quiet(), SH), at('2026-11-17T07:00:00+08:00'));
  // 结束时刻本身不在内（左闭右开）
  assert.equal(quietWindowEnd(at('2026-11-17T07:00:00+08:00'), quiet(), SH), null);
  // 周六 06:00：周五开始的那段仍覆盖
  assert.equal(quietWindowEnd(at('2026-11-21T06:00:00+08:00'), quiet(), SH), at('2026-11-21T07:00:00+08:00'));
  // 周日 06:00：周六没有规则
  assert.equal(quietWindowEnd(at('2026-11-22T06:00:00+08:00'), quiet(), SH), null);
  // 周一 06:00：周日没有规则，周一的段 22:00 才开始
  assert.equal(quietWindowEnd(at('2026-11-23T06:00:00+08:00'), quiet(), SH), null);
});

test('勿扰：同日时段与 24 小时时段', () => {
  const noon = quiet({ rules: [{ days: [3], start: '12:00', end: '14:00' }] });
  assert.equal(quietWindowEnd(at('2026-11-18T13:00:00+08:00'), noon, SH), at('2026-11-18T14:00:00+08:00'));
  assert.equal(quietWindowEnd(at('2026-11-18T14:30:00+08:00'), noon, SH), null);
  const allDay = quiet({ rules: [{ days: [7], start: '00:00', end: '00:00' }] });
  assert.equal(quietWindowEnd(at('2026-11-22T18:00:00+08:00'), allDay, SH), at('2026-11-23T00:00:00+08:00'));
  assert.equal(quietWindowEnd(at('2026-11-21T18:00:00+08:00'), allDay, SH), null);
});

test('勿扰：关闭时不判定', () => {
  assert.equal(quietWindowEnd(at('2026-11-16T23:00:00+08:00'), quiet({ enabled: false }), SH), null);
});

test('勿扰：顺延、连续顺延、顺延后已开课则不提醒、跳过', () => {
  const trigger = at('2026-11-17T06:40:00+08:00');
  assert.equal(applyQuietHours(trigger, at('2026-11-17T08:00:00+08:00'), quiet(), SH), at('2026-11-17T07:00:00+08:00'));
  assert.equal(applyQuietHours(trigger, at('2026-11-17T07:00:00+08:00'), quiet(), SH), null);
  assert.equal(applyQuietHours(trigger, at('2026-11-17T08:00:00+08:00'), quiet({ mode: 'skip' }), SH), null);
  const chained = quiet({ rules: [
    { days: [1], start: '22:00', end: '07:00' },
    { days: [2], start: '07:00', end: '07:30' },
  ] });
  assert.equal(applyQuietHours(at('2026-11-16T23:00:00+08:00'), at('2026-11-17T08:00:00+08:00'), chained, SH), at('2026-11-17T07:30:00+08:00'));
  const outside = at('2026-11-17T12:00:00+08:00');
  assert.equal(applyQuietHours(outside, outside + 3600_000, quiet(), SH), outside);
});

test('勿扰：墙钟按所给时区解释，夏令时切换日正确', () => {
  const ny = 'America/New_York';
  const rule = quiet({ rules: [{ days: [7], start: '01:00', end: '04:00' }] });
  // 2026-11-01 周日美东回拨：04:00 EST = 09:00Z
  assert.equal(quietWindowEnd(at('2026-11-01T06:30:00Z'), rule, ny), at('2026-11-01T09:00:00Z'));
  assert.equal(quietWindowEnd(at('2026-11-01T09:00:00Z'), rule, ny), null);
  // 同一时刻在上海是周日 14:30，不在内
  assert.equal(quietWindowEnd(at('2026-11-01T06:30:00Z'), rule, SH), null);
});

test('勿扰设置：编码往返、损坏回退、校验', () => {
  const value = quiet({ rules: [{ days: [5, 1, 1], start: '22:00', end: '07:00' }] });
  const parsed = parseQuietHours(encodeQuietHours(value));
  assert.deepEqual(parsed.rules[0]?.days, [1, 5]);
  assert.equal(parsed.enabled, true);
  assert.deepEqual(parseQuietHours('not json'), DEFAULT_QUIET_HOURS);
  assert.deepEqual(parseQuietHours(undefined), DEFAULT_QUIET_HOURS);
  const dropped = parseQuietHours(JSON.stringify({ enabled: true, mode: 'skip', rules: [{ days: [], start: '1:00', end: '2:00' }, { days: [2], start: '08:00', end: '09:00' }] }));
  assert.equal(dropped.mode, 'skip');
  assert.equal(dropped.rules.length, 1);
  assert.equal(checkQuietHours(quiet()), null);
  assert.notEqual(checkQuietHours(quiet({ rules: [{ days: [], start: '22:00', end: '07:00' }] })), null);
  assert.notEqual(checkQuietHours(quiet({ rules: [{ days: [1], start: '25:00', end: '07:00' }] })), null);
  assert.notEqual(checkQuietHours({ ...quiet(), mode: 'later' as never }), null);
});

function lessonAt(startIso: string): Occurrence {
  const startAt = at(startIso);
  return {
    date: startIso.slice(0, 10), semesterId: 's1', scheduleId: 'sch-1', courseId: 'c1', courseName: '早课',
    shortName: null, color: '#4F8DFD', periodStart: 1, periodEnd: 2, startAt, endAt: startAt + 90 * 60_000,
    room: null, cancelled: false,
  } as Occurrence;
}

const RULE = {
  id: 'r1', user_id: 'u1', target_type: 'course', target_id: 'c1', advance_minutes: 30, enabled: 1,
  skip_holidays: 1, sound: 1, vibrate: 1, dnd: 0, snooze_minutes: null, created_at: 0, updated_at: 0,
  deleted_at: null, rev: 0, dirty: 0,
} as unknown as ReminderRow;

test('computeReminders 套用勿扰：顺延改 triggerAt，跳过则不出现', () => {
  const occurrences = [lessonAt('2026-11-17T07:20:00+08:00'), lessonAt('2026-11-17T10:00:00+08:00')];
  const base = { occurrences, reminders: [RULE], events: [], now: at('2026-11-16T20:00:00+08:00'), timeZone: SH };
  const deferred = computeReminders({ ...base, quietHours: quiet() });
  assert.deepEqual(deferred.map((item) => item.triggerAt), [at('2026-11-17T07:00:00+08:00'), at('2026-11-17T09:30:00+08:00')]);
  const skipped = computeReminders({ ...base, quietHours: quiet({ mode: 'skip' }) });
  assert.deepEqual(skipped.map((item) => item.triggerAt), [at('2026-11-17T09:30:00+08:00')]);
  // 原到点时刻已过、顺延后在未来的仍要排上
  const late = computeReminders({ ...base, now: at('2026-11-17T06:55:00+08:00'), quietHours: quiet() });
  assert.equal(late[0]?.triggerAt, at('2026-11-17T07:00:00+08:00'));
});
