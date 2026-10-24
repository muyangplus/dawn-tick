import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  CalendarDays,
  Clock,
  MonitorSmartphone,
  Palette,
} from 'lucide-react';
import type { AppSettings, SemesterRow, Storage, TimeSlotRow } from '@dawn-tick/core';
import { notifyNextStep } from '../notify-state.ts';
import type { ReminderView } from '../useReminders.ts';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { Dialog, DialogContent } from '../components/ui/dialog.tsx';
import { GroupedSettings, type SettingsGroup } from '../components/grouped-settings.tsx';
import { PendingRestartBar } from '../components/pending-restart-bar.tsx';
import { ImportFlow } from './import-flow.tsx';
import { AppearanceCard } from './settings/appearance-card.tsx';
import { RemindersCard } from './settings/reminders-card.tsx';
import { SemestersCard } from './settings/semesters-card.tsx';
import { SlotsCard } from './settings/slots-card.tsx';
import { TimeCard } from './settings/time-card.tsx';
import { TimetableCard } from './settings/timetable-card.tsx';
import { WidgetCard } from './settings/widget-card.tsx';
import { summarizeSettings } from './settings-group-summaries.ts';
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
 * 设置页：分组导航 + 下钻。
 *
 * 七组偏好各自在 `screens/settings/` 下独立成组件，页面只负责把「标题 / 摘要 / 图标 / 内容」
 * 交给 `GroupedSettings`：桌面左列常驻、右列只挂载当前分组；移动端先清单、点进子页再返回。
 * 摘要由纯函数 `summarizeSettings` 统一生成，避免在 JSX 里堆三元。
 * 通知权限状态仍由页面持有，顶部提示条与提醒分组看同一份。
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

  useEffect(() => {
    if (importSignal > 0) setImportDrawerOpen(true);
  }, [importSignal]);

  /** 通知权限：顶部提示条与提醒分组共用同一份 */
  const notify = useNotifyPermission(storage, reminders.request);
  const summaries = summarizeSettings({ settings, semesters, activeSemesterId, slots });

  const groups: SettingsGroup[] = [
    {
      id: 'semesters',
      title: '学期设置',
      summary: summaries.semesters,
      icon: BadgeCheck,
      content: (
        <Card className="p-4">
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
        </Card>
      ),
    },
    {
      id: 'reminders',
      title: '提醒设置',
      summary: summaries.reminders,
      icon: Bell,
      content: (
        <Card className="p-4">
          <RemindersCard settings={settings} onPatch={onPatch} reminders={reminders} notify={notify} />
        </Card>
      ),
    },
    {
      id: 'appearance',
      title: '外观与动效',
      summary: summaries.appearance,
      icon: Palette,
      content: (
        <Card className="p-4">
          <AppearanceCard settings={settings} onPatch={onPatch} />
        </Card>
      ),
    },
    {
      id: 'timetable',
      title: '课表显示',
      summary: summaries.timetable,
      icon: CalendarDays,
      content: (
        <Card className="p-4">
          <TimetableCard settings={settings} onPatch={onPatch} />
        </Card>
      ),
    },
    {
      id: 'slots',
      title: '作息与选校',
      summary: summaries.slots,
      icon: CalendarClock,
      content: (
        <Card className="p-4">
          <SlotsCard storage={storage} semesterId={activeSemesterId ?? ''} onChanged={onChanged} />
        </Card>
      ),
    },
    {
      id: 'widget',
      title: '悬浮窗与小组件',
      summary: summaries.widget,
      icon: MonitorSmartphone,
      content: (
        <Card className="p-4">
          <WidgetCard settings={settings} onPatch={onPatch} />
        </Card>
      ),
    },
    {
      id: 'time',
      title: '时间与日程',
      summary: summaries.time,
      icon: Clock,
      content: (
        <Card className="p-4">
          <TimeCard settings={settings} onPatch={onPatch} />
        </Card>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* 待重启与通知权限异常都只在设置页顶部呈现一次，各分组不再重复 */}
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

      <GroupedSettings pageTitle="设置" ariaLabel="设置分组" groups={groups} />

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
    </div>
  );
}
