import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { BadgeCheck, Bell, Database, Info, LayoutGrid, Palette, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import {
  BACKUP_MODULES,
  BACKUP_MODULE_LABEL,
  IMPORT_MODE_LABEL,
  IMPORT_MODES,
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
  LOG_LEVELS,
  summarizeBackup,
  updateSemester,
  type AppSettings,
  type BackupModule,
  type BackupPayload,
  type ImportMode,
  type SemesterRow,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
  type WidgetBackground,
  type WidgetVariant,
  type TodoSort,
  type LogLevel,
  type MotionMode,
} from '@dawn-tick/core';
import {
  exportConfig,
  importConfig,
  importResultText,
  parseImportText,
  presentModules,
  readImportFile,
  type ExportFormat,
} from '../data-management.ts';
import { PRESETS } from '../design/tokens.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion, featureVisible } from '../channel.ts';
import { checkForUpdate, resolveReceiveBeta, verifyHint } from '../update.ts';
import {
  BUILTIN_PRESET_VERSION,
  cacheSnapshotContent,
  checkPresetUpdate,
  fetchSnapshot,
  resolvePresetSource,
  writeCachedSnapshot,
  type PresetSource,
} from '../preset-update.ts';
import { logWarn } from '../log.ts';
import { clearLogs, logsText, logInfo } from '../log.ts';
import { canUseWidget, hideWidget, showWidget } from '../widget-window.ts';
import { MOBILE_WIDGETS, hasMobileWidgets, pinWidget, type PinWidgetResult } from '../widget-pin.ts';
import {
  copyText,
  isIgnoringBatteryOptimizations,
  openLogDirectory,
  requestIgnoreBatteryOptimizations,
  saveTextFile,
} from '../system-actions.ts';
import { exactAlarmState, requestExactAlarm, type ExactAlarmState } from '../permissions.ts';
import {
  canConfigureStorage,
  openDataDirectory,
  readStorageInfo,
  relaunchApplication,
  saveStoragePath,
  type StorageInfo,
} from '../storage-config.ts';
import { walEnabledByDefault } from '../db/journal.ts';
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  pruneSnapshots,
  restoreSnapshot,
  snapshotKind,
  type SnapshotEntry,
} from '../backup.ts';
import {
  davConfigured,
  downloadAndApply,
  testConnection,
  uploadPackage,
  type ApplyMode,
  type DavSettings,
} from '../webdav.ts';
import { detectPlatform } from '../platform-detect.ts';
import { runBusy } from '../lib/busy.ts';
import { PeriodSettings } from '../components/period-settings.tsx';
import { StartupSettings } from '../components/startup-settings.tsx';
import { isAutoStartSupported } from '../autostart.ts';
import { CourseManager } from './course-manager.tsx';
import { SchoolTimetableCard } from './school-timetable-card.tsx';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { ExternalLink } from '../components/ui/external-link.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, Switch } from '../components/ui/controls.tsx';
import { toast } from '../components/ui/toaster.tsx';
import type { ReminderView } from '../useReminders.ts';
import { CardLayoutPanel } from './cards/layout-panel.tsx';
import { readLayout } from './cards/layout-store.ts';
import { resolveCards, type LayoutConfig } from './cards/registry.ts';
import { SETTINGS_SECTIONS, settingsSection } from './cards/settings-cards.tsx';

/** 预设来源的可读文案：raw 直连还是 GitHub contents 兜底。 */
function sourceLabel(source: 'raw' | 'api'): string {
  return source === 'api' ? 'GitHub contents 接口' : 'raw.githubusercontent.com';
}

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

/** 日志级别说明（与设置页文案一致）。 */
const LOG_LEVEL_HINT: Record<LogLevel, string> = {
  error: '仅严重错误',
  warn: '错误 + 警告信息',
  info: '一般操作信息（默认）',
  debug: '详细信息，包含请求/响应详情',
  trace: '全部日志，最详细',
};

/** 快照大小的可读文案。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

/** 关于卡片列出的运行时依赖与许可证：由 tools/legal/collect-licenses.mjs 生成。 */
import { RUNTIME_CREDITS } from '../legal/credits.generated.ts';

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
  /** 从库外写入设置后（如 WebDAV 只应用设置）重新读取设置并热加载 */
  onSettingsReplaced: () => Promise<void>;
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
  onSettingsReplaced,
}: SettingsViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [semesterName, setSemesterName] = useState('');
  const [semesterStart, setSemesterStart] = useState('');
  const [semesterWeeks, setSemesterWeeks] = useState(20);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [trayStatus, setTrayStatus] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [presetSource, setPresetSource] = useState<PresetSource | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetResult, setPresetResult] = useState<string | null>(null);
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storagePathInput, setStoragePathInput] = useState('');
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotRestartNeeded, setSnapshotRestartNeeded] = useState(false);
  const [davStatus, setDavStatus] = useState<string | null>(null);
  const [davBusy, setDavBusy] = useState(false);
  const [davConfirmOpen, setDavConfirmOpen] = useState(false);
  const platform = detectPlatform();
  const portableStorage = storageInfo?.portable === true;
  const walDefaultOn = walEnabledByDefault(portableStorage, platform);
  const walOn = settings.walMode === 'on' || (settings.walMode === 'auto' && walDefaultOn);

  useEffect(() => {
    if (!canConfigureStorage()) return;
    void (async () => {
      const info = await readStorageInfo();
      if (info === null) return;
      setStorageInfo(info);
      setStoragePathInput(info.customPath);
      if (info.fallbackReason !== null) setStorageError(info.fallbackReason);
    })();
  }, []);

  /** 保存存储位置：成功后要重启才生效。 */
  async function saveStorage(path: string): Promise<void> {
    setStorageBusy(true);
    setStorageError(null);
    setStorageMessage(null);
    try {
      const result = await saveStoragePath(path);
      if (result.info === null) {
        setStorageError(result.error ?? '保存失败');
        return;
      }
      setStorageInfo(result.info);
      setStoragePathInput(result.info.customPath);
      const copied = result.info.copied.length;
      setStorageMessage(
        copied > 0
          ? `已写入 ${result.info.dir}，复制了 ${copied} 个数据文件，重启后生效`
          : `已写入 ${result.info.dir}，重启后生效`,
      );
      setRestartNeeded(true);
    } finally {
      setStorageBusy(false);
    }
  }

  /** 日志模式存在库里，下次打开数据库时套用。 */
  async function toggleWal(next: boolean): Promise<void> {
    await onPatch({ walMode: next ? 'on' : 'off' });
    setStorageMessage('日志模式已保存，重启后生效');
    setRestartNeeded(true);
  }

  async function restartNow(): Promise<void> {
    const ok = await relaunchApplication();
    if (!ok) setStorageError('重启失败，请手动重新打开应用');
  }

  const refreshSnapshots = useCallback(async (): Promise<void> => {
    setSnapshots(await listSnapshots(storage));
  }, [storage]);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots]);

  /** 立即做一份快照，并按保留份数清理。 */
  async function backupNow(): Promise<void> {
    setSnapshotBusy(true);
    setSnapshotMessage(null);
    try {
      const entry = await createSnapshot(storage);
      if (entry === null) {
        setSnapshotMessage('备份失败，详见日志');
        return;
      }
      const removed = await pruneSnapshots(storage, settings.backupKeep);
      await refreshSnapshots();
      setSnapshotMessage(
        `已生成快照 ${formatDateTime(entry.createdAt, settings.timeZone)}${removed > 0 ? `，清理了 ${removed} 份旧快照` : ''}`,
      );
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function removeSnapshot(entry: SnapshotEntry): Promise<void> {
    setSnapshotBusy(true);
    try {
      const ok = await deleteSnapshot(storage, entry);
      await refreshSnapshots();
      setSnapshotMessage(ok ? '已删除该快照' : '删除失败，详见日志');
    } finally {
      setSnapshotBusy(false);
    }
  }

  /** 恢复：文件快照排队到重启后套用，JSON 快照当场覆盖数据。 */
  async function restoreSnapshotNow(entry: SnapshotEntry): Promise<void> {
    setSnapshotBusy(true);
    setSnapshotMessage(null);
    try {
      const safe = await createSnapshot(storage);
      await pruneSnapshots(storage, settings.backupKeep);
      const outcome = await restoreSnapshot(storage, entry);
      if (!outcome.ok) {
        setSnapshotMessage(`恢复失败：${outcome.error ?? '未知原因'}`);
        return;
      }
      await refreshSnapshots();
      if (outcome.needsRestart) {
        setSnapshotRestartNeeded(true);
        setSnapshotMessage('已排好恢复，重启后生效');
        return;
      }
      const result = outcome.result;
      setSnapshotMessage(
        result === null
          ? '已恢复快照'
          : `已恢复快照：写入 ${result.imported} 条，清空 ${result.removed} 条${safe === null ? '' : '（恢复前已备份当前数据）'}`,
      );
      onChanged();
    } finally {
      setSnapshotBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 缓存比内置新且哈希可信才用缓存
      const source = await resolvePresetSource(storage);
      if (!cancelled) setPresetSource(source);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const dav: DavSettings = {
    webdavUrl: settings.webdavUrl,
    webdavUser: settings.webdavUser,
    webdavPassword: settings.webdavPassword,
    webdavHistory: settings.webdavHistory,
  };

  async function testDav(): Promise<void> {
    setDavBusy(true);
    setDavStatus('正在测试连接…');
    try {
      const status = await testConnection(dav);
      if (!status.ok) {
        setDavStatus(`连接失败：${status.error ?? `服务器返回 ${status.status}`}`);
        return;
      }
      const remote =
        status.lastModified === null
          ? status.exists
            ? '远端已有备份'
            : '远端还没有备份'
          : `远端备份时间 ${formatDateTime(status.lastModified, settings.timeZone)}`;
      setDavStatus(`连接正常，${remote}`);
    } finally {
      setDavBusy(false);
    }
  }

  async function uploadDav(): Promise<void> {
    setDavBusy(true);
    setDavStatus(null);
    try {
      const result = await uploadPackage(storage, dav);
      if (!result.ok) {
        setDavStatus(`上传失败：${result.error ?? '未知原因'}`);
        return;
      }
      await refreshSnapshots();
      setDavStatus(`已上传 ${result.name}（${formatBytes(result.bytes)}）`);
    } finally {
      setDavBusy(false);
    }
  }

  /** 下载并应用：先备份本机再覆盖 */
  async function downloadDav(mode: ApplyMode): Promise<void> {
    setDavBusy(true);
    setDavConfirmOpen(false);
    setDavStatus(null);
    try {
      const safe = await createSnapshot(storage);
      await pruneSnapshots(storage, settings.backupKeep);
      const result = await downloadAndApply(storage, dav, mode);
      await refreshSnapshots();
      if (!result.ok) {
        setDavStatus(`下载失败：${result.error ?? '未知原因'}`);
        return;
      }
      const outcome = result.outcome;
      if (mode === 'settings') {
        const count = outcome?.settings?.imported ?? 0;
        setDavStatus(
          `已应用设置与预设（写入 ${count} 条${outcome?.presets === true ? '，含预设' : ''}）${safe === null ? '' : '，下载前已备份本机数据'}`,
        );
        await onSettingsReplaced();
        return;
      }
      setDavStatus(
        `已恢复整库（写入 ${outcome?.full?.imported ?? 0} 条，清空 ${outcome?.full?.removed ?? 0} 条）${safe === null ? '' : '，下载前已备份本机数据'}；重启后完全生效`,
      );
      setRestartNeeded(true);
      onChanged();
    } finally {
      setDavBusy(false);
    }
  }

  useEffect(() => {
    if (!canUseWidget()) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<{ elevated: boolean }>('elevation_status');
        setElevated(status.elevated);
      } catch {
        setElevated(null);
      }
    })();
  }, []);

  async function requestElevation(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('relaunch_elevated');
      logInfo('desktop', '请求以管理员身份重新启动');
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setUpdateResult(`提权失败：${message}`);
      logWarn('desktop', '提权失败', { message });
    }
  }

  async function runUpdateCheck(): Promise<void> {
    setUpdateBusy(true);
    try {
      const status = await checkForUpdate({
        channel: CHANNEL,
        receiveBeta: resolveReceiveBeta(settings.receiveBeta, CHANNEL),
        currentVersion: appVersion(),
      });
      if (status.error !== null) {
        setUpdateResult(`检查失败：${status.error}`);
        logWarn('update', '检查更新失败', { error: status.error, feed: status.feed });
        return;
      }
      const manifest = status.manifest;
      setUpdateResult(
        status.available
          ? `发现新版本 ${status.latest}（${CHANNEL_LABEL[status.feed]}），可在发布页下载`
          : `已是最新版本（${CHANNEL_LABEL[status.feed]}）`,
      );
      logInfo('update', '检查更新', {
        feed: status.feed,
        current: status.current,
        latest: status.latest,
        available: status.available,
        verify: verifyHint(status.feed, 'windows'),
        ...(manifest?.notes === undefined ? {} : { notes: manifest.notes }),
      });
    } finally {
      setUpdateBusy(false);
    }
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

  /**
   * 检查预设更新：提示与下载。
   * 下载成功的快照写入缓存，下次启动由 resolvePresetSource 读取生效；
   * 离线、404、哈希不符等失败返回一条提示，界面沿用内置预设。
   */
  async function runPresetCheck(): Promise<void> {
    setPresetBusy(true);
    try {
      const currentVersion = presetSource?.version ?? BUILTIN_PRESET_VERSION;
      const status = await checkPresetUpdate({ cachedVersion: currentVersion });
      if (status.error !== null) {
        setPresetResult(`检查失败：${status.error}`);
        logWarn('preset', '检查预设更新失败', { error: status.error, current: currentVersion });
        return;
      }
      if (!status.available || status.version === null) {
        setPresetResult(
          `预设已是最新（${currentVersion}）${status.source === undefined ? '' : `，来源 ${sourceLabel(status.source)}`}`,
        );
        logInfo('preset', '预设已是最新', { current: currentVersion, latest: status.version, source: status.source });
        return;
      }
      const snapshot = await fetchSnapshot(status.version);
      await writeCachedSnapshot(storage, snapshot);
      // 快照是清单；「下次启动生效」还需要正文，这一步把正文一并校验后落盘。
      // 正文不合法时只记日志：界面提示已下载，下次启动回退内置。
      const content = await cacheSnapshotContent(storage, snapshot);
      if (!content.ok) {
        logWarn('preset', '预设正文校验未通过，已缓存清单但不缓存正文', {
          version: snapshot.version,
          message: content.reason ?? '未知原因',
        });
      }
      setPresetSource(await resolvePresetSource(storage));
      setPresetResult(
        `已下载预设 ${snapshot.version}（${snapshot.sources.timetables.length} 套作息、${snapshot.sources.systems.length} 个教务系统），下次启动生效`,
      );
      logInfo('preset', '已下载预设快照', { version: snapshot.version, hash: snapshot.hash });
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPresetResult(`检查失败：${message}`);
      logWarn('preset', '下载预设快照失败', { message });
    } finally {
      setPresetBusy(false);
    }
  }
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** 导出格式：JSON 文件、Base64 文本，或带预设与日志的整包 zip */
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [bundlePresets, setBundlePresets] = useState(true);
  const [bundleLogs, setBundleLogs] = useState(false);
  const [exportText, setExportText] = useState('');
  const [importText, setImportText] = useState('');
  /** 手机端添加小组件的结果提示 */
  const [pinNote, setPinNote] = useState<PinWidgetResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);
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
  const [layout, setLayout] = useState<LayoutConfig>({});
  const [layoutOpen, setLayoutOpen] = useState(false);
  const zoneInvalid = !isValidTimeZone(settings.timeZone);
  /** 诊断入口：dev/beta 可见；dev 关掉开发者特性后与正式版一致地隐藏 */
  const diagnosticsVisible = featureVisible('diagnostics') && (CHANNEL !== 'dev' || settings.devFeatures);
  /** 安卓权限状态：精确闹钟、电池优化白名单 */
  const [alarmState, setAlarmState] = useState<ExactAlarmState>('unsupported');
  const [batteryFree, setBatteryFree] = useState<boolean | null>(null);
  const androidApp = detectPlatform() === 'capacitor';
  useEffect(() => {
    if (!androidApp) return;
    let cancelled = false;
    void (async () => {
      const [alarm, ignoring] = await Promise.all([exactAlarmState(), isIgnoringBatteryOptimizations()]);
      if (!cancelled) {
        setAlarmState(alarm);
        setBatteryFree(ignoring);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [androidApp]);
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
        `已删除「${removing.name}」，连带清理课程 ${report.courses} · 排课 ${report.schedules} · 节次 ${report.slots} · 日程 ${report.events} · 提醒 ${report.reminders}`,
      );
      setRemoving(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  /** 桌面端走系统保存对话框，其余端下载 */
  async function saveText(name: string, content: string, extension: string, filterName: string): Promise<boolean> {
    const result = await saveTextFile(name, content, { extension, filterName });
    if (result.cancelled) {
      setBackupMessage('已取消保存');
      return false;
    }
    if (!result.ok) {
      setBackupMessage(`保存失败：${result.error ?? '未知原因'}`);
      return false;
    }
    setBackupMessage(result.path === null ? `已下载 ${name}` : `已保存到 ${result.path}`);
    return true;
  }

  async function exportLogs(): Promise<void> {
    const entries = logsText();
    const name = `DawnTick-log-${new Date().toISOString().slice(0, 10)}.txt`;
    const saved = await saveText(name, entries === '' ? '暂无日志' : entries, 'txt', '日志文件');
    if (saved) {
      toast.success(`已导出日志 ${entries === '' ? 0 : entries.split('\n').length} 行`);
      void clearLogs();
    }
  }

  /** 桌面端：资源管理器定位日志目录 */
  async function showLogDirectory(): Promise<void> {
    const dir = await openLogDirectory();
    setBackupMessage(dir === null ? '当前平台不支持打开日志目录' : `日志目录：${dir}`);
  }

  async function downloadBackup(): Promise<void> {
    setBusy(true);
    try {
      const modules = [...exportModules];
      if (modules.length === 0) {
        setBackupMessage('请至少勾选一个模块');
        return;
      }
      const outcome = await exportConfig(storage, {
        modules,
        format: exportFormat,
        bundlePresets,
        bundleLogs,
      });
      if (outcome.cancelled) {
        setBackupMessage('已取消保存');
        return;
      }
      if (!outcome.ok) {
        setBackupMessage(`保存失败：${outcome.error ?? '未知原因'}`);
        return;
      }
      const label = modules.map((module) => BACKUP_MODULE_LABEL[module]).join('、');
      if (exportFormat === 'base64' && outcome.text !== null) {
        setExportText(outcome.text);
        setBackupMessage(`已生成 Base64 文本（${label}）`);
        return;
      }
      setBackupMessage(
        outcome.path === null ? `已下载 ${outcome.name}` : `已保存到 ${outcome.path}`,
      );
      setExportOpen(false);
    } finally {
      setBusy(false);
    }
  }

  /** 导出 Base64 文本到文件：内容与文本框一致。 */
  async function saveBase64Backup(): Promise<void> {
    if (exportText === '') return;
    const day = new Date().toISOString().slice(0, 10);
    if (await saveText(`DawnTick-backup-${day}.base64.txt`, exportText, 'txt', 'Base64 文本')) setExportOpen(false);
  }

  /** 导入对话框里粘贴的文本：JSON 与 Base64 都接受。 */
  function parsePastedBackup(): void {
    const text = importText.trim();
    if (text === '') {
      setBackupMessage('请先粘贴备份文本');
      return;
    }
    try {
      const payload = parseImportText(text);
      setPendingImport(payload);
      setImportModules(new Set(presentModules(payload)));
      setImportMode('skip');
      setImportOpen(false);
      setBackupMessage('已解析粘贴的配置文本');
    } catch (cause: unknown) {
      setBackupMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function chooseBackupFile(file: File): Promise<void> {
    const { payload, error } = await readImportFile(file);
    if (payload === null) {
      setBackupMessage(error ?? '读取备份文件失败');
      return;
    }
    setPendingImport(payload);
    setImportModules(new Set(presentModules(payload)));
    setImportMode('skip');
    setImportOpen(false);
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
      const result = await importConfig(storage, pendingImport, { mode: importMode, modules });
      setBackupMessage(importResultText(result, importMode));
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

  /** 卡片布局对话框：由设置页顶部按钮进入，与「外观」卡片显隐无关 */
  const layoutGroups: ReactNode = <CardLayoutPanel layout={layout} onChange={setLayout} storage={storage} />;

  const bodies: Record<string, ReactNode> = {
    semesters: (
      <>
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
        <span className="text-xs text-muted">关闭后不再提醒</span>
        {androidApp && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span data-role="exact-alarm-status">
                精确闹钟：{alarmState === 'granted' ? '已开启' : alarmState === 'denied' ? '未开启' : '不适用'}
              </span>
              {alarmState === 'denied' && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="开启精确闹钟"
                  onClick={() =>
                    void (async () => {
                      await requestExactAlarm();
                      setAlarmState(await exactAlarmState());
                    })()
                  }
                >
                  去开启
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span data-role="battery-optimization-status">
                后台运行：{batteryFree === null ? '读取中…' : batteryFree ? '已加入电池优化白名单' : '受电池优化限制，提醒可能延后'}
              </span>
              {batteryFree === false && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="申请加入电池优化白名单"
                  onClick={() =>
                    void (async () => {
                      await requestIgnoreBatteryOptimizations();
                      setBatteryFree(await isIgnoringBatteryOptimizations());
                    })()
                  }
                >
                  去设置
                </Button>
              )}
            </div>
          </>
        )}
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
          单课可在课程详情里单独设置
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
        {hasMobileWidgets() ? (
          <div className="flex flex-col gap-2" data-role="mobile-widget-guide">
            <span className="text-sm text-ink">桌面小组件</span>
            <span className="text-xs text-muted">
              桌面长按 → 小组件 → 晓刻
            </span>
            {MOBILE_WIDGETS.map((widget) => (
              <div
                key={widget.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface p-2"
                data-role="mobile-widget-row"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-ink">
                    {widget.label}
                    <span className="ml-1 text-xs text-muted">{widget.size}</span>
                  </span>
                  <span className="truncate text-xs text-muted">{widget.description}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`添加小组件到桌面：${widget.label}`}
                  onClick={() => void pinWidget(widget.id).then((result) => setPinNote(result))}
                >
                  添加到桌面
                </Button>
              </div>
            ))}
            {pinNote !== null && (
              <span className="text-xs text-muted" data-role="mobile-widget-note">
                {pinNote.ok && pinNote.supported
                  ? '已请求添加，请在系统弹窗里确认'
                  : `一键添加不可用：${pinNote.reason ?? '请在小组件列表里手动添加'}`}
              </span>
            )}
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
                onClick={() => void showWidget(settings.widgetVariant)}
              >
                显示
              </Button>
              <Button size="sm" variant="ghost" aria-label="隐藏悬浮窗" onClick={() => void hideWidget()}>
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
        <Field label="卡片布局" hint="顶部按钮进入">
          <Button size="sm" variant="secondary" aria-label="打开卡片布局" onClick={() => setLayoutOpen(true)}>
            打开卡片布局
          </Button>
        </Field>
        {canUseWidget() && (
          <span className="text-xs text-muted">托盘状态：{trayStatus === null ? '读取中…' : trayStatus}</span>
        )}
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>空日程提示明日预告</span>
            <span className="truncate text-xs text-muted">无课时显示明日课程</span>
          </span>
          <Switch
            checked={settings.tomorrowPreview}
            aria-label="空日程提示明日预告"
            onCheckedChange={(checked) => void onPatch({ tomorrowPreview: checked })}
          />
        </label>        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
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
        <Field label="时区" hint="默认上海；首次启动会按系统时区对齐一次">
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

    data: (
      <>
        <span className="text-xs text-muted">本地存储：{storageKind}</span>
        {platform !== 'tauri' && platform !== 'capacitor' && (
          <span className="text-xs text-muted">
            浏览器持久化：{persistent === null ? '未申请' : persistent ? '已授权' : '未授权'}
          </span>
        )}
        {canConfigureStorage() ? (
          <>
            <div className="flex flex-col gap-1" data-role="storage-location">
              <span className="text-xs text-muted" data-role="storage-dir">
                存储位置：{storageInfo === null ? '读取中' : storageInfo.dir}
                {storageInfo === null ? '' : storageInfo.portable ? '（便携版）' : '（安装版）'}
              </span>
              <Field label="自定义存储位置" hint="留空用默认" help="相对路径相对程序目录；改完重启生效">
                <Input
                  data-role="storage-path"
                  value={storagePathInput}
                  placeholder={storageInfo?.defaultDir ?? ''}
                  onChange={(event) => setStoragePathInput(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="保存存储位置"
                  disabled={storageBusy}
                  onClick={() => void runBusy('正在保存存储位置…', () => saveStorage(storagePathInput))}
                >
                  保存位置
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="恢复默认存储位置"
                  disabled={storageBusy}
                  onClick={() => void saveStorage('')}
                >
                  恢复默认
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="打开数据目录"
                  onClick={() => void openDataDirectory()}
                >
                  打开数据目录
                </Button>
              </div>
              {storageInfo !== null && (
                <span className="text-xs text-muted" data-role="storage-detail">
                  数据库文件：{storageInfo.dbFile}（
                  {storageInfo.dbExists ? `${Math.round(storageInfo.dbBytes / 1024)} KB` : '尚未创建'}）
                  {storageInfo.sidecars.length > 0 ? `，附带 ${storageInfo.sidecars.join(' / ')}` : '，无附带文件'}
                </span>
              )}
              {storageError !== null && (
                <span className="text-xs text-danger-strong" data-role="storage-error">
                  {storageError}
                </span>
              )}
              {storageMessage !== null && (
                <span className="text-xs text-muted" data-role="storage-message">
                  {storageMessage}
                </span>
              )}
              {restartNeeded && (
                <Button size="sm" variant="primary" aria-label="立即重启" onClick={() => void restartNow()}>
                  立即重启
                </Button>
              )}
            </div>
          </>
        ) : platform === 'capacitor' ? (
          <span className="text-xs text-muted">存储位置：应用私有目录（不可改）</span>
        ) : null}
        {platform !== 'web' && (
          <div className="flex flex-col gap-1" data-role="wal-setting">
            <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
              <span>启用 WAL 日志模式</span>
              <Switch
                aria-label="启用 WAL 日志模式"
                data-role="wal-switch"
                checked={walOn}
                onCheckedChange={(checked) => void toggleWal(checked)}
              />
            </label>
            <span className="text-xs text-muted" data-role="wal-hint">
              {settings.walMode === 'auto'
                ? `跟随默认：便携版关闭、安装版开启（当前${walOn ? '开启' : '关闭'}）`
                : settings.walMode === 'on'
                  ? '已手动开启：数据库旁会有 -wal / -shm 两个文件'
                  : '已手动关闭：数据库为单个文件，不产生 -wal / -shm'}
            </span>
          </div>
        )}
        <span className="text-xs text-muted">
          跨设备迁移用导出导入
        </span>
        <span className="text-xs text-muted">预设来源：dawn-tick-presets</span>
        <div className="flex flex-col gap-1" data-role="backup-settings">
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>自动备份</span>
            <Switch
              aria-label="自动备份"
              checked={settings.autoBackup}
              onCheckedChange={(checked) => void onPatch({ autoBackup: checked })}
            />
          </label>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>启动时备份一次</span>
            <Switch
              aria-label="启动时备份"
              checked={settings.backupOnStart}
              disabled={!settings.autoBackup}
              onCheckedChange={(checked) => void onPatch({ backupOnStart: checked })}
            />
          </label>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>每天备份一次</span>
            <Switch
              aria-label="每天备份"
              checked={settings.backupDaily}
              disabled={!settings.autoBackup}
              onCheckedChange={(checked) => void onPatch({ backupDaily: checked })}
            />
          </label>
          <Field label="保留份数" hint="1–100 份，超出后自动删最旧的">
            <Input
              data-role="backup-keep"
              type="number"
              min={1}
              max={100}
              value={settings.backupKeep}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1 && value <= 100) {
                  void onPatch({ backupKeep: Math.round(value) });
                }
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label="立即备份"
              disabled={snapshotBusy}
              onClick={() => void runBusy('正在备份…', () => backupNow())}
            >
              立即备份
            </Button>
            <span className="text-xs text-muted" data-role="backup-kind">
              {snapshotKind() === 'file' ? '整库文件快照（数据目录 backups）' : '库内 JSON 快照'}
            </span>
          </div>
          {snapshotMessage !== null && (
            <span className="text-xs text-muted" data-role="snapshot-message">
              {snapshotMessage}
            </span>
          )}
          {snapshots.length === 0 ? (
            <span className="text-xs text-muted" data-role="snapshot-empty">
              暂无快照
            </span>
          ) : (
            <ul className="flex flex-col gap-1" data-role="snapshot-list">
              {snapshots.map((entry) => (
                <li
                  key={entry.id}
                  data-role="backup-row"
                  className="flex flex-wrap items-center gap-2 text-xs text-ink"
                >
                  <span>{formatDateTime(entry.createdAt, settings.timeZone)}</span>
                  <span className="text-muted">{formatBytes(entry.bytes)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`恢复快照 ${entry.id}`}
                    disabled={snapshotBusy}
                    onClick={() => void runBusy('正在恢复快照…', () => restoreSnapshotNow(entry))}
                  >
                    恢复
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除快照 ${entry.id}`}
                    disabled={snapshotBusy}
                    onClick={() => void runBusy('正在删除快照…', () => removeSnapshot(entry))}
                  >
                    删除
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {snapshotRestartNeeded && (
            <Button size="sm" variant="primary" aria-label="重启以应用恢复" onClick={() => void restartNow()}>
              立即重启
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-1" data-role="webdav-settings">
          <span className="text-sm font-medium text-ink">WebDAV 云同步</span>
          <Field label="WebDAV 地址" hint="填完整目录 URL，例如 https://dav.example.com/remote.php/dav/files/me/DawnTick">
            <Input
              data-role="webdav-url"
              value={settings.webdavUrl}
              placeholder="https://dav.example.com/dav/DawnTick"
              onChange={(event) => void onPatch({ webdavUrl: event.target.value })}
            />
          </Field>
          <Field label="用户名">
            <Input
              data-role="webdav-user"
              value={settings.webdavUser}
              onChange={(event) => void onPatch({ webdavUser: event.target.value })}
            />
          </Field>
          <Field label="密码" hint="只存在本机设置里，不参与导出">
            <Input
              data-role="webdav-password"
              type="password"
              value={settings.webdavPassword}
              onChange={(event) => void onPatch({ webdavPassword: event.target.value })}
            />
          </Field>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>自动同步</span>
            <Switch
              aria-label="自动同步"
              checked={settings.webdavAuto}
              onCheckedChange={(checked) => void onPatch({ webdavAuto: checked })}
            />
          </label>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>启动时同步一次</span>
            <Switch
              aria-label="启动时同步"
              checked={settings.webdavOnStart}
              disabled={!settings.webdavAuto}
              onCheckedChange={(checked) => void onPatch({ webdavOnStart: checked })}
            />
          </label>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>每天同步一次</span>
            <Switch
              aria-label="每天同步"
              checked={settings.webdavDaily}
              disabled={!settings.webdavAuto}
              onCheckedChange={(checked) => void onPatch({ webdavDaily: checked })}
            />
          </label>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>远端保留历史多份</span>
            <Switch
              aria-label="远端保留历史多份"
              checked={settings.webdavHistory}
              onCheckedChange={(checked) => void onPatch({ webdavHistory: checked })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label="测试 WebDAV 连接"
              disabled={davBusy || !davConfigured(dav)}
              onClick={() => void runBusy('正在测试连接…', () => testDav())}
            >
              测试连接
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label="上传到 WebDAV"
              disabled={davBusy || !davConfigured(dav)}
              onClick={() => void runBusy('正在上传到 WebDAV…', () => uploadDav())}
            >
              立即上传
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label="从 WebDAV 下载"
              disabled={davBusy || !davConfigured(dav)}
              onClick={() => setDavConfirmOpen(true)}
            >
              立即下载
            </Button>
          </div>
          {davStatus !== null && (
            <span className="text-xs text-muted" data-role="webdav-status">
              {davStatus}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setExportOpen(true)}>
            导出配置
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            aria-label="导入配置"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-4" aria-hidden />
            导入配置
          </Button>
          {diagnosticsVisible && (
            <Button size="sm" variant="secondary" onClick={() => void runBusy('正在导出日志…', () => exportLogs())}>
              导出日志
            </Button>
          )}
          {canUseWidget() && diagnosticsVisible && (
            <Button size="sm" variant="secondary" onClick={() => void showLogDirectory()}>
              打开日志文件所在目录
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json,.zip,.txt"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void chooseBackupFile(file);
              event.target.value = '';
            }}
          />
        </div>
        {backupMessage !== null && <span className="text-xs text-muted">{backupMessage}</span>}
      </>
    ),

    maintenance: (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="检查更新"
            disabled={updateBusy}
            onClick={() => void runBusy('正在检查更新…', () => runUpdateCheck())}
          >
            检查更新
          </Button>
          <ExternalLink
            dataRole="release-page-link"
            className="text-xs text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/releases"
            ariaLabel="打开发布页（GitHub）"
          >
            打开发布页
          </ExternalLink>
          {updateResult !== null && <span className="text-xs text-muted" data-role="update-result">{updateResult}</span>}
        </div>
        {CHANNEL !== 'dev' ? (
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span className="flex min-w-0 flex-col">
              <span>接收测试版更新</span>
              <span className="truncate text-xs text-muted">
                {CHANNEL === 'beta' ? '默认开启；关闭后只收正式版' : '默认关闭；开启后才会收到 beta 版'}
              </span>
            </span>
            <Switch
              checked={resolveReceiveBeta(settings.receiveBeta, CHANNEL)}
              aria-label="接收测试版更新"
              onCheckedChange={(checked) => void onPatch({ receiveBeta: checked })}
            />
          </label>
        ) : (
          <span className="text-xs text-muted">开发渠道：只接收 dev 构建，不参与测试版开关</span>
        )}
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>自动检查版本更新</span>
            <span className="truncate text-xs text-muted">启动后自动查一次，有新版本时弹出更新信息</span>
          </span>
          <Switch
            checked={settings.autoCheckUpdate}
            aria-label="自动检查版本更新"
            onCheckedChange={(checked) => void onPatch({ autoCheckUpdate: checked })}
          />
        </label>
        {CHANNEL === 'dev' && (
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span className="flex min-w-0 flex-col">
              <span>开发者特性</span>
              <span className="truncate text-xs text-muted">
                关闭后按正式版运行
              </span>
            </span>
            <Switch
              checked={settings.devFeatures}
              aria-label="开发者特性"
              onCheckedChange={(checked) => void onPatch({ devFeatures: checked })}
            />
          </label>
        )}

        {/* 应用诊断日志：开关控制 dawn-tick.log，级别决定门槛 */}
        <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-role="log-settings">
          <span className="text-sm font-medium text-ink">应用诊断日志</span>
          <span className="text-xs text-muted">
            写入文件的门槛
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" aria-label="打开日志" onClick={() => void runBusy('正在导出日志…', () => exportLogs())}>
              打开日志
            </Button>
            <span className="text-xs text-muted">导出当前缓冲区</span>
          </div>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>启用应用诊断日志</span>
            <Switch
              checked={settings.logEnabled}
              aria-label="启用应用诊断日志"
              onCheckedChange={(checked) => void onPatch({ logEnabled: checked })}
            />
          </label>
          <Field label="日志级别" hint="设置输出的最低日志级别">
            <Select value={settings.logLevel} onValueChange={(value) => void onPatch({ logLevel: value as LogLevel })}>
              <SelectTrigger aria-label="日志级别">
                <span>{settings.logLevel}</span>
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level} · {LOG_LEVEL_HINT[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <span className="text-xs text-muted">
            error 仅严重错误 · warn 错误与警告 · info 一般操作信息（默认） · debug 详细信息 · trace 全部日志，最详细
          </span>
        </div>
        <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
          <span>预设仓库</span>
          <ExternalLink
            dataRole="preset-repo-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick-presets"
            ariaLabel="打开预设仓库 dawn-tick-presets（GitHub）"
          >
            https://github.com/muyangplus/dawn-tick-presets
          </ExternalLink>
          <span data-role="preset-version">
            预设版本：
            {presetSource === null
              ? '读取中…'
              : `${presetSource.version}（${presetSource.kind === 'cached' ? '已更新' : '内置'}）`}
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="检查预设更新"
            disabled={presetBusy}
            onClick={() => void runBusy('正在读取预设更新…', () => runPresetCheck())}
          >
            检查预设更新
          </Button>
          {presetResult !== null && (
            <span className="text-xs text-muted" data-role="preset-result">
              {presetResult}
            </span>
          )}
        </div>
        {canUseWidget() && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">
              运行权限：{elevated === null ? '读取中…' : elevated ? '管理员' : '普通用户'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              aria-label="以管理员身份重新启动"
              disabled={elevated !== false}
              onClick={() => void requestElevation()}
            >
              以管理员身份重新启动
            </Button>
          </div>
        )}
        <span className="text-xs text-muted">只在应用内检查版本</span>
      </>
    ),

    about: (
      <>
        <div className="flex flex-col gap-1" data-role="about-help">
          <span className="text-sm font-medium text-ink">帮助与反馈</span>
          <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
            <span>问题与建议</span>
            <ExternalLink
              dataRole="issues-link"
              className="text-primary-strong underline"
              href="https://github.com/muyangplus/dawn-tick/issues"
              ariaLabel="打开发布仓库的 Issues（GitHub）"
            >
              Issues
            </ExternalLink>
            <span>使用说明</span>
            <ExternalLink
              dataRole="readme-link"
              className="text-primary-strong underline"
              href="https://github.com/muyangplus/dawn-tick#readme"
              ariaLabel="打开使用说明（GitHub）"
            >
              README
            </ExternalLink>
          </span>
          <span className="text-xs text-muted">
            快捷键：/ 搜索 · ← → 平移一屏 · T 回到今天 · Esc 关闭弹窗与占位块
          </span>
          <span className="text-xs text-muted">
            学校适配与作息在独立仓库 dawn-tick-presets 维护，缺适配时可提交学校信息。
          </span>
        </div>

        <div className="flex flex-col gap-1" data-role="about-app">
          <span className="text-sm font-medium text-ink">应用与版本</span>
          <span className="text-xs text-muted">晓刻 DawnTick · 课表与日程提醒工具</span>
          <span className="tabular text-xs text-muted">
            版本 {appVersion()} · {CHANNEL_LABEL[CHANNEL]}
          </span>
          <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
            <span>许可证 Apache-2.0</span>
            <ExternalLink
              dataRole="license-link"
              className="text-primary-strong underline"
              href="https://github.com/muyangplus/dawn-tick/blob/main/LICENSE"
              ariaLabel="打开许可证原文（GitHub）"
            >
              许可证原文
            </ExternalLink>
          </span>
          <ExternalLink
            className="text-xs text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick"
          >
            https://github.com/muyangplus/dawn-tick
          </ExternalLink>
        </div>

        <div className="flex flex-col gap-1" data-role="about-credits">
          <span className="text-sm font-medium text-ink">致谢与第三方声明</span>
          <span className="text-xs text-muted">
            运行时依赖共 {RUNTIME_CREDITS.length} 项；许可证全文见仓库根目录 THIRD-PARTY-LICENSES.md。
          </span>
          <ExternalLink
            dataRole="licenses-link"
            className="text-xs text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/blob/main/THIRD-PARTY-LICENSES.md"
            ariaLabel="打开第三方许可证声明（GitHub）"
          >
            第三方许可证声明
          </ExternalLink>
          <details className="flex flex-col gap-1">
            <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-xs text-ink">
              展开依赖与许可证（{RUNTIME_CREDITS.length} 项）
            </summary>
            <ul className="flex flex-col gap-0.5 pt-1 text-xs text-muted">
              {RUNTIME_CREDITS.map((item) => (
                <li key={`${item.component}-${item.name}`} data-role="credit-row">
                  {item.component} · {item.name} {item.version} · {item.license}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </>
    ),
  };

  const cards = resolveCards('settings', layout);

  return (
    <div className="flex flex-col gap-3">
      {/* 卡片布局入口固定在顶部：卡片被隐藏也进得来 */}
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

      {cards.map((card) => {
        const body = bodies[card.def.id];
        if (body === undefined) return null;
        const section = settingsSection(card.def.id);
        return (
          <CollapsibleCard
            key={card.def.id}
            id={card.def.id}
            title={card.def.title}
            {...(section === undefined ? {} : { icon: section.icon })}
            {...(card.def.id === 'semesters' ? { badge: `${semesters.length} 个` } : {})}
          >
            {body}
          </CollapsibleCard>
        );
      })}

      <Dialog
        open={layoutOpen}
        onOpenChange={setLayoutOpen}
      >
        <DialogContent
          title="卡片布局"
          description="显示与排序卡片"
        >
          {layoutGroups}
          <DialogFooter>
            <Button variant="ghost" aria-label="关闭卡片布局" onClick={() => setLayoutOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              : `将删除「${removing.name}」及课程、日程与提醒，不可撤销`
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
        open={davConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setDavConfirmOpen(false);
        }}
      >
        <DialogContent
          title="从 WebDAV 下载"
          description="「恢复全部」会覆盖本机数据，需重启生效"
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDavConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="secondary"
              aria-label="下载并只应用设置与预设"
              disabled={davBusy}
              onClick={() => void runBusy('正在下载并应用…', () => downloadDav('settings'))}
            >
              只应用设置与预设
            </Button>
            <Button
              variant="danger"
              aria-label="下载并恢复整库"
              disabled={davBusy}
              onClick={() => void runBusy('正在下载并应用…', () => downloadDav('all'))}
            >
              恢复全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!open) {
            setExportOpen(false);
            setExportText('');
          }
        }}
      >
        <DialogContent title="导出配置" description="勾选要导出的模块，并选择导出格式">
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
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={exportFormat === 'json' ? 'primary' : 'secondary'}
              aria-label="导出为 JSON 文件"
              onClick={() => setExportFormat('json')}
            >
              JSON 文件
            </Button>
            <Button
              size="sm"
              variant={exportFormat === 'base64' ? 'primary' : 'secondary'}
              aria-label="导出为 Base64 文本"
              onClick={() => setExportFormat('base64')}
            >
              Base64 文本
            </Button>
            <Button
              size="sm"
              variant={exportFormat === 'zip' ? 'primary' : 'secondary'}
              aria-label="导出为整包 zip"
              onClick={() => setExportFormat('zip')}
            >
              整包 zip
            </Button>
          </div>
          {exportFormat === 'zip' && (
            <div className="flex flex-col gap-1">
              <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label="整包包含预设快照"
                  checked={bundlePresets}
                  onChange={(event) => setBundlePresets(event.target.checked)}
                />
                一并打包预设快照
              </label>
              <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label="整包包含日志文件"
                  checked={bundleLogs}
                  onChange={(event) => setBundleLogs(event.target.checked)}
                />
                一并打包日志文件
              </label>
            </div>
          )}
          {exportFormat === 'base64' && exportText !== '' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted">复制下面这段文本，或保存成文件后传输。</span>
              <textarea
                readOnly
                data-role="export-base64"
                aria-label="Base64 备份文本"
                className="h-32 w-full rounded-md border border-line bg-surface-muted p-2 text-[11px] text-muted"
                value={exportText}
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void copyText(exportText).then((ok) => {
                      setBackupMessage(ok ? '已复制 Base64 文本' : '复制失败，请手动选中复制');
                    });
                  }}
                >
                  复制文本
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void saveBase64Backup()}>
                  保存为文件
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy || exportModules.size === 0} onClick={() => void downloadBackup()}>
              {exportFormat === 'base64' ? '生成文本' : '导出'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) setImportOpen(false);
        }}
      >
        <DialogContent title="导入配置" description="选择备份文件，或直接粘贴 JSON / Base64 文本">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label="选择备份文件"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              选择备份文件
            </Button>
            <span className="text-xs text-muted">支持晓刻导出的 JSON、Base64 文本与整包 zip</span>
          </div>
          <textarea
            data-role="import-text"
            aria-label="配置文本"
            placeholder="或在此粘贴 JSON / Base64 配置文本"
            className="h-32 w-full rounded-md border border-line bg-surface p-2 text-[11px] text-ink"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={importText.trim().length === 0} onClick={parsePastedBackup}>
              从文本导入
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
        <DialogContent title="导入配置" description="选模块与冲突处理">
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
            {IMPORT_MODES.map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={importMode === mode ? 'primary' : 'secondary'}
                aria-label={`导入方式：${IMPORT_MODE_LABEL[mode]}`}
                onClick={() => setImportMode(mode)}
              >
                {IMPORT_MODE_LABEL[mode]}
              </Button>
            ))}
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
