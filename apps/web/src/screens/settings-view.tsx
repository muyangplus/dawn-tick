import { useRef, useState } from 'react';
import { BadgeCheck, Bell, Database, Info, Palette, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import {
  BACKUP_MODULES,
  BACKUP_MODULE_LABEL,
  THEME_PRESETS,
  VIEW_DAY_OPTIONS,
  WIDGET_BACKGROUNDS,
  createCourse,
  createEvent,
  createSemester,
  deleteSemesterDeep,
  exportBackup,
  formatDate,
  formatDateTime,
  importBackup,
  isValidTimeZone,
  parseBackup,
  setSchedules,
  summarizeBackup,
  updateSemester,
  weekStart,
  type AppSettings,
  type BackupModule,
  type BackupPayload,
  type ImportMode,
  type SemesterRow,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
  type WidgetBackground,
} from '@dawn-tick/core';
import { PRESETS } from '../design/tokens.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion, featureVisible } from '../channel.ts';
import { clearLogs, logsText, logInfo } from '../log.ts';
import { PeriodSettings } from '../components/period-settings.tsx';
import { StartupSettings } from '../components/startup-settings.tsx';
import { isAutoStartSupported } from '../autostart.ts';
import { CourseManager } from './course-manager.tsx';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, Switch } from '../components/ui/controls.tsx';
import { toast } from '../components/ui/toaster.tsx';
import type { ReminderView } from '../useReminders.ts';

const PERMISSION_LABEL: Record<ReminderView['permission'], string> = {
  unsupported: '当前环境不支持通知',
  default: '未申请',
  granted: '已授权',
  denied: '已被拒绝',
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

export interface SettingsViewProps {
  storage: Storage;
  userId: string;
  settings: AppSettings;
  semesters: readonly SemesterRow[];
  activeSemesterId: string | null;
  activeStartDate: string;
  totalWeeks: number;
  slots: readonly TimeSlotRow[];
  persistent: boolean | null;
  reminders: ReminderView;
  storageKind: string;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
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
  persistent,
  reminders,
  storageKind,
  onPatch,
  onChanged,
}: SettingsViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [semesterName, setSemesterName] = useState('');
  const [semesterStart, setSemesterStart] = useState('');
  const [semesterWeeks, setSemesterWeeks] = useState(20);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportModules, setExportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));
  const [pendingImport, setPendingImport] = useState<BackupPayload | null>(null);
  const [importModules, setImportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));
  const [importMode, setImportMode] = useState<ImportMode>('skip');
  const [editing, setEditing] = useState<SemesterRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editWeeks, setEditWeeks] = useState(20);
  const [editZone, setEditZone] = useState('');
  const [removing, setRemoving] = useState<SemesterRow | null>(null);
  const zoneInvalid = !isValidTimeZone(settings.timeZone);
  const next = reminders.upcoming[0];

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
        `已删除「${removing.name}」，连带清理课程 ${report.courses} · 排课 ${report.schedules} · 节次 ${report.slots} · 日程 ${report.events} · 提醒 ${report.reminders}`,
      );
      setRemoving(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function downloadText(name: string, content: string, type = 'text/plain'): void {
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportLogs(): void {
    const entries = logsText();
    downloadText(`DawnTick-日志-${new Date().toISOString().slice(0, 10)}.txt`, entries === '' ? '暂无日志' : entries);
    setBackupMessage(`已导出日志 ${entries === '' ? 0 : entries.split('\n').length} 行`);
    void clearLogs();
  }

  /** 渠道独占：仅 dev 渠道提供，用于快速构造可测试的课表。 */
  async function seedSampleData(): Promise<void> {
    setBusy(true);
    try {
      const palette = PRESETS[settings.themePreset].courses;
      const today = formatDate(Date.now(), settings.timeZone);
      const semester = await createSemester(storage, {
        userId,
        name: '示例学期',
        startDate: weekStart(today),
        totalWeeks: 20,
        timeZone: settings.timeZone,
      });
      const demo = [
        { name: '高等数学', teacher: '张老师', location: '教三-201', slots: [[1, 1, 2], [3, 3, 4]] },
        { name: '大学物理', teacher: '李老师', location: '理科楼-105', slots: [[2, 5, 6]] },
        { name: '程序设计', teacher: '王老师', location: '信息楼-302', slots: [[4, 7, 8]] },
      ];
      for (const [index, item] of demo.entries()) {
        const course = await createCourse(storage, {
          semesterId: String(semester['id']),
          name: item.name,
          teacher: item.teacher,
          location: item.location,
          color: palette[index % palette.length] ?? '#4F8DFD',
        });
        await setSchedules(
          storage,
          String(course['id']),
          item.slots.map(([day, start, end]) => ({
            dayOfWeek: day as number,
            periodStart: start as number,
            periodEnd: end as number,
            weeks: Array.from({ length: 16 }, (_, week) => week + 1),
          })),
        );
      }
      await createEvent(storage, {
        userId,
        type: 'temp',
        semesterId: String(semester['id']),
        title: '交作业',
        onDate: formatDate(Date.now() + 3 * 86_400_000, settings.timeZone),
      });
      logInfo('sample', '生成示例数据', { courses: demo.length });
      toast.success('已生成示例学期与 3 门课程');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function downloadBackup(): Promise<void> {
    setBusy(true);
    try {
      const modules = [...exportModules];
      if (modules.length === 0) {
        setBackupMessage('请至少勾选一个模块');
        return;
      }
      const payload = await exportBackup(storage, { modules });
      downloadText(
        `DawnTick-备份-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(payload, null, 2),
        'application/json',
      );
      logInfo('backup', '导出备份', {
        modules,
        stores: Object.keys(payload.stores).length,
        rows: Object.values(payload.stores).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0),
      });
      setBackupMessage(`已导出 ${modules.map((module) => BACKUP_MODULE_LABEL[module]).join('、')}`);
      setExportOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackupFile(file: File): Promise<void> {
    try {
      const payload = parseBackup(await file.text());
      setPendingImport(payload);
      const present = summarizeBackup(payload)
        .filter((item) => item.rows > 0)
        .map((item) => item.module);
      setImportModules(new Set(present.length > 0 ? present : BACKUP_MODULES));
      setImportMode('skip');
    } catch (cause: unknown) {
      setBackupMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function confirmImport(): Promise<void> {
    if (pendingImport === null) return;
    setBusy(true);
    try {
      const modules = [...importModules];
      if (modules.length === 0) {
        setBackupMessage('请至少勾选一个模块');
        return;
      }
      const result = await importBackup(storage, pendingImport, { mode: importMode, modules });
      logInfo('backup', '导入备份', { mode: importMode, modules, imported: result.imported, skipped: result.skipped });
      setBackupMessage(
        `${importMode === 'skip' ? '保留现有数据' : '覆盖为备份内容'}：写入 ${result.imported} 条，跳过 ${result.skipped} 条`,
      );
      setPendingImport(null);
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
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <CollapsibleCard id="semesters" title="学期设置" icon={BadgeCheck} badge={`${semesters.length} 个`}>
        {semesters.length > 0 && (
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
                    onClick={() => setRemoving(semester)}
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
      </CollapsibleCard>

      <PeriodSettings storage={storage} semesterId={activeSemesterId ?? ''} onChanged={onChanged} />

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

      <CollapsibleCard id="reminders" title="提醒设置" icon={Bell}>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>通知权限：{PERMISSION_LABEL[reminders.permission]}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={reminders.permission === 'unsupported' || reminders.permission === 'granted'}
            onClick={() => void reminders.request()}
          >
            申请通知权限
          </Button>
        </div>
        <span className="text-xs text-muted">网页关闭后无法提醒；Android 采用系统通知排定，Windows 依赖常驻托盘。</span>
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>课前提醒</span>
            <span className="truncate text-xs text-muted">所有课程默认提醒，可在课程详情里单独设置</span>
          </span>
          <Switch
            checked={settings.classReminderEnabled}
            aria-label="课前提醒"
            onCheckedChange={(checked) => void onPatch({ classReminderEnabled: checked })}
          />
        </label>
        <Field label="默认提前">
          <div className="flex flex-wrap items-center gap-2">
            {[5, 10, 15, 20, 30].map((minutes) => (
              <Button
                key={minutes}
                size="sm"
                variant={settings.classReminderMinutes === minutes ? 'primary' : 'secondary'}
                aria-label={`提前 ${minutes} 分钟`}
                disabled={!settings.classReminderEnabled}
                onClick={() => void onPatch({ classReminderMinutes: minutes })}
              >
                {minutes} 分钟
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
          接下来 7 天待提醒 {reminders.upcoming.length} 条
          {next !== undefined && ` · 最近 ${formatDateTime(next.triggerAt, settings.timeZone)} ${next.title}`}
        </span>
        <span className="text-xs text-muted">
          想单独改某门课，在课程详情里打开「单独设置这门课的提醒」再调。
        </span>
      </CollapsibleCard>

      <CollapsibleCard id="appearance" title="外观" icon={Palette}>
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
        <Field label="周视图天数">
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
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>周视图显示非本周课程</span>
            <span className="truncate text-xs text-muted">这一周不上的课用虚线框标出</span>
          </span>
          <Switch
            checked={settings.showOtherWeeks}
            aria-label="周视图显示非本周课程"
            onCheckedChange={(checked) => void onPatch({ showOtherWeeks: checked })}
          />
        </label>
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>空日程提示明日预告</span>
            <span className="truncate text-xs text-muted">某天没有安排时，提示明天有多少项</span>
          </span>
          <Switch
            checked={settings.tomorrowPreview}
            aria-label="空日程提示明日预告"
            onCheckedChange={(checked) => void onPatch({ tomorrowPreview: checked })}
          />
        </label>
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>开学倒计时</span>
            <span className="truncate text-xs text-muted">学期开始前显示距离开学还有几天</span>
          </span>
          <Switch
            checked={settings.semesterCountdown}
            aria-label="开学倒计时"
            onCheckedChange={(checked) => void onPatch({ semesterCountdown: checked })}
          />
        </label>
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>假期倒计时</span>
            <span className="truncate text-xs text-muted">显示距离下一个法定假日还有几天</span>
          </span>
          <Switch
            checked={settings.holidayCountdown}
            aria-label="假期倒计时"
            onCheckedChange={(checked) => void onPatch({ holidayCountdown: checked })}
          />
        </label>
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
        <Field label="时区">
          <Input value={settings.timeZone} onChange={(event) => void onPatch({ timeZone: event.target.value })} />
        </Field>
        {zoneInvalid && <span className="text-xs text-danger-strong">时区名无效</span>}
        <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.autoTimeZone}
            onChange={(event) => void onPatch({ autoTimeZone: event.target.checked })}
          />
          时区跟随设备
        </label>
      </CollapsibleCard>

      <StartupSettings supported={isAutoStartSupported()} settings={settings} onPatch={onPatch} />

      <CollapsibleCard id="data" title="同步与数据" icon={Database}>
        <span className="text-xs text-muted">本地存储：{storageKind}</span>
        <span className="text-xs text-muted">
          浏览器持久化：{persistent === null ? '未申请' : persistent ? '已授权' : '未授权'}
        </span>
        <span className="text-xs text-muted">本期无服务端，同步协议已就绪但未启用；跨设备迁移请用 JSON 备份。</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setExportOpen(true)}>
            导出备份
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" aria-hidden />
            导入备份
          </Button>
          {featureVisible('diagnostics') && (
            <Button size="sm" variant="secondary" onClick={exportLogs}>
              导出日志
            </Button>
          )}
          {featureVisible('sampleData') && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void seedSampleData()}>
              填充示例数据
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void chooseBackupFile(file);
              event.target.value = '';
            }}
          />
        </div>
        {backupMessage !== null && <span className="text-xs text-muted">{backupMessage}</span>}
      </CollapsibleCard>

      <CollapsibleCard id="about" title="关于" icon={Info}>
        <span className="text-xs text-muted">晓刻 DawnTick · 课表与日程提醒工具</span>
        <span className="tabular text-xs text-muted">
          版本 {appVersion()} · {CHANNEL_LABEL[CHANNEL]}
        </span>
        <span className="text-xs text-muted">许可证 Apache-2.0</span>
        <a className="text-xs text-primary-strong underline" href="https://github.com/muyangplus/dawn-tick">
          https://github.com/muyangplus/dawn-tick
        </a>
      </CollapsibleCard>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent title="编辑学期" description="修改会立即影响周次与课表计算">
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
          <Field label="时区">
            <Input value={editZone} onChange={(event) => setEditZone(event.target.value)} />
          </Field>
          {!isValidTimeZone(editZone) && <span className="text-xs text-danger-strong">时区名无效</span>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void saveEdit()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogContent
          title="删除学期"
          description={
            removing === null
              ? ''
              : `将删除「${removing.name}」及其课程、排课、节次、日程与提醒，本操作不可撤销`
          }
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!open) setExportOpen(false);
        }}
      >
        <DialogContent title="导出备份" description="勾选要导出的模块">
          <div className="flex flex-col gap-1">
            {BACKUP_MODULES.map((module) => (
              <label key={module} className="flex min-h-tap items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={exportModules.has(module)}
                  aria-label={`导出 ${BACKUP_MODULE_LABEL[module]}`}
                  onChange={(event) =>
                    setExportModules((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(module);
                      else next.delete(module);
                      return next;
                    })
                  }
                />
                {BACKUP_MODULE_LABEL[module]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExportModules(new Set(BACKUP_MODULES))}>
              全选
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExportModules(new Set())}>
              清空
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy || exportModules.size === 0} onClick={() => void downloadBackup()}>
              导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingImport !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImport(null);
        }}
      >
        <DialogContent title="导入备份" description="勾选要导入的模块，并选择遇到已有数据时的处理方式">
          <div className="flex flex-col gap-1">
            {summarizeBackup(pendingImport ?? { format: 'dawn-tick-backup', version: 1, exportedAt: 0, stores: {}, meta: {} })
              .filter((item) => item.rows > 0)
              .map((item) => (
                <label key={item.module} className="flex min-h-tap items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={importModules.has(item.module)}
                    aria-label={`导入 ${BACKUP_MODULE_LABEL[item.module]}`}
                    onChange={(event) =>
                      setImportModules((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.module);
                        else next.delete(item.module);
                        return next;
                      })
                    }
                  />
                  {BACKUP_MODULE_LABEL[item.module]}
                  <span className="text-xs text-muted">{item.rows} 条</span>
                </label>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={importMode === 'skip' ? 'primary' : 'secondary'}
              onClick={() => setImportMode('skip')}
            >
              不覆盖已存在
            </Button>
            <Button
              size="sm"
              variant={importMode === 'overwrite' ? 'primary' : 'secondary'}
              onClick={() => setImportMode('overwrite')}
            >
              覆盖为备份内容
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy || importModules.size === 0} onClick={() => void confirmImport()}>
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
