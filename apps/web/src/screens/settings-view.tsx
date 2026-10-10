import { useRef, useState } from 'react';
import { BadgeCheck, Bell, Database, Info, Palette, Plus, Upload } from 'lucide-react';
import {
  THEME_PRESETS,
  VIEW_DAY_OPTIONS,
  WIDGET_BACKGROUNDS,
  createSemester,
  exportBackup,
  formatDateTime,
  importBackup,
  isValidTimeZone,
  parseBackup,
  updateSemester,
  type AppSettings,
  type SemesterRow,
  type Storage,
  type ThemePreset,
  type WidgetBackground,
} from '@dawn-tick/core';
import { PRESETS } from '../design/tokens.ts';
import { Button } from '../components/ui/button.tsx';
import { Card, CardTitle } from '../components/ui/card.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/controls.tsx';
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
  const zoneInvalid = !isValidTimeZone(settings.timeZone);
  const next = reminders.upcoming[0];

  async function downloadBackup(): Promise<void> {
    setBusy(true);
    try {
      const payload = await exportBackup(storage);
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `DawnTick-备份-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setBackupMessage('已导出备份');
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackup(file: File): Promise<void> {
    setBusy(true);
    try {
      const result = await importBackup(storage, parseBackup(await file.text()));
      setBackupMessage(`已恢复 ${result.imported} 条，跳过 ${result.skipped} 条`);
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
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          <BadgeCheck className="size-4" aria-hidden />
          学期设置
        </CardTitle>
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
                {semester.id === activeSemesterId ? (
                  <span className="shrink-0 text-xs text-primary-strong">当前</span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void activate(semester.id)}>
                    切换
                  </Button>
                )}
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
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" aria-hidden />
          提醒设置
        </CardTitle>
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
        <span className="text-xs text-muted">
          接下来 7 天待提醒 {reminders.upcoming.length} 条
          {next !== undefined && ` · 最近 ${formatDateTime(next.triggerAt, settings.timeZone)} ${next.title}`}
        </span>
        <span className="text-xs text-muted">在课表里点击课程即可设置课前 5/10/15/30 分钟或自定义提醒。</span>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4" aria-hidden />
          外观
        </CardTitle>
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
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4" aria-hidden />
          同步与数据
        </CardTitle>
        <span className="text-xs text-muted">本地存储：{storageKind}</span>
        <span className="text-xs text-muted">
          浏览器持久化：{persistent === null ? '未申请' : persistent ? '已授权' : '未授权'}
        </span>
        <span className="text-xs text-muted">本期无服务端，同步协议已就绪但未启用；跨设备迁移请用 JSON 备份。</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void downloadBackup()}>
            导出备份
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" aria-hidden />
            导入备份
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void restoreBackup(file);
              event.target.value = '';
            }}
          />
        </div>
        {backupMessage !== null && <span className="text-xs text-muted">{backupMessage}</span>}
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle className="flex items-center gap-2">
          <Info className="size-4" aria-hidden />
          关于
        </CardTitle>
        <span className="text-xs text-muted">晓刻 DawnTick · 课表与日程提醒工具</span>
        <span className="text-xs text-muted">许可证 Apache-2.0</span>
        <a className="text-xs text-primary-strong underline" href="https://github.com/muyangplus/dawn-tick">
          https://github.com/muyangplus/dawn-tick
        </a>
      </Card>
    </div>
  );
}
