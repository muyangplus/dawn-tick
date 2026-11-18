import { BarChart3, Download, GraduationCap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAddActions } from '../../components/add-menu.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardTitle } from '../../components/ui/card.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { COUNT } from '../../copy/zh.ts';
import type { AppData } from '../../data.ts';
import { formatMonthDayRange } from '../../lib/dates.ts';
import { semesterReportCsv, semesterReportFileName } from '../../lib/semester-report.ts';
import { buildSemesterStats, semesterWeekText, type SemesterStats } from '../../lib/semester-stats.ts';
import { useNowTick } from '../../lib/use-now.ts';
import { saveText, toastSaved } from '../settings/file-export.ts';
import { defineCard } from './registry.ts';

/** 日程页「学期概览」卡片：课时、各周分布、课程进度与考试都由本机数据算出，不依赖服务端。 */
export const semesterStatsCard = defineCard({
  id: 'stats',
  scope: 'schedule',
  title: '学期概览',
  defaultZone: 'side',
  defaultOrder: 3,
  defaultVisible: true,
  render: (ctx) =>
    ctx.scope === 'schedule' ? <SemesterStatsCard data={ctx.data} onAddTodo={ctx.onAddTodo} /> : null,
});

export interface SemesterStatsCardProps {
  data: AppData;
  /** 没有全局「添加课程」桥（例如单测/冒烟直接挂载）时的兜底入口 */
  onAddTodo: () => void;
}

/** 卡片正文：每秒不需要刷新，分钟级节拍够用；数字随数据加载与日期变化更新。 */
export function SemesterStatsCard({ data, onAddTodo }: SemesterStatsCardProps) {
  const now = useNowTick(60_000);
  const addActions = useAddActions();
  const stats = buildSemesterStats(data, now);
  const addCourse = addActions?.course ?? onAddTodo;

  if (stats.empty) {
    return (
      <Card className="flex flex-col gap-3" data-role="semester-stats">
        <StatsHeader semester={null} />
        <div data-role="semester-stats-empty">
          <EmptyState
            icon={GraduationCap}
            size="sm"
            title="还没有课时与考试"
            description="添加课程后，这里会汇总课时与考试"
            action={
              <Button size="sm" variant="secondary" aria-label="去添加课程" onClick={addCourse}>
                去添加课程
              </Button>
            }
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3" data-role="semester-stats">
      <StatsHeader semester={stats.semester} />
      <LessonBlock stats={stats} />
      {stats.lessons.total > 0 && <WeekBlock weeks={stats.weeks} current={stats.semester} />}
      {stats.courses.length > 0 && <CourseBlock rows={stats.courses} />}
      <ExamBlock stats={stats} />
      <ReportExport stats={stats} semesterName={data.semester?.name ?? '学期'} today={data.today} />
    </Card>
  );
}

/** 导出学期报表（CSV）：内容与卡片同一口径。 */
function ReportExport({ stats, semesterName, today }: { stats: SemesterStats; semesterName: string; today: string }) {
  const [busy, setBusy] = useState(false);
  async function exportReport(): Promise<void> {
    setBusy(true);
    try {
      const result = await saveText(
        semesterReportFileName(today),
        semesterReportCsv(stats, semesterName),
        'csv',
        'CSV 文件',
        'text/csv',
      );
      if (result.saved) toastSaved('已导出学期报表', result.path);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      className="self-start"
      data-role="semester-stats-export"
      loading={busy}
      onClick={() => void exportReport()}
    >
      <Download className="size-4 shrink-0" aria-hidden />
      导出报表
    </Button>
  );
}

/** 卡头：标题 + 「第 N 周 / 共 M 周 · 起止」。 */
function StatsHeader({ semester }: { semester: SemesterStats['semester'] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 shrink-0 text-muted" aria-hidden />
        <CardTitle>学期概览</CardTitle>
      </div>
      <p className="text-xs text-muted" data-role="semester-stats-weeks">
        {semester === null
          ? '还没有学期数据'
          : `${semesterWeekText(semester)} · ${formatMonthDayRange(semester.startDate, semester.endDate)}`}
      </p>
    </div>
  );
}

/** 卡内分段：统一的标题 + 半透明底，侧栏里也能一眼分块。 */
function StatsSection({ title, role, children }: { title: string; role: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 rounded-md border border-line/70 bg-surface-muted/40 p-3" data-role={role}>
      <h4 className="text-xs font-semibold text-ink">{title}</h4>
      {children}
    </section>
  );
}

/** 课时：已上 / 待上。停课算已上。 */
function LessonBlock({ stats }: { stats: SemesterStats }) {
  const { lessons } = stats;
  return (
    <StatsSection title="课时" role="semester-stats-lessons">
      <p className="text-sm text-ink">
        已上 <span className="tabular font-semibold">{COUNT('lesson', lessons.past)}</span>
        <span className="text-muted"> · </span>
        待上 <span className="tabular font-semibold">{COUNT('lesson', lessons.upcoming)}</span>
      </p>
      <p className="text-xs text-muted">停课的课次计入已上</p>
    </StatsSection>
  );
}

/** 每周课时：堆叠柱（已上 / 待上），悬停或读屏给出该周数字。 */
function WeekBlock({ weeks, current }: { weeks: SemesterStats['weeks']; current: SemesterStats['semester'] }) {
  const max = Math.max(1, ...weeks.map((week) => week.past + week.upcoming));
  return (
    <StatsSection title="每周课时" role="semester-stats-weeks-chart">
      <div className="flex h-16 items-end gap-0.5" role="list" aria-label="每周课时">
        {weeks.map((week) => {
          const count = week.past + week.upcoming;
          const label = `第 ${week.week} 周：已上 ${week.past} 节，待上 ${week.upcoming} 节`;
          return (
            <div
              key={week.week}
              role="listitem"
              aria-label={label}
              title={label}
              data-current={current?.phase === 'during' && current.currentWeek === week.week ? 'true' : undefined}
              className="flex h-full min-w-0 flex-1 flex-col justify-end gap-px data-[current=true]:outline data-[current=true]:outline-1 data-[current=true]:outline-offset-1 data-[current=true]:outline-line-strong"
            >
              {week.upcoming > 0 && (
                <span className="block rounded-t-[2px] bg-line-strong" style={{ height: `${(week.upcoming / max) * 100}%` }} />
              )}
              {week.past > 0 && (
                <span
                  className={`block bg-primary ${week.upcoming > 0 ? '' : 'rounded-t-[2px]'}`}
                  style={{ height: `${(week.past / max) * 100}%` }}
                />
              )}
              {count === 0 && <span className="block h-px bg-line" />}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular">第 1 周</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-[2px] bg-primary" aria-hidden />
            已上
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-[2px] bg-line-strong" aria-hidden />
            待上
          </span>
        </span>
        <span className="tabular">第 {weeks.length} 周</span>
      </div>
    </StatsSection>
  );
}

const TOP_COURSES = 5;

/** 课程进度：课时最多的前 5 门，已上 / 总课时。 */
function CourseBlock({ rows }: { rows: SemesterStats['courses'] }) {
  return (
    <StatsSection title="课程进度" role="semester-stats-courses">
      <ul className="flex flex-col gap-1.5">
        {rows.slice(0, TOP_COURSES).map((row) => (
          <li key={row.courseId} className="flex flex-col gap-0.5 text-xs">
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
                <span className="truncate text-ink">{row.name}</span>
              </span>
              <span className="tabular shrink-0 text-muted">
                {row.done} / {COUNT('lesson', row.total)}
              </span>
            </span>
            <span className="block h-1 overflow-hidden rounded-full bg-line" aria-hidden>
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${row.total === 0 ? 0 : (row.done / row.total) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </StatsSection>
  );
}

/** 考试：条数、已考 / 待考与最近一场倒计时。 */
function ExamBlock({ stats }: { stats: SemesterStats }) {
  const { exams } = stats;
  return (
    <StatsSection title="考试" role="semester-stats-exams">
      {exams.total === 0 ? (
        <p className="text-xs text-muted">本学期还没有考试安排</p>
      ) : (
        <>
          <p className="text-sm text-ink">
            共 <span className="tabular font-semibold">{COUNT('event', exams.total)}</span>
            <span className="text-muted"> · </span>
            已考 <span className="tabular font-semibold">{exams.taken}</span>
            <span className="text-muted"> · </span>
            待考 <span className="tabular font-semibold">{exams.upcoming}</span>
          </p>
          <ExamTimeline items={exams.timeline} />
          {exams.next !== null && (
            <p className="text-xs text-muted" data-role="semester-stats-exam-next">
              最近一场「{exams.next.title}」
              {exams.next.daysUntil === 0 ? '就在今天' : `还有 ${exams.next.daysUntil} 天`}（
              {formatMonthDayRange(exams.next.date)}）
            </p>
          )}
        </>
      )}
    </StatsSection>
  );
}

/** 考试时间线：按日期排，已考的变淡。 */
function ExamTimeline({ items }: { items: SemesterStats['exams']['timeline'] }) {
  return (
    <ol className="flex flex-col gap-0.5" data-role="semester-stats-exam-timeline">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-2 text-xs" data-taken={item.taken}>
          <span className={item.taken ? 'truncate text-muted line-through' : 'truncate text-ink'}>{item.title}</span>
          <span className="tabular shrink-0 text-muted">
            {item.date === null ? '日期待定' : formatMonthDayRange(item.date)}
          </span>
        </li>
      ))}
    </ol>
  );
}
