import { BarChart3, GraduationCap } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAddActions } from '../../components/add-menu.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardTitle } from '../../components/ui/card.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { COUNT } from '../../copy/zh.ts';
import type { AppData } from '../../data.ts';
import { formatMonthDayRange } from '../../lib/dates.ts';
import { buildSemesterStats, semesterWeekText, type SemesterStats } from '../../lib/semester-stats.ts';
import { useNowTick } from '../../lib/use-now.ts';
import { defineCard } from './registry.ts';

/** 日程页「学期概览」卡片：课时、出勤估算与考试分布都由本机数据算出，不依赖服务端。 */
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
            description="添加课程后，这里会汇总课时、出勤与考试"
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
      {stats.ranking.length > 0 && <RankBlock rows={stats.ranking} />}
      <AttendanceBlock stats={stats} />
      <ExamBlock stats={stats} />
    </Card>
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

/** 课时：已上过 / 待上，停课单列说明。 */
function LessonBlock({ stats }: { stats: SemesterStats }) {
  const { lessons } = stats;
  return (
    <StatsSection title="课时" role="semester-stats-lessons">
      <p className="text-sm text-ink">
        已上过 <span className="tabular font-semibold">{COUNT('lesson', lessons.past)}</span>
        <span className="text-muted"> · </span>
        待上 <span className="tabular font-semibold">{COUNT('lesson', lessons.upcoming)}</span>
      </p>
      {lessons.cancelled > 0 && (
        <p className="text-xs text-muted">
          另有 <span className="tabular">{COUNT('lesson', lessons.cancelled)}</span> 已停课，不计入课时
        </p>
      )}
    </StatsSection>
  );
}

/** 各课程课时排行：前 5 名，按实际课次降序。 */
function RankBlock({ rows }: { rows: SemesterStats['ranking'] }) {
  return (
    <StatsSection title="课时排行" role="semester-stats-ranking">
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.courseId} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-ink">{row.name}</span>
            <span className="tabular shrink-0 text-muted">{COUNT('lesson', row.count)}</span>
          </li>
        ))}
      </ul>
    </StatsSection>
  );
}

/** 出勤估算：只做比例估算，不新增打卡。 */
function AttendanceBlock({ stats }: { stats: SemesterStats }) {
  const { attendance } = stats;
  return (
    <StatsSection title="出勤估算" role="semester-stats-attendance">
      {attendance.percent === null ? (
        <p className="text-xs text-muted">还没有已过的课程，暂无法估算</p>
      ) : (
        <>
          <p className="text-sm text-ink">
            约{' '}
            <span className="tabular text-base font-semibold text-primary-strong">{attendance.percent}%</span>{' '}
            的已过课程未停课
          </p>
          <p className="text-xs text-muted">
            按已过 <span className="tabular">{COUNT('lesson', attendance.total)}</span> 中未停课的比例估算，非打卡数据
          </p>
        </>
      )}
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
