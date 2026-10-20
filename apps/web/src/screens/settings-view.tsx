import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createSemester,
  deleteSemesterDeep,
  isValidTimeZone,
  updateSemester,
  type AppSettings,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { logInfo } from '../log.ts';
import { useAction } from '../lib/action.ts';
import { PeriodSettings } from '../components/period-settings.tsx';
import { CourseManager } from './course-manager.tsx';
import { ImportFlow } from './import-flow.tsx';
import { SchoolTimetableCard } from './school-timetable-card.tsx';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import {
  DangerDialog,
  Dialog,
  DialogContent,
  FormDialog,
} from '../components/ui/dialog.tsx';
import { COUNT, DELETE } from '../copy/zh.ts';
import { countForSemester, type SemesterCounts } from '../delete-counts.ts';
import { Field, Input } from '../components/ui/input.tsx';
import { PendingRestartBar } from '../components/pending-restart-bar.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { notifyNextStep } from '../notify-state.ts';
import type { ReminderView } from '../useReminders.ts';
import { cn } from '../lib/cn.ts';
import { CardLayoutDialog } from './cards/layout-panel.tsx';
import { readLayout } from './cards/layout-store.ts';
import { cardsInZone, type LayoutConfig, type ResolvedCard } from './cards/registry.ts';
import { settingsSection } from './cards/settings-cards.tsx';
import { AppearanceCard } from './settings/appearance-card.tsx';
import { RemindersCard } from './settings/reminders-card.tsx';
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
  const [semesterName, setSemesterName] = useState('');
  const [semesterStart, setSemesterStart] = useState('');
  const [semesterWeeks, setSemesterWeeks] = useState(20);
  async function requestRemoveSemester(semester: SemesterRow): Promise<void> {
    setRemoveCounts(await countForSemester(storage, semester.id));
    setRemoving(semester);
  }

  const { busy, run } = useAction();
  /** 顶部快捷动作打开的导入抽屉 */
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);

  useEffect(() => {
    if (importSignal > 0) setImportDrawerOpen(true);
  }, [importSignal]);
  const [editing, setEditing] = useState<SemesterRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editWeeks, setEditWeeks] = useState(20);
  const [editZone, setEditZone] = useState('');
  const [removing, setRemoving] = useState<SemesterRow | null>(null);
  /** 删除学期确认句里的逐类行数 */
  const [removeCounts, setRemoveCounts] = useState<SemesterCounts | null>(null);
  const [layout, setLayout] = useState<LayoutConfig>({});
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** 通知权限：顶部提示条、提醒卡角标与卡内状态行共用同一份 */
  const notify = useNotifyPermission(storage, reminders.request);
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

  function startEdit(semester: SemesterRow): void {
    setEditing(semester);
    setEditName(semester.name);
    setEditStart(semester.start_date);
    setEditWeeks(semester.total_weeks);
    setEditZone(semester.time_zone);
  }

  async function saveEdit(): Promise<void> {
    if (editing === null) return;
    if (editName.trim().length === 0 || editStart.length === 0 || !isValidTimeZone(editZone)) {
      toast.error('请检查学期名称、开学日期与时区');
      return;
    }
    const target = editing;
    await run({
      scope: 'semester',
      label: '正在保存学期设置…',
      ok: '已保存学期设置',
      fail: { what: '保存学期设置失败', next: '请重试；仍失败请重开应用后再改。' },
      task: async () => {
        await updateSemester(storage, target.id, {
          name: editName.trim(),
          start_date: editStart,
          total_weeks: Math.min(30, Math.max(1, editWeeks)),
          time_zone: editZone,
        });
        logInfo('semester', '修改学期', {
          id: target.id,
          startDate: editStart,
          totalWeeks: editWeeks,
          timeZone: editZone,
        });
        setEditing(null);
        onChanged();
      },
    });
  }

  async function confirmRemove(): Promise<void> {
    if (removing === null) return;
    const target = removing;
    await run({
      scope: 'semester',
      label: '正在删除学期…',
      fail: { what: '删除学期失败', next: '请重试；仍失败请重开应用后再删。' },
      task: async () => {
        const report = await deleteSemesterDeep(storage, target.id);
        logInfo('semester', '删除学期', { id: target.id, ...report });
        toast.success(
          `已删除「${target.name}」：课程 ${COUNT('course', report.courses)}、排课 ${COUNT('schedule', report.schedules)}、节次 ${COUNT('period', report.slots)}、日程 ${COUNT('event', report.events)}、提醒 ${COUNT('reminder', report.reminders)}`,
        );
        setRemoving(null);
        onChanged();
      },
    });
  }

  async function addSemester(): Promise<void> {
    if (semesterName.trim().length === 0 || semesterStart.length === 0) return;
    await run({
      scope: 'semester',
      label: '正在新建学期…',
      ok: '已新建学期并设为当前学期',
      fail: { what: '新建学期失败', next: '请重试；仍失败请重开应用后再试。' },
      task: async () => {
        await createSemester(storage, {
          userId,
          name: semesterName.trim(),
          startDate: semesterStart,
          totalWeeks: semesterWeeks,
          timeZone: settings.timeZone,
        });
        logInfo('semester', '新建学期', {
          name: semesterName.trim(),
          startDate: semesterStart,
          totalWeeks: semesterWeeks,
        });
        setSemesterName('');
        onChanged();
      },
    });
  }

  async function activate(id: string): Promise<void> {
    await run({
      scope: 'semester',
      label: '正在切换当前学期…',
      ok: '已切换当前学期',
      fail: { what: '切换学期失败', next: '请重试；仍失败请重开应用后再试。' },
      task: async () => {
        for (const semester of semesters) {
          if (semester.is_active === 1 && semester.id !== id) {
            await updateSemester(storage, semester.id, { is_active: 0 });
          }
        }
        await updateSemester(storage, id, { is_active: 1 });
        onChanged();
      },
    });
  }

  const bodies: Record<string, ReactNode> = {
    semesters: (
      <>
        {semesters.length === 0 ? (
          <EmptyState size="sm" tone="muted" title="还没有学期，先在上面新建一个" />
        ) : (
          <ul className="flex flex-col gap-1">
            {semesters.map((semester) => (
              <li key={semester.id} className="flex min-h-tap items-center justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-ink">{semester.name}</span>
                  <span className="tabular truncate text-xs text-muted">
                    {semester.start_date} 起 · {semester.total_weeks} 周 · {semester.time_zone}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {semester.id === activeSemesterId ? (
                    <span className="text-xs text-primary-strong">当前</span>
                  ) : (
                    <Button size="sm" variant="secondary" loading={busy} onClick={() => void activate(semester.id)}>
                      切换
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`编辑学期 ${semester.name}`}
                    disabled={busy}
                    onClick={() => startEdit(semester)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`删除学期 ${semester.name}`}
                    disabled={busy}
                    onClick={() => void requestRemoveSemester(semester)}
                  >
                    <Trash2 className="size-4 text-danger-strong" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <details className="flex flex-col gap-2">
          <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm text-ink">
            <Plus className="size-4" aria-hidden />
            新建学期
          </summary>
          <div className="flex flex-col gap-2 pt-2">
            <Field label="学期名称">
              <Input value={semesterName} onChange={(event) => setSemesterName(event.target.value)} />
            </Field>
            <Field label="开学日期">
              <Input type="date" value={semesterStart} onChange={(event) => setSemesterStart(event.target.value)} />
            </Field>
            <Field label="总周数">
              <Input
                type="number"
                min={1}
                max={30}
                value={semesterWeeks}
                onChange={(event) => setSemesterWeeks(Number(event.target.value))}
              />
            </Field>
            <Button variant="primary" size="sm" loading={busy} onClick={() => void addSemester()}>
              创建并切换
            </Button>
          </div>
        </details>
        <PeriodSettings storage={storage} semesterId={activeSemesterId ?? ''} onChanged={onChanged} />
        {/* 选校体验与导入流程统一：同一个 SchoolPicker，选中后套用该校作息或通用作息 */}
        <SchoolTimetableCard storage={storage} semesterId={activeSemesterId ?? ''} onChanged={onChanged} />
        {activeSemesterId !== null && (
          <CourseManager
            storage={storage}
            semesterId={activeSemesterId}
            preset={settings.themePreset}
            slots={slots}
            semesterStart={activeStartDate}
            totalWeeks={totalWeeks}
            onChanged={onChanged}
          />
        )}
      </>
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
        <div className="flex min-w-0 flex-col gap-3" data-role="settings-main">
          {mainCards.map(renderCard)}
        </div>
        {sideCards.length > 0 && (
          <aside
            className="flex min-w-0 flex-col gap-3"
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

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title="编辑学期"
        description="修改会立即影响周次与课表计算"
        submitLabel="保存"
        submitting={busy}
        onSubmit={() => void saveEdit()}
      >
        <Field label="学期名称">
          <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
        </Field>
        <Field label="开学日期" hint="该周记为第 1 周">
          <Input type="date" value={editStart} onChange={(event) => setEditStart(event.target.value)} />
        </Field>
        <Field label="总周数">
          <Input
            type="number"
            min={1}
            max={30}
            value={editWeeks}
            onChange={(event) => setEditWeeks(Number(event.target.value))}
          />
        </Field>
        <Field label="时区" error={!isValidTimeZone(editZone) ? '时区名无效' : undefined}>
          <Input value={editZone} onChange={(event) => setEditZone(event.target.value)} />
        </Field>
      </FormDialog>

      <DangerDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="删除学期"
        description={
          removing === null
            ? ''
            : DELETE(removing.name, [
                `课程 ${COUNT('course', removeCounts?.courses ?? 0)}`,
                `排课 ${COUNT('schedule', removeCounts?.schedules ?? 0)}`,
                `节次 ${COUNT('period', removeCounts?.slots ?? 0)}`,
                `日程 ${COUNT('event', removeCounts?.events ?? 0)}`,
                `提醒 ${COUNT('reminder', removeCounts?.reminders ?? 0)}`,
              ])
        }
        submitting={busy}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
