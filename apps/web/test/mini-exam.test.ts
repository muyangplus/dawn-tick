import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAM_EMPTY_TEXT,
  examCountdownText,
  examWidgetView,
  type ExamWidgetSource,
} from '../src/mini/exam.ts';

const TZ = 'Asia/Shanghai';
const NOW = Date.parse('2026-10-18T18:30:00+08:00');

const at = (text: string): number => Date.parse(text);

function exam(title: string, onDate: string | null, startAt: number | null): ExamWidgetSource {
  return { title, on_date: onDate, start_at: startAt };
}

test('考试倒计时：无考试时给空态，不产生下一场', () => {
  const view = examWidgetView([], NOW, TZ);
  assert.equal(view.next, null);
  assert.equal(view.total, 0);
  assert.equal(EXAM_EMPTY_TEXT, '暂无考试');
});

test('考试倒计时：按开考时间取最近一场，只统计未过期考试', () => {
  const view = examWidgetView(
    [
      exam('大学英语四级', '2026-10-25', at('2026-10-25T09:00:00+08:00')),
      // 乱序输入也要按时间排
      exam('高等数学期末', '2026-10-21', at('2026-10-21T09:00:00+08:00')),
      // 已过当天：不再算下一场
      exam('已过期考试', '2026-10-01', at('2026-10-01T09:00:00+08:00')),
      // 没有开考时间的考试不进倒计时
      exam('待定考试', '2026-11-01', null),
    ],
    NOW,
    TZ,
  );
  assert.equal(view.next?.title, '高等数学期末');
  assert.equal(view.next?.date, '10/21');
  assert.equal(view.total, 2);
  assert.equal(examCountdownText(view.next?.startAt ?? 0, NOW), '还有 3 天');
});

test('考试倒计时：考试当天仍显示，文案为「就是今天」', () => {
  const sameDay = exam('今日上午考试', '2026-10-18', at('2026-10-18T08:00:00+08:00'));
  const view = examWidgetView([sameDay], NOW, TZ);
  assert.equal(view.next?.title, '今日上午考试');
  assert.equal(examCountdownText(view.next?.startAt ?? 0, NOW), '就是今天');
});

test('考试倒计时：缺日期用开考时间换算，异常日期回退开考时间', () => {
  const missing = examWidgetView(
    [exam('无日期考试', null, at('2026-10-20T09:00:00+08:00'))],
    NOW,
    TZ,
  );
  assert.equal(missing.next?.date, '10/20');
  const broken = examWidgetView(
    [exam('日期写坏', 'not-a-date', at('2026-10-22T09:00:00+08:00'))],
    NOW,
    TZ,
  );
  assert.equal(broken.next?.date, '10/22');
});

test('考试倒计时：非有限/非正开考时间被忽略', () => {
  const view = examWidgetView(
    [
      exam('零值', '2026-10-20', 0),
      exam('NaN', '2026-10-20', Number.NaN),
      exam('Infinity', '2026-10-20', Number.POSITIVE_INFINITY),
    ],
    NOW,
    TZ,
  );
  assert.equal(view.next, null);
  assert.equal(view.total, 0);
});
