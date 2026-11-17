import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_FLOW,
  applySelection,
  canGoBack,
  compactStepLabel,
  conflictInfo,
  fileKind,
  previewSummary,
  reduceFlow,
  visibleRowIndexes,
} from '../src/screens/import/import-flow-model.ts';

test('步骤状态机：选渠道进第 2 步，手动添加不占步骤', () => {
  const paste = reduceFlow(INITIAL_FLOW, { type: 'pick-channel', channel: 'paste' });
  assert.deepEqual(paste, { step: 2, channel: 'paste', pasteSource: 'page' });

  const window = reduceFlow(INITIAL_FLOW, { type: 'pick-channel', channel: 'window' });
  assert.equal(window.step, 2);
  assert.equal(window.channel, 'window');

  const manual = reduceFlow(INITIAL_FLOW, { type: 'pick-channel', channel: 'manual' });
  assert.deepEqual(manual, INITIAL_FLOW, '手动添加由宿主打开表单，流程仍停在第 1 步');
});

test('步骤状态机：解析成功进预览、上一步回取材、完成与重启', () => {
  const source = reduceFlow(INITIAL_FLOW, { type: 'pick-paste-source', source: 'file' });
  assert.equal(source.pasteSource, 'file');
  assert.equal(source.step, 2);

  const preview = reduceFlow(source, { type: 'accepted' });
  assert.equal(preview.step, 3);
  assert.equal(preview.pasteSource, 'file', '回退时保留原来的取材方式');

  assert.equal(reduceFlow(preview, { type: 'back' }).step, 2);
  assert.equal(reduceFlow(reduceFlow(preview, { type: 'back' }), { type: 'back' }).step, 1);

  const done = reduceFlow(preview, { type: 'done' });
  assert.equal(done.step, 4);
  assert.equal(reduceFlow(done, { type: 'back' }).step, 4, '完成页不响应上一步');
  assert.deepEqual(reduceFlow(done, { type: 'restart' }), INITIAL_FLOW);

  assert.equal(canGoBack(1), false);
  assert.equal(canGoBack(2), true);
  assert.equal(canGoBack(3), true);
  assert.equal(canGoBack(4), false);
});

test('窄屏步骤文案给出第几步与标题', () => {
  assert.equal(compactStepLabel(1), '第 1/4 步 · 选择方式');
  assert.equal(compactStepLabel(2), '第 2/4 步 · 获取课表');
  assert.equal(compactStepLabel(4), '第 4/4 步 · 完成');
});

test('冲突筛选只改可见下标，不改勾选语义', () => {
  const flags = [true, false, true];
  assert.deepEqual(visibleRowIndexes(3, flags, false), [0, 1, 2]);
  assert.deepEqual(visibleRowIndexes(3, flags, true), [0, 2]);
  // 预检未对齐时筛选不生效，避免闪一屏空列表
  assert.deepEqual(visibleRowIndexes(3, [true], true), [0, 1, 2]);
  assert.deepEqual(conflictInfo(3, flags, true), { known: true, conflictCount: 2, filtering: true });
  assert.deepEqual(conflictInfo(3, [], true), { known: false, conflictCount: 0, filtering: false });
});

test('批选只作用可见行，隐藏行的勾选保留', () => {
  const selected = new Set([1]);
  assert.deepEqual([...applySelection(selected, [0, 2], 'all')].sort(), [0, 1, 2]);
  assert.deepEqual([...applySelection(selected, [0, 2], 'none')], [1]);
  assert.deepEqual([...applySelection(selected, [0, 2], 'invert')].sort(), [0, 1, 2]);
  assert.deepEqual([...applySelection(selected, [], 'none')], [1]);
});

test('预览摘要与文件类型', () => {
  assert.equal(previewSummary(3, 2, 2, true), '解析到 3 条排课，已选 2 条 · 其中 2 条重复');
  assert.equal(previewSummary(1, 1, 0, true), '解析到 1 条排课，已选 1 条');
  assert.equal(fileKind('课表.XLSX'), 'sheet');
  assert.equal(fileKind('timetable.ics'), 'ics');
  assert.equal(fileKind('notes.pdf'), 'unknown');
});
