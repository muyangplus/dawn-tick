import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_QUERY_ACTIONS, AI_TIMETABLE_ACTIONS, type AiPlanStep, type PlanExecution } from '@dawn-tick/core';
import { AI_ADJUST_ACTIONS } from '../src/assistant/actions-adjust.ts';
import { AI_APP_ACTIONS } from '../src/assistant/actions-app.ts';
import { AI_EVENT_ACTIONS } from '../src/assistant/actions-events.ts';
import {
  ASSISTANT_ACTIONS,
  applyExecution,
  cardsOf,
  contextNoteOf,
  hasDanger,
  markRunning,
  resetSkipped,
  selectedSteps,
  toggleCard,
  type PlanCard,
} from '../src/assistant/panel-model.ts';

function step(id: string, risk: AiPlanStep['risk'] = 'write'): AiPlanStep {
  return { id, action: risk === 'danger' ? 'delete_semester' : 'create_event', args: {}, params: null, preview: `预览 ${id}`, risk };
}

const ids = (cards: readonly PlanCard[]): string[] => cards.map((card) => card.step.id);

// ---- 动作清单 ----

test('助手动作名不重复', () => {
  const names = ASSISTANT_ACTIONS.map((action) => action.name);
  assert.equal(new Set(names).size, names.length);
});

test('助手动作含查询、课表、日程、调课与应用五组，且查询在前、应用在后', () => {
  const names = ASSISTANT_ACTIONS.map((action) => action.name);
  const groups = [AI_QUERY_ACTIONS, AI_TIMETABLE_ACTIONS, AI_EVENT_ACTIONS, AI_ADJUST_ACTIONS, AI_APP_ACTIONS];
  for (const group of groups) {
    assert.ok(group.length > 0);
    for (const action of group) assert.ok(names.includes(action.name), `缺少 ${action.name}`);
  }
  assert.equal(ASSISTANT_ACTIONS.length, groups.reduce((sum, group) => sum + group.length, 0));
  assert.equal(ASSISTANT_ACTIONS[0]?.name, AI_QUERY_ACTIONS[0]?.name);
  assert.equal(ASSISTANT_ACTIONS.at(-1)?.name, AI_APP_ACTIONS.at(-1)?.name);
  for (const name of ['get_lessons', 'create_course', 'create_event', 'move_lesson', 'update_settings', 'restore_snapshot']) {
    assert.ok(names.includes(name), `缺少 ${name}`);
  }
});

// ---- 上下文说明 ----

test('上下文说明：有学期时给出名称、id、开学日、总周数与当前周', () => {
  const note = contextNoteOf({
    today: '2026-03-09',
    todayOfWeek: 1,
    timeZone: 'Asia/Shanghai',
    semester: { id: 'sem-1', name: '2026 春', start_date: '2026-03-02', total_weeks: 20 },
    week: 2,
  });
  const lines = note.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '今天是 2026-03-09（星期一），时区 Asia/Shanghai。');
  for (const part of ['「2026 春」', 'id sem-1', '2026-03-02 开学', '共 20 周', '第 2 周']) {
    assert.ok(lines[1]?.includes(part), `缺少 ${part}：${lines[1]}`);
  }
  assert.ok(!note.includes('还没有学期'));
});

test('上下文说明：星期 7 写作「日」，没有学期时写「还没有学期」', () => {
  const note = contextNoteOf({
    today: '2026-03-15',
    todayOfWeek: 7,
    timeZone: 'America/New_York',
    semester: null,
    week: 0,
  });
  assert.equal(note, '今天是 2026-03-15（星期日），时区 America/New_York。\n还没有学期。');
});

test('上下文说明：星期 1-7 依次为一至日', () => {
  const names = [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const note = contextNoteOf({ today: '2026-03-09', todayOfWeek: day, timeZone: 'Asia/Shanghai', semester: null, week: 0 });
    return /星期(.)/.exec(note)?.[1];
  });
  assert.deepEqual(names, ['一', '二', '三', '四', '五', '六', '日']);
});

// ---- 卡片 ----

test('新计划默认全选（高危也勾上），状态为待执行', () => {
  const cards = cardsOf([step('a'), step('b', 'danger')]);
  assert.deepEqual(ids(cards), ['a', 'b']);
  for (const card of cards) {
    assert.equal(card.checked, true);
    assert.equal(card.status, 'pending');
    assert.equal(card.message, null);
  }
});

test('勾选切换只作用于待执行的那张卡', () => {
  const cards = cardsOf([step('a'), step('b')]);
  const toggled = toggleCard(cards, 'a');
  assert.deepEqual(toggled.map((card) => card.checked), [false, true]);
  assert.deepEqual(toggleCard(toggled, 'a').map((card) => card.checked), [true, true]);
  assert.equal(cards[0]?.checked, true, '不改原数组');
  assert.deepEqual(toggleCard(cards, 'missing'), cards);
});

test('非待执行的卡不能切换勾选', () => {
  const base = cardsOf([step('a'), step('b'), step('c'), step('d')]);
  const statuses: PlanCard['status'][] = ['running', 'done', 'failed', 'skipped'];
  const cards = base.map((card, index) => ({ ...card, status: statuses[index]! }));
  for (const card of cards) {
    assert.deepEqual(toggleCard(cards, card.step.id), cards, card.status);
  }
});

test('待执行步骤按计划顺序，去掉未勾选与非待执行的', () => {
  let cards = cardsOf([step('a'), step('b'), step('c'), step('d'), step('e')]);
  cards = toggleCard(cards, 'b');
  cards = cards.map((card) => (card.step.id === 'd' ? { ...card, status: 'done' } : card));
  assert.deepEqual(
    selectedSteps(cards).map((item) => item.id),
    ['a', 'c', 'e'],
  );
  assert.deepEqual(selectedSteps([]), []);
});

test('hasDanger 只看传入的步骤', () => {
  assert.equal(hasDanger([]), false);
  assert.equal(hasDanger([step('a'), step('b')]), false);
  assert.equal(hasDanger([step('a'), step('b', 'danger')]), true);
});

test('markRunning 只把传入的步骤标为执行中', () => {
  const cards = cardsOf([step('a'), step('b'), step('c')]);
  const running = markRunning(cards, [step('a'), step('c')]);
  assert.deepEqual(running.map((card) => card.status), ['running', 'pending', 'running']);
  assert.deepEqual(running.map((card) => card.checked), [true, true, true]);
});

// ---- 执行结果 ----

test('执行结果：成功记摘要，失败记原因，其后的勾选项标为未执行，没跑的卡不变', () => {
  const plan = [step('a'), step('b'), step('c', 'danger'), step('d'), step('e')];
  let cards = toggleCard(cardsOf(plan), 'e');
  const steps = selectedSteps(cards);
  assert.deepEqual(steps.map((item) => item.id), ['a', 'b', 'c', 'd']);
  cards = markRunning(cards, steps);
  const execution: PlanExecution = {
    done: [{ step: steps[0]!, summary: '已新建待办「甲」' }],
    failed: { step: steps[1]!, message: '找不到学期' },
  };
  const result = applyExecution(cards, steps, execution);
  assert.deepEqual(
    result.map((card) => [card.step.id, card.status, card.message]),
    [
      ['a', 'done', '已新建待办「甲」'],
      ['b', 'failed', '找不到学期'],
      ['c', 'skipped', null],
      ['d', 'skipped', null],
      ['e', 'pending', null],
    ],
  );
  assert.equal(result[4], cards[4], '没跑的卡原样保留');
  assert.equal(result[4]?.checked, false);
});

test('执行结果：全部成功时都标为已完成', () => {
  const steps = [step('a'), step('b')];
  const cards = markRunning(cardsOf(steps), steps);
  const result = applyExecution(cards, steps, {
    done: steps.map((item) => ({ step: item, summary: `完成 ${item.id}` })),
    failed: null,
  });
  assert.deepEqual(result.map((card) => [card.status, card.message]), [
    ['done', '完成 a'],
    ['done', '完成 b'],
  ]);
});

test('执行结果：第一步就失败时其余勾选项都未执行', () => {
  const steps = [step('a'), step('b')];
  const cards = markRunning(cardsOf(steps), steps);
  const result = applyExecution(cards, steps, { done: [], failed: { step: steps[0]!, message: '失败了' } });
  assert.deepEqual(result.map((card) => [card.status, card.message]), [
    ['failed', '失败了'],
    ['skipped', null],
  ]);
});

test('多轮计划叠在一起时，只改这次执行的卡', () => {
  const earlier = applyExecution(cardsOf([step('t1-1')]), [step('t1-1')], {
    done: [{ step: step('t1-1'), summary: '旧结果' }],
    failed: null,
  });
  const cards = [...earlier, ...cardsOf([step('t2-1')])];
  const steps = selectedSteps(cards);
  assert.deepEqual(steps.map((item) => item.id), ['t2-1']);
  const result = applyExecution(cards, steps, { done: [{ step: steps[0]!, summary: '新结果' }], failed: null });
  assert.deepEqual(result.map((card) => card.message), ['旧结果', '新结果']);
});

test('未执行的卡恢复为待执行且不勾选，其余不变', () => {
  const cards: PlanCard[] = [
    { step: step('a'), checked: true, status: 'done', message: '好了' },
    { step: step('b'), checked: true, status: 'failed', message: '坏了' },
    { step: step('c'), checked: true, status: 'skipped', message: null },
    { step: step('d'), checked: false, status: 'pending', message: null },
  ];
  const reset = resetSkipped(cards);
  assert.deepEqual(reset.map((card) => [card.status, card.checked]), [
    ['done', true],
    ['failed', true],
    ['pending', false],
    ['pending', false],
  ]);
  assert.equal(reset[0], cards[0]);
  // 恢复后可以重新勾选执行
  assert.deepEqual(selectedSteps(toggleCard(reset, 'c')).map((item) => item.id), ['c']);
});
