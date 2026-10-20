import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  MOTION_LABEL,
  MOTION_MODES,
  THEME_PRESETS,
  VIEW_DAY_OPTIONS,
  WIDGET_BACKGROUNDS,
  WIDGET_VARIANTS,
  createSemester,
  deleteSemesterDeep,
  formatDateTime,
  isValidTimeZone,
  updateSemester,
  type AppSettings,
  type SemesterRow,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
  type WidgetBackground,
  type WidgetVariant,
  type TodoSort,
  type MotionMode,
} from '@dawn-tick/core';
import { PRESETS } from '../design/tokens.ts';
import { logInfo } from '../log.ts';
import { canUseWidget, hideWidget, showWidget } from '../widget-window.ts';
import {
  MOBILE_WIDGETS,
  hasMobileWidgets,
  pinWidget,
  readMobileWidgetStates,
  type MobileWidgetState,
  type PinWidgetStatus,
} from '../widget-pin.ts';
import {
  isIgnoringBatteryOptimizations,
  openNotifySettings,
  requestIgnoreBatteryOptimizations,
} from '../system-actions.ts';
import {
  exactAlarmState,
  readNotifyStatus,
  requestExactAlarm,
  type ExactAlarmState,
  type NotifyStatus,
} from '../permissions.ts';
import { detectPlatform } from '../platform-detect.ts';
import { PeriodSettings } from '../components/period-settings.tsx';
import { StartupSettings } from '../components/startup-settings.tsx';
import { isAutoStartSupported } from '../autostart.ts';
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
import { COUNT, DELETE, fail } from '../copy/zh.ts';
import { countForSemester, type SemesterCounts } from '../delete-counts.ts';
import { Field, Input } from '../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SwitchField,
} from '../components/ui/controls.tsx';
import { StatusLine } from '../components/ui/status-line.tsx';
import { PendingRestartBar } from '../components/pending-restart-bar.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { isNotifyAbnormal, notifyNextStep, notifyStateOf } from '../notify-state.ts';
import type { ReminderView } from '../useReminders.ts';
import { cn } from '../lib/cn.ts';
import { CardLayoutDialog } from './cards/layout-panel.tsx';
import { readLayout } from './cards/layout-store.ts';
import { cardsInZone, type LayoutConfig, type ResolvedCard } from './cards/registry.ts';
import { settingsSection } from './cards/settings-cards.tsx';

/** 一键添加的结果文案：先给事实，再给下一步。 */
const PIN_STATUS_LABEL: Record<PinWidgetStatus, string> = {
  added: '已添加到主屏',
  'already-added': '已在主屏上',
  cancelled: '没收到系统确认，请长按主屏添加',
  unsupported: '启动器不支持，请长按主屏添加',
  disabled: '小组件被停用，请在系统设置启用',
  rejected: '系统没接受请求，请长按主屏添加',
  error: '添加失败，请长按主屏添加',
};

const THEME_LABEL: Record<ThemePreset, string> = {
  vivid: '青春活力',
  fresh: '清爽学院',
  mono: '极简墨色',
  muted: '莫兰迪柔光',
};

const WIDGET_LABEL: Record<WidgetBackground, string> = {
  light: '浅色',
  dark: '深色',
  transparent: '透明',
};

/** 时区候选：常用 IANA 时区，默认上海；系统时区不在列表里时会额外补一项。 */
export const TIME_ZONE_OPTIONS: readonly string[] = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

const WIDGET_VARIANT_LABEL: Record<WidgetVariant, string> = {
  bar: '紧凑条：下一节课 + 倒计时',
  today: '今日课表：今天的课，当前课高亮',
  minimal: '极简数字：只显示大号倒计时',
  combo: '组合卡：下一节课 + 待办作业',
};

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
  const [trayStatus, setTrayStatus] = useState<string | null>(null);
  async function requestRemoveSemester(semester: SemesterRow): Promise<void> {
    setRemoveCounts(await countForSemester(storage, semester.id));
    setRemoving(semester);
  }

  useEffect(() => {
    if (!canUseWidget()) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<{ created: boolean; detail: string }>('tray_status');
        setTrayStatus(`${status.created ? '已创建' : '创建失败'}（${status.detail}）`);
      } catch (cause: unknown) {
        setTrayStatus(`不可用（${cause instanceof Error ? cause.message : String(cause)}）`);
      }
    })();
  }, []);

  const [busy, setBusy] = useState(false);
  /** 正在等系统确认的尺寸：按钮转圈，避免重复点 */
  const [pinPending, setPinPending] = useState<MobileWidgetState['id'] | null>(null);
  /** 每种尺寸在桌面上的状态（已添加 / 被停用） */
  const [pinStates, setPinStates] = useState<MobileWidgetState[] | null>(null);
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
  const zoneInvalid = !isValidTimeZone(settings.timeZone);
  /** 安卓权限状态：精确闹钟与电池优化白名单（通知状态全平台都读） */
  const [alarmState, setAlarmState] = useState<ExactAlarmState>('unsupported');
  const [batteryFree, setBatteryFree] = useState<boolean | null>(null);
  /** 通知状态：应用级开关、运行时权限、渠道静音分开报 */
  const [notifyStatus, setNotifyStatus] = useState<NotifyStatus | null>(null);
  const androidApp = detectPlatform() === 'capacitor';
  useEffect(() => {
    let cancelled = false;
    const refreshNotify = (): void => {
      void readNotifyStatus(storage).then((status) => {
        if (!cancelled) setNotifyStatus(status);
      });
    };
    refreshNotify();
    // 从系统设置页回到应用时重新读一次：用户可能刚开了通知或改了权限
    globalThis.addEventListener('focus', refreshNotify);
    return () => {
      cancelled = true;
      globalThis.removeEventListener('focus', refreshNotify);
    };
  }, [storage]);
  useEffect(() => {
    if (!androidApp) return;
    let cancelled = false;
    void (async () => {
      const [alarm, ignoring, states] = await Promise.all([
        exactAlarmState(),
        isIgnoringBatteryOptimizations(),
        readMobileWidgetStates(),
      ]);
      if (!cancelled) {
        setAlarmState(alarm);
        setBatteryFree(ignoring);
        setPinStates(states);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [androidApp]);
  /** 全平台共用六态：按钮由状态给出，不再按平台各写一套词 */
  const notifyState = notifyStateOf(notifyStatus);
  const notifyAbnormal = isNotifyAbnormal(notifyState);
  /** 权限状态点：已允许绿色、异常红色、其余灰色 */
  const notifyDotClass =
    notifyState.state === 'granted' ? 'bg-success-strong' : notifyAbnormal ? 'bg-danger-strong' : 'bg-line';
  async function runNotifyAction(action: 'request' | 'settings'): Promise<void> {
    if (action === 'request') {
      await reminders.request();
      const next = await readNotifyStatus(storage);
      setNotifyStatus(next);
      toast.info(`通知权限：${notifyStateOf(next).label}`);
      return;
    }
    const opened = await openNotifySettings(notifyStatus?.channelMuted === true ? notifyStatus.channelId : null);
    if (!opened) {
      toast.error(fail('打开系统设置', null, '请手动到系统设置里开启通知'));
    }
    setNotifyStatus(await readNotifyStatus(storage));
  }
  /** 请求把一种尺寸的小组件添加到桌面：动作结果走 toast，等系统确认后再给结果。 */
  async function addWidget(id: MobileWidgetState['id']): Promise<void> {
    setPinPending(id);
    const result = await pinWidget(id);
    setPinPending(null);
    if (result.status === 'added' || result.status === 'already-added') {
      toast.success(PIN_STATUS_LABEL[result.status]);
      const states = await readMobileWidgetStates();
      if (states !== null) setPinStates(states);
      return;
    }
    toast.info(PIN_STATUS_LABEL[result.status]);
  }
  const next = reminders.upcoming[0];

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
    setBusy(true);
    try {
      await updateSemester(storage, editing.id, {
        name: editName.trim(),
        start_date: editStart,
        total_weeks: Math.min(30, Math.max(1, editWeeks)),
        time_zone: editZone,
      });
      logInfo('semester', '修改学期', {
        id: editing.id,
        startDate: editStart,
        totalWeeks: editWeeks,
        timeZone: editZone,
      });
      toast.success('已保存学期设置');
      setEditing(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (removing === null) return;
    setBusy(true);
    try {
      const report = await deleteSemesterDeep(storage, removing.id);
      logInfo('semester', '删除学期', { id: removing.id, ...report });
      toast.success(
        `已删除「${removing.name}」：课程 ${COUNT('course', report.courses)}、排课 ${COUNT('schedule', report.schedules)}、节次 ${COUNT('period', report.slots)}、日程 ${COUNT('event', report.events)}、提醒 ${COUNT('reminder', report.reminders)}`,
      );
      setRemoving(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addSemester(): Promise<void> {
    if (semesterName.trim().length === 0 || semesterStart.length === 0) return;
    setBusy(true);
    try {
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
      toast.success('已新建学期并设为当前学期');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string): Promise<void> {
    setBusy(true);
    try {
      for (const semester of semesters) {
        if (semester.is_active === 1 && semester.id !== id) {
          await updateSemester(storage, semester.id, { is_active: 0 });
        }
      }
      await updateSemester(storage, id, { is_active: 1 });
      toast.success('已切换当前学期');
      onChanged();
    } finally {
      setBusy(false);
    }
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
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void activate(semester.id)}>
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
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void addSemester()}>
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
      <>
        <StatusLine
          dataRole="notify-permission"
          action={
            notifyState.action !== null && (
              <Button
                size="sm"
                variant="secondary"
                aria-label={notifyState.action === 'request' ? '申请通知权限' : '去系统设置'}
                onClick={() => void runNotifyAction(notifyState.action as 'request' | 'settings')}
              >
                {notifyState.action === 'request' ? '申请通知权限' : '去系统设置'}
              </Button>
            )
          }
        >
          <span className={`mr-1 inline-block size-2 rounded-full ${notifyDotClass}`} data-role="notify-status-dot" aria-hidden />
          通知权限：{notifyState.label}
        </StatusLine>
        <span className="text-xs text-muted">关闭后不再提醒</span>
        {androidApp && (
          <>
            <StatusLine
              dataRole="exact-alarm-status"
              action={
                alarmState === 'denied' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="开启精确闹钟"
                    onClick={() =>
                      void (async () => {
                        await requestExactAlarm();
                        const next = await exactAlarmState();
                        setAlarmState(next);
                        if (next === 'granted') toast.success('已开启精确闹钟');
                        else toast.info('精确闹钟仍未开启，请到系统设置里允许');
                      })()
                    }
                  >
                    去开启
                  </Button>
                )
              }
            >
              精确闹钟：{alarmState === 'granted' ? '已开启' : alarmState === 'denied' ? '未开启' : '不适用'}
            </StatusLine>
            <StatusLine
              dataRole="battery-optimization-status"
              action={
                batteryFree === false && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="申请加入电池优化白名单"
                    onClick={() =>
                      void (async () => {
                        await requestIgnoreBatteryOptimizations();
                        const next = await isIgnoringBatteryOptimizations();
                        setBatteryFree(next);
                        if (next === true) toast.success('已加入电池优化白名单');
                        else toast.info('仍未加入白名单，提醒可能延后');
                      })()
                    }
                  >
                    去设置
                  </Button>
                )
              }
            >
              后台运行：{batteryFree === null ? '读取中…' : batteryFree ? '已加入电池优化白名单' : '受电池优化限制，提醒可能延后'}
            </StatusLine>
          </>
        )}
        <SwitchField
          label="课前提醒"
          description="所有课程默认提醒，可在课程详情里单独设置"
          checked={settings.classReminderEnabled}
          onCheckedChange={(checked) => void onPatch({ classReminderEnabled: checked })}
          ariaLabel="课前提醒"
        />
        <Field label="默认提前">
          <div className="flex flex-wrap items-center gap-2">
            {[5, 10, 15, 20, 30].map((minutes) => (
              <Button
                key={minutes}
                size="sm"
                variant={settings.classReminderMinutes === minutes ? 'primary' : 'secondary'}
                aria-label={`提前 ${COUNT('minute', minutes)}`}
                disabled={!settings.classReminderEnabled}
                onClick={() => void onPatch({ classReminderMinutes: minutes })}
              >
                {COUNT('minute', minutes)}
              </Button>
            ))}
            <Input
              type="number"
              min={1}
              max={180}
              className="w-24"
              aria-label="自定义提前分钟"
              disabled={!settings.classReminderEnabled}
              value={String(settings.classReminderMinutes)}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1 && value <= 180) {
                  void onPatch({ classReminderMinutes: Math.round(value) });
                }
              }}
            />
          </div>
        </Field>
        <span className="text-xs text-muted">
          接下来 7 天待提醒 {COUNT('reminder', reminders.upcoming.length)}
          {next !== undefined && ` · 最近 ${formatDateTime(next.triggerAt, settings.timeZone)} ${next.title}`}
        </span>
      </>
    ),

    appearance: (
      <>
        <Field label="主题风格">
          <Select
            value={settings.themePreset}
            onValueChange={(value) => void onPatch({ themePreset: value as ThemePreset })}
          >
            <SelectTrigger aria-label="主题风格">
              <span>{THEME_LABEL[settings.themePreset]}</span>
            </SelectTrigger>
            <SelectContent>
              {THEME_PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {PRESETS[preset].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="深浅模式">
          <Select
            value={settings.theme}
            onValueChange={(value) => void onPatch({ theme: value as AppSettings['theme'] })}
          >
            <SelectTrigger aria-label="深浅模式">
              <span>
                {settings.theme === 'system' ? '跟随系统' : settings.theme === 'dark' ? '深色' : '浅色'}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="light">浅色</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="周视图天数" hint="1–7 天" help="列宽按屏宽等分，不横向滚动">
          <Select value={String(settings.viewDays)} onValueChange={(value) => void onPatch({ viewDays: Number(value) })}>
            <SelectTrigger aria-label="周视图天数">
              <span>{settings.viewDays} 天</span>
            </SelectTrigger>
            <SelectContent>
              {VIEW_DAY_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {days} 天
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <SwitchField
          label="今天为第一天"
          description="关掉从本周周一开头"
          checked={settings.weekStartsToday}
          onCheckedChange={(checked) => void onPatch({ weekStartsToday: checked })}
          ariaLabel="今天为第一天"
        />
        <SwitchField
          label="始终不显示周末"
          description="跳过周六日，列数按天数"
          checked={settings.hideWeekends}
          onCheckedChange={(checked) => void onPatch({ hideWeekends: checked })}
          ariaLabel="始终不显示周末"
        />
        <Field label="界面动效" hint="页面与弹窗过渡" help="跟随系统时遵守系统的「减少动态效果」">
          <Select value={settings.motion} onValueChange={(value) => void onPatch({ motion: value as MotionMode })}>
            <SelectTrigger aria-label="界面动效">
              <span>{MOTION_LABEL[settings.motion]}</span>
            </SelectTrigger>
            <SelectContent>
              {MOTION_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {MOTION_LABEL[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <SwitchField
          label="周视图显示非本周课程"
          description="这一周不上的课用虚线框标出"
          checked={settings.showOtherWeeks}
          onCheckedChange={(checked) => void onPatch({ showOtherWeeks: checked })}
          ariaLabel="周视图显示非本周课程"
        />
        {hasMobileWidgets() ? (
          <div className="flex flex-col gap-2" data-role="mobile-widget-guide">
            <span className="text-sm text-ink">主屏小组件</span>
            <span className="text-xs text-muted">
              主屏长按 → 小组件 → 晓刻
            </span>
            {MOBILE_WIDGETS.map((widget) => {
              const state = pinStates?.find((item) => item.id === widget.id) ?? null;
              return (
                <div
                  key={widget.id}
                  className="flex flex-col gap-1 rounded-md border border-line bg-surface p-2"
                  data-role="mobile-widget-row"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-ink">
                        {widget.label}
                        <span className="ml-1 text-xs text-muted">{widget.size}</span>
                      </span>
                      <span className="truncate text-xs text-muted">{widget.description}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {state?.added === true && (
                        <span className="text-xs text-muted" data-role="widget-added">
                          已添加
                        </span>
                      )}
                      {state?.disabled === true && (
                        <span className="text-xs text-danger-strong" data-role="widget-disabled">
                          已停用
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`添加小组件到主屏：${widget.label}`}
                        loading={pinPending === widget.id}
                        disabled={pinPending !== null && pinPending !== widget.id}
                        onClick={() => void addWidget(widget.id)}
                      >
                        添加到主屏
                      </Button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>悬浮窗</span>
            <span className="truncate text-xs text-muted">无边框置顶小条，显示下一节课与倒计时</span>
          </span>
          {canUseWidget() ? (
            <span className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-label="显示悬浮窗"
                onClick={() =>
                  void showWidget(settings.widgetVariant).then((ok) => {
                    if (ok) toast.success('已显示悬浮窗');
                    else toast.error(fail('显示悬浮窗', null, '请重试'));
                  })
                }
              >
                显示
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="隐藏悬浮窗"
                onClick={() => void hideWidget().then(() => toast.success('已隐藏悬浮窗'))}
              >
                隐藏
              </Button>
            </span>
          ) : (
            <span className="text-xs text-muted">仅桌面版</span>
          )}
        </label>
        <Field label="悬浮窗样式">
          <Select
            value={settings.widgetVariant}
            onValueChange={(value) => {
              void onPatch({ widgetVariant: value as WidgetVariant }).then(() => {
                if (canUseWidget()) void showWidget(value);
              });
            }}
          >
            <SelectTrigger aria-label="悬浮窗样式">
              <span>{WIDGET_VARIANT_LABEL[settings.widgetVariant]}</span>
            </SelectTrigger>
            <SelectContent>
              {WIDGET_VARIANTS.map((variant) => (
                <SelectItem key={variant} value={variant}>
                  {WIDGET_VARIANT_LABEL[variant]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
          </>
        )}
        <span className="text-xs text-muted">卡片显隐在顶部「卡片布局」</span>
        {canUseWidget() && (
          <StatusLine dataRole="tray-status">托盘状态：{trayStatus === null ? '读取中…' : trayStatus}</StatusLine>
        )}
        <SwitchField
          label="明日课程预告"
          description="当天没课或课上完时显示"
          checked={settings.tomorrowPreview}
          onCheckedChange={(checked) => void onPatch({ tomorrowPreview: checked })}
          ariaLabel="明日课程预告"
        />
        <SwitchField
          label="开学倒计时"
          description="学期开始前显示距离开学还有几天"
          checked={settings.semesterCountdown}
          onCheckedChange={(checked) => void onPatch({ semesterCountdown: checked })}
          ariaLabel="开学倒计时"
        />
        <SwitchField
          label="假期倒计时"
          description="显示距离下一个法定假日还有几天"
          checked={settings.holidayCountdown}
          onCheckedChange={(checked) => void onPatch({ holidayCountdown: checked })}
          ariaLabel="假期倒计时"
        />
        <Field label="小组件背景">
          <Select
            value={settings.widgetBackground}
            onValueChange={(value) => void onPatch({ widgetBackground: value as WidgetBackground })}
          >
            <SelectTrigger aria-label="小组件背景">
              <span>{WIDGET_LABEL[settings.widgetBackground]}</span>
            </SelectTrigger>
            <SelectContent>
              {WIDGET_BACKGROUNDS.map((background) => (
                <SelectItem key={background} value={background}>
                  {WIDGET_LABEL[background]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="时区"
          hint="默认上海；首次启动会按系统时区对齐一次"
          error={zoneInvalid ? '时区名无效' : undefined}
        >
          <Select value={settings.timeZone} onValueChange={(value) => void onPatch({ timeZone: value })}>
            <SelectTrigger aria-label="时区">
              <span>{settings.timeZone}</span>
            </SelectTrigger>
            <SelectContent>
              {TIME_ZONE_OPTIONS.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
              {!TIME_ZONE_OPTIONS.includes(settings.timeZone) && (
                <SelectItem value={settings.timeZone}>{settings.timeZone}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>
        <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.autoTimeZone}
            onChange={(event) => void onPatch({ autoTimeZone: event.target.checked })}
          />
          时区跟随设备
        </label>
        <Field label="待办排序">
          <Select value={settings.todoSort} onValueChange={(value) => void onPatch({ todoSort: value as TodoSort })}>
            <SelectTrigger aria-label="待办排序">
              <span>{settings.todoSort === 'type' ? '按类型' : '按开始时间'}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="start">按开始时间</SelectItem>
              <SelectItem value="type">按类型（作业 → 考试 → 实验 → 日程）</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <StartupSettings supported={isAutoStartSupported()} settings={settings} onPatch={onPatch} />
      </>
    ),
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
        {...(card.def.id === 'reminders' && notifyAbnormal
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
      {notifyAbnormal && (
        <div
          data-role="notify-banner"
          className="flex flex-wrap items-center gap-2 rounded-md border border-danger-strong/40 bg-danger-strong/10 px-3 py-2 text-xs text-danger-strong"
        >
          <span className="min-w-0 break-words">通知未授权，课前提醒不会弹出</span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={notifyNextStep(notifyState)}
            onClick={() => void runNotifyAction(notifyState.action ?? 'request')}
          >
            {notifyNextStep(notifyState)}
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
