import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUIET_HOURS } from '@dawn-tick/core';
import {
  NEW_QUIET_RULE,
  quietDaysText,
  quietRuleText,
  removeQuietRule,
  replaceQuietRule,
  toggleQuietDay,
} from '../src/screens/settings/quiet-hours-model.ts';

test('勿扰时段：勾选星期，至少保留一天', () => {
  const rule = { days: [3], start: '12:00', end: '14:00' };
  assert.equal(toggleQuietDay(rule, 3), rule);
  assert.deepEqual(toggleQuietDay(rule, 1).days, [1, 3]);
  assert.deepEqual(toggleQuietDay({ ...rule, days: [1, 3] }, 1).days, [3]);
});

test('勿扰时段：替换与删除', () => {
  const value = { ...DEFAULT_QUIET_HOURS, rules: [DEFAULT_QUIET_HOURS.rules[0]!, NEW_QUIET_RULE] };
  assert.equal(replaceQuietRule(value, 1, { ...NEW_QUIET_RULE, end: '13:00' }).rules[1]?.end, '13:00');
  assert.deepEqual(removeQuietRule(value, 0).rules, [NEW_QUIET_RULE]);
});

test('勿扰时段文案', () => {
  assert.equal(quietDaysText([1, 2, 3, 4, 5, 6, 7]), '每天');
  assert.equal(quietDaysText([5, 4, 3, 2, 1]), '工作日');
  assert.equal(quietDaysText([6, 7]), '周末');
  assert.equal(quietDaysText([1, 3]), '周一、周三');
  assert.equal(quietRuleText({ days: [1, 2, 3, 4, 5], start: '22:00', end: '07:00' }), '工作日 22:00–次日 07:00');
  assert.equal(quietRuleText({ days: [6, 7], start: '12:00', end: '14:00' }), '周末 12:00–14:00');
  assert.equal(quietRuleText({ days: [7], start: '00:00', end: '00:00' }), '周日 00:00–次日 00:00');
});
