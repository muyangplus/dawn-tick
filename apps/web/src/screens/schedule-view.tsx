import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { EventRow, Storage } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { AdjustDialog, type AdjustTarget } from '../components/adjust-dialog.tsx';
import { Button } from '../components/ui/button.tsx';
import { cardsInZone, renderCard, type LayoutConfig, type ScheduleCardContext } from './cards/registry.ts';
import { readLayout } from './cards/layout-store.ts';
import { actionsCard, countdownsCard, examsCard, timelineCard, tomorrowCard } from './cards/schedule-cards.tsx';

// 日程页的卡片在注册表里声明：显隐、顺序与区域都可由用户配置。
// 显式引用这几张卡片，注册先于首次渲染完成。
void [actionsCard, timelineCard, examsCard, countdownsCard, tomorrowCard];

export interface ScheduleViewProps {
  data: AppData;
  storage: Storage;
  onChanged: () => void;
  onAddTodo: () => void;
  onAddExam: () => void;
  /** 单击时间线里的日程：进入详情编辑 */
  onOpenEvent: (event: EventRow) => void;
  /** 某天没有日程时提示明日预告 */
  tomorrowPreview: boolean;
  /** 显示开学倒计时 */
  semesterCountdown: boolean;
  /** 显示下一个假期倒计时 */
  holidayCountdown: boolean;
}

/**
 * 日程页：默认视觉只有「顶部一行 + 主列时间线 + 侧列卡片」。
 * 加日程/加考试/课程调整收进「＋」，设为假日/连续假期/停课/顺延收进「⋯」。
 */
export function ScheduleView({
  data,
  storage,
  onChanged,
  onAddTodo,
  onAddExam,
  onOpenEvent,
  tomorrowPreview,
  semesterCountdown,
  holidayCountdown,
}: ScheduleViewProps) {
  const [viewDate, setViewDate] = useState(data.today);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [layout, setLayout] = useState<LayoutConfig>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readLayout(storage);
      if (!cancelled) setLayout(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const ctx: ScheduleCardContext = {
    scope: 'schedule',
    data,
    storage,
    layout,
    onLayoutChange: setLayout,
    viewDate,
    onViewDateChange: setViewDate,
    onAddTodo,
    onAddExam,
    onOpenEvent,
    onOpenAdjust: (target) => {
      setAdjustTarget(target);
      setAdjustOpen(true);
    },
    onChanged,
    semesterCountdown,
    holidayCountdown,
    tomorrowPreview,
  };

  const mainCards = cardsInZone('schedule', layout, 'main');
  const sideCards = cardsInZone('schedule', layout, 'side');

  return (
    <section className="flex flex-col gap-4" aria-label="日程视图">
      {mainCards.map((card) => (
        <div key={card.def.id} className="flex flex-col gap-4">
          {renderCard<'schedule'>(card, ctx)}
        </div>
      ))}

      {sideCards.length > 0 && (
        <aside className="flex flex-col gap-3 tablet:grid tablet:grid-cols-2" aria-label="日程侧栏">
          {sideCards.map((card) => (
            <div key={card.def.id} className="min-w-0">
              {renderCard<'schedule'>(card, ctx)}
            </div>
          ))}
        </aside>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="size-3 text-muted" aria-hidden />
        <span className="text-xs text-muted">
          今天第 {data.week} 周 · 共 {data.todayLessons.length} 节课 · {data.todos.length} 条待办
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChanged()}>
          刷新
        </Button>
      </div>

      <AdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        storage={storage}
        data={data}
        target={adjustTarget}
        onChanged={onChanged}
      />
    </section>
  );
}
