import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';
import type { AppSettings, SemesterRow, Storage, TimeSlotRow } from '@dawn-tick/core';
import { COUNT } from '../copy/zh.ts';
import { notifyNextStep } from '../notify-state.ts';
import type { ReminderView } from '../useReminders.ts';
import { cn } from '../lib/cn.ts';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { Dialog, DialogContent } from '../components/ui/dialog.tsx';
import { PendingRestartBar } from '../components/pending-restart-bar.tsx';
import { CardLayoutDialog } from './cards/layout-panel.tsx';
import { readLayout } from './cards/layout-store.ts';
import { cardsInZone, type LayoutConfig, type ResolvedCard } from './cards/registry.ts';
import { settingsSection } from './cards/settings-cards.tsx';
import { ImportFlow } from './import-flow.tsx';
import { AppearanceCard } from './settings/appearance-card.tsx';
import { RemindersCard } from './settings/reminders-card.tsx';
import { SemestersCard } from './settings/semesters-card.tsx';
import { useNotifyPermission } from './settings/use-notify-permission.ts';

export interface SettingsViewProps {
  storage: Storage;
  userId: string;
  settings: AppSettings;
  semesters: readonly SemesterRow[];
  activeSemesterId: string | null;
  activeStartDate: string;
  totalWeeks: number;
  slots: readonly TimeSlotRow[];
  reminders: ReminderView;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
  /** 课表空态点「导入课表」时递增，用于自动打开导入抽屉 */
  importSignal?: number;
}

/**
 * 设置页：只留布局、卡片注册表与页级弹窗外壳。
 *
 * 三张偏好卡片各自在 `screens/settings/` 下独立成组件，页面只负责按注册表把卡片放进主列/侧列；
 * 通知权限状态由页面持有，顶部提示条与提醒卡看同一份。
 */
export function SettingsView({
  storage,
  userId,
  settings,
  semesters,
  activeSemesterId,
  activeStartDate,
  totalWeeks,
  slots,
  reminders,
  onPatch,
  onChanged,
  importSignal = 0,
}: SettingsViewProps) {
  /** 顶部快捷动作打开的导入抽屉 */
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutConfig>({});
  const [layoutOpen, setLayoutOpen] = useState(false);

  useEffect(() => {
    if (importSignal > 0) setImportDrawerOpen(true);
  }, [importSignal]);

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

  /** 通知权限：顶部提示条、提醒卡角标与卡内状态行共用同一份 */
  const notify = useNotifyPermission(storage, reminders.request);

  const bodies: Record<string, ReactNode> = {
    semesters: (
      <SemestersCard
        storage={storage}
        userId={userId}
        settings={settings}
        semesters={semesters}
        activeSemesterId={activeSemesterId}
        activeStartDate={activeStartDate}
        totalWeeks={totalWeeks}
        slots={slots}
        onChanged={onChanged}
      />
    ),

    reminders: (
      <RemindersCard settings={settings} onPatch={onPatch} reminders={reminders} notify={notify} />
    ),

    appearance: <AppearanceCard settings={settings} onPatch={onPatch} />,
  };

  /** 设置页卡片：主列在上、侧列在右；侧列由顶部「卡片布局」切换，没有侧列时不占宽度。 */
  const mainCards = cardsInZone('settings', layout, 'main');
  const sideCards = cardsInZone('settings', layout, 'side');
  /** 两列只在主列与侧列都有卡片时生效：全部卡片都切到侧列时，侧列自己占满整行（P2-07） */
  const twoColumn = mainCards.length > 0 && sideCards.length > 0;

  const renderCard = (card: ResolvedCard): ReactNode => {
    const body = bodies[card.def.id];
    if (body === undefined) return null;
    const section = settingsSection(card.def.id);
    return (
      <CollapsibleCard
        key={card.def.id}
        id={card.def.id}
        title={card.def.title}
        {...(section === undefined ? {} : { icon: section.icon })}
        {...(card.def.id === 'semesters' ? { badge: COUNT('semester', semesters.length) } : {})}
        {...(card.def.id === 'reminders' && notify.abnormal
          ? { badge: <span className="text-danger-strong" data-role="notify-card-badge">通知未授权</span> }
          : {})}
      >
        {body}
      </CollapsibleCard>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 待重启与通知权限异常都只在设置页顶部呈现一次，各卡片不再重复 */}
      <PendingRestartBar />
      {notify.abnormal && (
        <div
          data-role="notify-banner"
          className="flex flex-wrap items-center gap-2 rounded-md border border-danger-strong/40 bg-danger-strong/10 px-3 py-2 text-xs text-danger-strong"
        >
          <span className="min-w-0 break-words">通知未授权，课前提醒不会弹出</span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={notifyNextStep(notify.view)}
            onClick={() => void notify.act(notify.view.action ?? 'request')}
          >
            {notifyNextStep(notify.view)}
          </Button>
        </div>
      )}
      {/* 设置页只留偏好类入口；导出 / 恢复快照 / 检查更新都归「设备与同步」 */}
      <div className="flex flex-wrap items-center gap-2" data-role="settings-actions">
        <Button size="sm" variant="primary" onClick={() => setImportDrawerOpen(true)}>
          导入课表
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-role="settings-toolbar">
        <Button
          size="sm"
          variant="secondary"
          aria-label="卡片布局"
          onClick={() => setLayoutOpen(true)}
        >
          <LayoutGrid className="size-4" aria-hidden />
          卡片布局
        </Button>
        <span className="text-xs text-muted">显示 / 隐藏卡片、调顺序与主侧列</span>
      </div>

      {/* P2-07：侧列只在有卡片时生效（desktop 两列 2fr/1fr），否则主列占满整行 */}
      <div
        className={cn('grid items-start gap-3', twoColumn && 'desktop:grid-cols-[2fr_1fr]')}
        data-role="settings-grid"
      >
        <div className="dt-stagger flex min-w-0 flex-col gap-3" data-role="settings-main">
          {mainCards.map(renderCard)}
        </div>
        {sideCards.length > 0 && (
          <aside
            className="dt-stagger flex min-w-0 flex-col gap-3"
            data-role="settings-side"
            aria-label="设置侧栏"
          >
            {sideCards.map(renderCard)}
          </aside>
        )}
      </div>

      <Dialog open={importDrawerOpen} onOpenChange={setImportDrawerOpen}>
        <DialogContent title="导入课表" description="网页课表 / 教务窗口 / ICS / CSV / Excel">
          <ImportFlow
            storage={storage}
            semesterId={activeSemesterId ?? ''}
            onManual={() => setImportDrawerOpen(false)}
            onDone={onChanged}
            onClose={() => {
              setImportDrawerOpen(false);
              onChanged();
            }}
          />
        </DialogContent>
      </Dialog>

      <CardLayoutDialog
        open={layoutOpen}
        onOpenChange={setLayoutOpen}
        layout={layout}
        onChange={setLayout}
        storage={storage}
      />
    </div>
  );
}
