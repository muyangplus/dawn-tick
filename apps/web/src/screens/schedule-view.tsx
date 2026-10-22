import { useEffect, useState } from 'react';
import type { EventRow, Storage } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { AdjustDialog, type AdjustTarget } from '../components/adjust-dialog.tsx';
import { cardsInZone, renderCard, type LayoutConfig, type ScheduleCardContext } from './cards/registry.ts';
import { readLayout } from './cards/layout-store.ts';
import { actionsCard, examsCard, timelineCard, tomorrowCard } from './cards/schedule-cards.tsx';
import { semesterStatsCard } from './cards/semester-stats-card.tsx';
import { useScheduleActions } from './cards/use-schedule-actions.ts';

// 显式引用这几张卡片，保证注册先于首次渲染完成。
void [actionsCard, timelineCard, examsCard, tomorrowCard, semesterStatsCard];

export interface ScheduleViewProps {
  data: AppData;
  storage: Storage;
  onChanged: () => void;
  /** 查看的日期：由 App 持有，搜索命中时可直接定位到那一天 */
  viewDate: string;
  onViewDateChange: (date: string) => void;
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

/** 日程页：默认只有顶部一行 + 主列时间线 + 侧列卡片；加日程/考试/调课收进「＋」，假日类收进「⋯」。 */
export function ScheduleView({
  data,
  storage,
  onChanged,
  viewDate,
  onViewDateChange,
  onAddTodo,
  onAddExam,
  onOpenEvent,
  tomorrowPreview,
  semesterCountdown,
  holidayCountdown,
}: ScheduleViewProps) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [layout, setLayout] = useState<LayoutConfig>({});
  // 卡片写库统一入口：卡片拿到的是 intent，不直接持有 core 的 mutations
  const actions = useScheduleActions({ storage, data, onChanged });

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
    onViewDateChange,
    onAddTodo,
    onAddExam,
    onOpenEvent,
    onOpenAdjust: (target) => {
      setAdjustTarget(target);
      setAdjustOpen(true);
    },
    onChanged,
    actions,
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
