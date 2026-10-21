import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_LABEL,
  MUTE_MINUTES,
  SNOOZE_MINUTES,
  actionsFor,
  endOfLocalDay,
  isReminderSuppressed,
  normalizeReminderKind,
  parseReminderAction,
  planReminderAction,
  pruneSuppression,
  reminderActionIds,
  reminderKindOf,
  supportsReminderAction,
  takeDue,
  type ReminderActionTarget,
  type ReminderKind,
} from '../src/lib/reminder-actions.ts';

const TZ = 'Asia/Shanghai';
const NOW = Date.parse('2026-10-21T15:30:00+08:00');
const MINUTE = 60_000;

function target(kind: ReminderKind, triggerAt = NOW, targetId = `${kind}-1`): ReminderActionTarget {
  return { id: `${kind}-reminder`, kind, targetId, triggerAt };
}

test('课前提醒只有贪睡与勿扰，没有完成', () => {
  assert.deepEqual(
    reminderActionIds('class'),
    ['snooze', 'mute'],
  );
  assert.deepEqual(
    actionsFor('class').map((item) => item.label),
    [ACTION_LABEL.snooze, ACTION_LABEL.mute],
  );
  assert.equal(supportsReminderAction('class', 'done'), false);
  assert.equal(actionsFor('class').some((item) => item.id === 'done'), false);
});

test('四类日程提醒都有贪睡、完成与勿扰', () => {
  for (const kind of ['todo', 'homework', 'exam', 'lab'] as const) {
    assert.deepEqual(reminderActionIds(kind), ['snooze', 'done', 'mute'], kind);
    assert.deepEqual(
      actionsFor(kind).map((item) => item.label),
      [`贪睡 ${SNOOZE_MINUTES} 分钟`, '完成', `勿扰 ${MUTE_MINUTES} 分钟`],
      kind,
    );
  }
});

test('提醒类别由来源与日程类型推出', () => {
  assert.equal(reminderKindOf('course'), 'class');
  assert.equal(reminderKindOf('schedule'), 'class');
  assert.equal(reminderKindOf('event', 'homework'), 'homework');
  assert.equal(reminderKindOf('event', 'exam'), 'exam');
  assert.equal(reminderKindOf('event', 'lab'), 'lab');
  assert.equal(reminderKindOf('event', 'todo'), 'todo');
  assert.equal(reminderKindOf('event', 'temp'), 'todo');
  assert.equal(reminderKindOf('event', null), 'todo');
});

test('字符串归一：未知类别与动作返回 null', () => {
  assert.equal(normalizeReminderKind('class'), 'class');
  assert.equal(normalizeReminderKind('homework'), 'homework');
  assert.equal(normalizeReminderKind('other'), null);
  assert.equal(normalizeReminderKind(3), null);
  assert.equal(parseReminderAction('snooze'), 'snooze');
  assert.equal(parseReminderAction('dismiss'), null);
  assert.equal(parseReminderAction(undefined), null);
});

test('贪睡 10 分钟：同一提醒在 now + 10 分钟后再次投递', () => {
  const plan = planReminderAction(target('exam'), 'snooze', NOW, TZ);
  assert.ok(plan !== null);
  assert.equal(plan.action, 'snooze');
  if (plan.action !== 'snooze') return;
  assert.equal(plan.id, 'exam-reminder');
  assert.equal(plan.triggerAt, NOW + 10 * MINUTE);
  assert.equal(plan.minutes, 10);

  const snoozed = { ...target('exam'), triggerAt: plan.triggerAt };
  assert.deepEqual(
    takeDue([snoozed], NOW + 9 * MINUTE).due,
    [],
  );
  const due = takeDue([snoozed], NOW + 10 * MINUTE).due;
  assert.equal(due.length, 1);
  assert.equal(due[0]?.targetId, 'exam-1');
  assert.equal(due[0]?.triggerAt, plan.triggerAt);
});

test('勿扰 1 小时：只跳过同一目标窗口内的提醒', () => {
  const plan = planReminderAction(target('class', NOW, 'course-1'), 'mute', NOW, TZ);
  assert.ok(plan !== null);
  assert.equal(plan.action, 'mute');
  if (plan.action !== 'mute') return;
  assert.equal(plan.targetId, 'course-1');
  assert.equal(plan.until, NOW + 60 * MINUTE);
  assert.equal(plan.minutes, 60);

  const suppression = { mutes: [plan], done: [] };
  assert.equal(
    isReminderSuppressed({ targetId: 'course-1', triggerAt: NOW + 30 * MINUTE }, suppression),
    true,
  );
  assert.equal(
    isReminderSuppressed({ targetId: 'course-1', triggerAt: NOW + 90 * MINUTE }, suppression),
    false,
  );
  assert.equal(
    isReminderSuppressed({ targetId: 'course-2', triggerAt: NOW + 30 * MINUTE }, suppression),
    false,
  );
});

test('完成：写回 events.done 且当天剩余提醒被抑制', () => {
  const plan = planReminderAction(target('homework', NOW, 'event-9'), 'done', NOW, TZ);
  assert.ok(plan !== null);
  assert.equal(plan.action, 'done');
  if (plan.action !== 'done') return;
  assert.deepEqual(plan.write, { eventId: 'event-9', fields: { done: 1 } });
  assert.equal(plan.suppressUntil, Date.parse('2026-10-22T00:00:00+08:00'));

  const suppression = { mutes: [], done: [{ targetId: plan.targetId, until: plan.suppressUntil }] };
  assert.equal(
    isReminderSuppressed({ targetId: 'event-9', triggerAt: NOW + 3 * 60 * MINUTE }, suppression),
    true,
  );
  assert.equal(
    isReminderSuppressed({ targetId: 'event-9', triggerAt: NOW + 9 * 60 * MINUTE }, suppression),
    false,
  );
  assert.equal(
    isReminderSuppressed({ targetId: 'event-10', triggerAt: NOW + 60 * MINUTE }, suppression),
    false,
  );
});

test('完成动作对课前提醒不可用', () => {
  assert.equal(planReminderAction(target('class'), 'done', NOW, TZ), null);
});

test('当天结束时刻按设置时区计算', () => {
  // 上海时间 21 日 15:30 → 22 日 00:00；UTC 同一时刻的「当天」是 21 日 07:30
  assert.equal(endOfLocalDay(NOW, TZ), Date.parse('2026-10-22T00:00:00+08:00'));
  assert.equal(endOfLocalDay(NOW, 'UTC'), Date.parse('2026-10-22T00:00:00Z'));
});

test('过期的抑制记录会被清掉', () => {
  const suppression = {
    mutes: [
      { targetId: 'a', until: NOW - 1 },
      { targetId: 'b', until: NOW + MINUTE },
    ],
    done: [{ targetId: 'c', until: NOW - 1 }],
  };
  assert.deepEqual(pruneSuppression(suppression, NOW), {
    mutes: [{ targetId: 'b', until: NOW + MINUTE }],
    done: [],
  });
});
