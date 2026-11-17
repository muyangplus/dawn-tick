import {
  EXAM_EMPTY_TEXT,
  examCountdownText,
  examWidgetView,
  type ExamWidgetSource,
} from './exam.ts';

export interface ExamWidgetBodyProps {
  exams: readonly ExamWidgetSource[];
  now: number;
  timeZone: string;
}

/**
 * exam 样式的正文：最近一场考试名 + 日期 + 剩余天数，多于一场时标注总场数。
 * 复用 mini 既有的标题/行/倒计时类名，窄条下与 bar 样式的排版语言一致。
 */
export function ExamWidgetBody({ exams, now, timeZone }: ExamWidgetBodyProps) {
  const view = examWidgetView(exams, now, timeZone);
  const next = view.next;
  if (next === null) {
    return (
      <div className="mini-empty" data-role="mini-exam-empty">
        {EXAM_EMPTY_TEXT}
      </div>
    );
  }
  return (
    <>
      <div className="mini-title" data-role="mini-exam-title">
        {next.title}
      </div>
      <div className="mini-row">
        <span className="mini-count" data-role="mini-exam-countdown">
          {examCountdownText(next.startAt, now)}
        </span>
        <span className="mini-meta" data-role="mini-exam-meta">
          {next.date}
          {view.total > 1 ? ` · 共 ${view.total} 场` : ''}
        </span>
      </div>
    </>
  );
}
