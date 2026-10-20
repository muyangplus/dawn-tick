import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutGrid, Upload } from 'lucide-react';
import {
  BACKUP_MODULES,
  BACKUP_MODULE_LABEL,
  IMPORT_MODE_LABEL,
  IMPORT_MODES,
  formatDateTime,
  LOG_LEVELS,
  summarizeBackup,
  type AppSettings,
  type BackupModule,
  type BackupPayload,
  type ImportMode,
  type LogLevel,
  type Storage,
} from '@dawn-tick/core';
import {
  exportConfig,
  importConfig,
  importResultText,
  parseImportText,
  presentModules,
  readImportFile,
  type ExportFormat,
  type PackageExtras,
} from '../data-management.ts';
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
import { clearLogs, logInfo, logsText, logWarn } from '../log.ts';
import { canUseWidget } from '../widget-window.ts';
import { copyText, openLogDirectory, saveTextFile } from '../system-actions.ts';
import {
  canConfigureStorage,
  openDataDirectory,
  readStorageInfo,
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
import { DELETE, fail } from '../copy/zh.ts';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { confirmAction } from '../components/ui/confirm-dialog.tsx';
import { ExternalLink } from '../components/ui/external-link.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { HelpHint } from '../components/ui/help-hint.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, Switch } from '../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../components/ui/status-line.tsx';
import { registerPendingRestart } from '../pending-restart.ts';
import { toast } from '../components/ui/toaster.tsx';
import { cn } from '../lib/cn.ts';
import { CardLayoutDialog } from './cards/layout-panel.tsx';
import { readLayout } from './cards/layout-store.ts';
import { cardsInZone, type LayoutConfig, type ResolvedCard } from './cards/registry.ts';
import { devicesSection } from './cards/devices-cards.tsx';
import { rememberCollapsed } from '../lib/collapse-store.ts';
/** 关于卡片列出的运行时依赖与许可证：由 tools/legal/collect-licenses.mjs 生成。 */
import { RUNTIME_CREDITS } from '../legal/credits.generated.ts';

/** 预设来源对用户只说是仓库；具体取源（raw / API）只进日志。 */
const PRESET_SOURCE_LABEL = '预设仓库（GitHub）';

/** 日志级别说明（与维护卡片文案一致）。 */
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

/** 状态行统一带时间：动作结果另走 toast，这里留可回看的「上一次操作」。 */
function said(text: string): StatusMessage {
  return { text, at: Date.now() };
}

export interface DevicesViewProps {
  storage: Storage;
  settings: AppSettings;
  /** 浏览器持久化权限：已申请 / 已授权 / 未授权 */
  persistent: boolean | null;
  /** 存储类型的可读文案，如 IndexedDB / SQLite */
  storageKind: string;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
  /** 从库外写入设置后（如 WebDAV 只应用设置）重新读取设置并热加载 */
  onSettingsReplaced: () => Promise<void>;
}

/**
 * 设备与同步页：承载存储类型 / 渠道 / 版本 / 检查更新 / 同步入口 / 关于。
 * 「我的」占位项改建而来，设置页只留偏好类卡片。
 */
export function DevicesView({
  storage,
  settings,
  persistent,
  storageKind,
  onPatch,
  onChanged,
  onSettingsReplaced,
}: DevicesViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateResult, setUpdateResult] = useState<StatusMessage | null>(null);
  const [presetSource, setPresetSource] = useState<PresetSource | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetResult, setPresetResult] = useState<StatusMessage | null>(null);
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storagePathInput, setStoragePathInput] = useState('');
  const [storageMessage, setStorageMessage] = useState<StatusMessage | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [snapshotMessage, setSnapshotMessage] = useState<StatusMessage | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [davStatus, setDavStatus] = useState<StatusMessage | null>(null);
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
        toast.error(fail('保存存储位置', result.error, '请检查路径后重试'));
        return;
      }
      setStorageInfo(result.info);
      setStoragePathInput(result.info.customPath);
      const copied = result.info.copied.length;
      setStorageMessage(said(copied > 0 ? `已保存存储位置，复制了 ${copied} 个数据文件` : '已保存存储位置'));
      toast.success(`已写入 ${result.info.dir}${copied > 0 ? `，复制了 ${copied} 个数据文件` : ''}`);
      // 存储位置要重启才生效：只登记，不在这里渲染提示与按钮
      registerPendingRestart('storage-path');
    } finally {
      setStorageBusy(false);
    }
  }

  /** 日志模式存在库里，下次打开数据库时套用。 */
  async function toggleWal(next: boolean): Promise<void> {
    await onPatch({ walMode: next ? 'on' : 'off' });
    setStorageMessage(said('已保存 WAL 日志模式'));
    toast.success('已保存 WAL 日志模式');
    registerPendingRestart('wal');
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
        toast.error(fail('快照', null, '请查看「应用诊断日志」后重试'));
        return;
      }
      const removed = await pruneSnapshots(storage, settings.backupKeep);
      await refreshSnapshots();
      setSnapshotMessage(said('已备份'));
      toast.success(
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
      if (ok) {
        toast.success('已删除该快照');
        return;
      }
      toast.error(fail('删除快照', null, '请查看「应用诊断日志」后重试'));
    } finally {
      setSnapshotBusy(false);
    }
  }

  /** 恢复/删除快照都要先确认；句式统一走 copy/zh.ts。 */
  async function confirmRestoreSnapshot(entry: SnapshotEntry): Promise<void> {
    const ok = await confirmAction({
      title: '恢复快照',
      description: '将用该快照覆盖本机数据，需要重启后生效，不可撤销',
      confirmLabel: '确认恢复',
    });
    if (!ok) return;
    await restoreSnapshotNow(entry);
  }

  async function confirmRemoveSnapshot(entry: SnapshotEntry): Promise<void> {
    const ok = await confirmAction({
      title: '删除快照',
      description: DELETE('该快照'),
      confirmLabel: '确认删除',
    });
    if (!ok) return;
    await removeSnapshot(entry);
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
        toast.error(fail('恢复快照', outcome.error, '请查看「应用诊断日志」后重试'));
        return;
      }
      await refreshSnapshots();
      if (outcome.needsRestart) {
        // 文件快照要重启后才套用：登记给统一待重启条
        registerPendingRestart('snapshot-restore');
        setSnapshotMessage(said('已排好快照恢复'));
        toast.success('已排好快照恢复');
        return;
      }
      const result = outcome.result;
      const text =
        result === null
          ? '已恢复快照'
          : `已恢复快照：写入 ${result.imported} 条，清空 ${result.removed} 条${safe === null ? '' : '（恢复前已创建快照）'}`;
      setSnapshotMessage(said(text));
      toast.success(text);
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
    setDavStatus(said('正在测试连接…'));
    try {
      const status = await testConnection(dav);
      if (!status.ok) {
        const message = fail('连接 WebDAV', status.error ?? `服务器返回 ${status.status}`, '请检查地址、账号与网络');
        setDavStatus(said(message));
        toast.error(message);
        return;
      }
      const remote =
        status.lastModified === null
          ? status.exists
            ? '远端已有备份'
            : '远端暂无备份'
          : `远端备份时间 ${formatDateTime(status.lastModified, settings.timeZone)}`;
      const message = `连接正常，${remote}`;
      setDavStatus(said(message));
      toast.success(message);
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
        const message = fail('上传', result.error, '请检查网络后重试');
        setDavStatus(said(message));
        toast.error(message);
        return;
      }
      await refreshSnapshots();
      const message = `已上传 ${result.name}（${formatBytes(result.bytes)}）`;
      setDavStatus(said(message));
      toast.success(message);
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
        const message = fail('下载', result.error, '请检查网络后重试');
        setDavStatus(said(message));
        toast.error(message);
        return;
      }
      const outcome = result.outcome;
      if (mode === 'settings') {
        const count = outcome?.settings?.imported ?? 0;
        const message = `已应用设置与预设（写入 ${count} 条${outcome?.presets === true ? '，含预设' : ''}）${safe === null ? '' : '，下载前已创建快照'}`;
        setDavStatus(said(message));
        toast.success(message);
        await onSettingsReplaced();
        return;
      }
      const message = `已恢复整库（写入 ${outcome?.full?.imported ?? 0} 条，清空 ${outcome?.full?.removed ?? 0} 条）${safe === null ? '' : '，下载前已创建快照'}`;
      setDavStatus(said(message));
      toast.success(message);
      // 整库恢复要重启才完全生效：统一登记给待重启条
      registerPendingRestart('webdav-restore');
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
      toast.error(fail('提权', message, '请手动以管理员身份运行'));
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
        const message = fail('检查更新', status.error, '请稍后再试');
        setUpdateResult(said(message));
        toast.error(message);
        logWarn('update', '检查更新失败', { error: status.error, feed: status.feed });
        return;
      }
      const manifest = status.manifest;
      const message = status.available
        ? `发现新版本 ${status.latest}（${CHANNEL_LABEL[status.feed]}），可在发布页下载`
        : `已是最新版本（${CHANNEL_LABEL[status.feed]}）`;
      setUpdateResult(said(message));
      toast.success(message);
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

  /** 检查预设更新：快照写入缓存、下次启动由 resolvePresetSource 生效；失败时界面沿用内置预设。 */
  async function runPresetCheck(): Promise<void> {
    setPresetBusy(true);
    try {
      const currentVersion = presetSource?.version ?? BUILTIN_PRESET_VERSION;
      const status = await checkPresetUpdate({ cachedVersion: currentVersion });
      if (status.error !== null) {
        const message = fail('检查预设更新', status.error, '请稍后再试');
        setPresetResult(said(message));
        toast.error(message);
        logWarn('preset', '检查预设更新失败', { error: status.error, current: currentVersion });
        return;
      }
      if (!status.available || status.version === null) {
        const message = `预设已是最新（${currentVersion}）${status.source === undefined ? '' : `，来源 ${PRESET_SOURCE_LABEL}`}`;
        setPresetResult(said(message));
        toast.success(message);
        logInfo('preset', '预设已是最新', { current: currentVersion, latest: status.version, source: status.source });
        return;
      }
      const snapshot = await fetchSnapshot(status.version);
      await writeCachedSnapshot(storage, snapshot);
      // 快照是清单；正文在这一步校验后一并落盘，不合法时只记日志、下次启动回退内置。
      const content = await cacheSnapshotContent(storage, snapshot);
      if (!content.ok) {
        logWarn('preset', '预设正文校验未通过，已缓存清单但不缓存正文', {
          version: snapshot.version,
          message: content.reason ?? '未知原因',
        });
      }
      setPresetSource(await resolvePresetSource(storage));
      const message = `已下载预设 ${snapshot.version}（${snapshot.sources.timetables.length} 套作息、${snapshot.sources.systems.length} 个教务系统），下次启动生效`;
      setPresetResult(said(message));
      toast.success(message);
      // 预设要下次启动才套用：与其它待重启改动共用一条提示
      registerPendingRestart('preset-update');
      logInfo('preset', '已下载预设快照', { version: snapshot.version, hash: snapshot.hash });
    } catch (cause: unknown) {
      const message = fail('检查预设更新', cause instanceof Error ? cause.message : String(cause), '请稍后再试');
      setPresetResult(said(message));
      toast.error(message);
      logWarn('preset', '下载预设快照失败', {
        message: cause instanceof Error ? cause.message : String(cause),
      });
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
  const [importOpen, setImportOpen] = useState(false);
  /** 设备页顶部快捷动作「恢复快照」：重挂卡片以按最新收起状态渲染 */
  const [cardEpoch, setCardEpoch] = useState(0);
  const [exportModules, setExportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));
  const [pendingImport, setPendingImport] = useState<BackupPayload | null>(null);
  /** 整包里带出的预设与日志：导入时随设置一起恢复，JSON 粘贴输入为 null */
  const [pendingImportExtras, setPendingImportExtras] = useState<PackageExtras | null>(null);
  const [importModules, setImportModules] = useState<Set<BackupModule>>(new Set(BACKUP_MODULES));
  const [importMode, setImportMode] = useState<ImportMode>('skip');
  const [layout, setLayout] = useState<LayoutConfig>({});
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** 诊断入口：dev/beta 可见；dev 关掉开发者特性后与正式版一致地隐藏 */
  const diagnosticsVisible = featureVisible('diagnostics') && (CHANNEL !== 'dev' || settings.devFeatures);

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

  /** 桌面端走系统保存对话框，其余端下载；结果由调用方 toast。 */
  async function saveText(name: string, content: string, extension: string, filterName: string): Promise<boolean> {
    const result = await saveTextFile(name, content, { extension, filterName });
    if (result.cancelled) {
      toast.info('已取消保存');
      return false;
    }
    if (!result.ok) {
      toast.error(fail('保存', result.error, '请换一个位置后重试'));
      return false;
    }
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
    if (dir === null) {
      toast.error(fail('打开日志目录', null, '请到「设置 → 同步与数据」查看数据目录'));
      return;
    }
    toast.info(`日志目录：${dir}`);
  }

  async function downloadBackup(): Promise<void> {
    setBusy(true);
    try {
      const modules = [...exportModules];
      if (modules.length === 0) {
        toast.error('请至少勾选一个模块');
        return;
      }
      const outcome = await exportConfig(storage, {
        modules,
        format: exportFormat,
        bundlePresets,
        bundleLogs,
      });
      if (outcome.cancelled) {
        toast.info('已取消保存');
        return;
      }
      if (!outcome.ok) {
        toast.error(fail('导出', outcome.error, '请重试或换一个保存位置'));
        return;
      }
      const label = modules.map((module) => BACKUP_MODULE_LABEL[module]).join('、');
      if (exportFormat === 'base64' && outcome.text !== null) {
        setExportText(outcome.text);
        toast.success(`已生成 Base64 文本（${label}）`);
        return;
      }
      toast.success(outcome.path === null ? `已下载 ${outcome.name}` : `已保存到 ${outcome.path}`);
      setExportOpen(false);
    } finally {
      setBusy(false);
    }
  }

  /** 导出 Base64 文本到文件：内容与文本框一致。 */
  async function saveBase64Backup(): Promise<void> {
    if (exportText === '') return;
    const day = new Date().toISOString().slice(0, 10);
    if (await saveText(`DawnTick-backup-${day}.base64.txt`, exportText, 'txt', 'Base64 文本')) {
      toast.success('已保存 Base64 文本');
      setExportOpen(false);
    }
  }

  /** 导入对话框里粘贴的文本：JSON 与 Base64 都接受。 */
  function parsePastedBackup(): void {
    const text = importText.trim();
    if (text === '') {
      toast.error('请先粘贴备份文本');
      return;
    }
    try {
      const payload = parseImportText(text);
      setPendingImport(payload);
      setPendingImportExtras(null);
      setImportModules(new Set(presentModules(payload)));
      setImportMode('skip');
      setImportOpen(false);
      toast.success('已解析粘贴的备份文本');
    } catch (cause: unknown) {
      toast.error(fail('解析备份文本', cause instanceof Error ? cause.message : String(cause), '请检查文本是否完整'));
    }
  }

  async function chooseBackupFile(file: File): Promise<void> {
    const { payload, extras, error } = await readImportFile(file);
    if (payload === null) {
      toast.error(fail('读取备份文件', error, '请换一个文件重试'));
      return;
    }
    setPendingImport(payload);
    setPendingImportExtras(extras);
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
        toast.error('请至少勾选一个模块');
        return;
      }
      const result = await importConfig(storage, pendingImport, {
        mode: importMode,
        modules,
        extras: pendingImportExtras,
      });
      toast.success(importResultText(result, importMode));
      setPendingImport(null);
      setPendingImportExtras(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const bodies: Record<string, ReactNode> = {
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
                  onClick={() =>
                    void openDataDirectory().then((dir) => {
                      if (dir === null) toast.error(fail('打开数据目录', null, '请手动到程序目录查看'));
                    })
                  }
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
                <StatusLine dataRole="storage-error" tone="danger">
                  {storageError}
                </StatusLine>
              )}
              {storageMessage !== null && (
                <StatusLine dataRole="storage-message" at={storageMessage.at}>
                  {storageMessage.text}
                </StatusLine>
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
        <div className="flex flex-col gap-1" data-role="backup-settings">
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>自动快照</span>
            <Switch
              aria-label="自动快照"
              checked={settings.autoBackup}
              onCheckedChange={(checked) => void onPatch({ autoBackup: checked })}
            />
          </label>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>启动时快照一次</span>
            <Switch
              aria-label="启动时快照"
              checked={settings.backupOnStart}
              disabled={!settings.autoBackup}
              onCheckedChange={(checked) => void onPatch({ backupOnStart: checked })}
            />
          </label>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span>每天快照一次</span>
            <Switch
              aria-label="每天快照"
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
              aria-label="立即创建快照"
              disabled={snapshotBusy}
              onClick={() => void runBusy('正在创建快照…', () => backupNow())}
            >
              立即创建快照
            </Button>
            <span className="text-xs text-muted" data-role="backup-kind">
              {snapshotKind() === 'file' ? '整库文件快照（保存在数据目录）' : '库内 JSON 快照'}
            </span>
          </div>
          {snapshotMessage !== null && (
            <StatusLine dataRole="snapshot-message" at={snapshotMessage.at}>
              {snapshotMessage.text}
            </StatusLine>
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
                    onClick={() => void confirmRestoreSnapshot(entry)}
                  >
                    恢复
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除快照 ${entry.id}`}
                    disabled={snapshotBusy}
                    onClick={() => void confirmRemoveSnapshot(entry)}
                  >
                    删除
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-1" data-role="webdav-settings">
          <span className="text-sm font-medium text-ink">WebDAV 云同步</span>
          <Field
            label="WebDAV 地址"
            hint="WebDAV 目录 URL"
            help="填完整目录地址，例如 https://dav.example.com/remote.php/dav/files/me/DawnTick"
          >
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
            <StatusLine dataRole="webdav-status" at={davStatus.at}>
              {davStatus.text}
            </StatusLine>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setExportOpen(true)}>
            导出备份
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            aria-label="导入备份"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-4" aria-hidden />
            导入备份
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
          {updateResult !== null && (
            <StatusLine dataRole="update-result" at={updateResult.at}>
              {updateResult.text}
            </StatusLine>
          )}
        </div>
        {CHANNEL !== 'dev' ? (
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span className="flex min-w-0 flex-col">
              <span>接收公测版更新</span>
              <span className="truncate text-xs text-muted">
                {CHANNEL === 'beta' ? '默认开启；关闭后只收正式版' : '默认关闭；开启后还会收到公测版'}
              </span>
            </span>
            <Switch
              checked={resolveReceiveBeta(settings.receiveBeta, CHANNEL)}
              aria-label="接收公测版更新"
              onCheckedChange={(checked) => void onPatch({ receiveBeta: checked })}
            />
          </label>
        ) : (
          <span className="text-xs text-muted">开发版只接收开发构建，不受此开关影响</span>
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
        </div>
        <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
          <span>预设仓库</span>
          <ExternalLink
            dataRole="preset-repo-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick-presets"
            ariaLabel="打开预设仓库（GitHub）"
          >
            GitHub
          </ExternalLink>
          <StatusLine dataRole="preset-version">
            预设版本：
            {presetSource === null
              ? '读取中…'
              : `${presetSource.version}（${presetSource.kind === 'cached' ? '已更新' : '内置'}）`}
          </StatusLine>
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
            <StatusLine dataRole="preset-result" at={presetResult.at}>
              {presetResult.text}
            </StatusLine>
          )}
        </div>
        {canUseWidget() && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusLine dataRole="elevation-status">
              运行权限：{elevated === null ? '读取中…' : elevated ? '管理员' : '普通用户'}
            </StatusLine>
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
          <span className="flex min-h-tap flex-wrap items-center gap-1 text-xs text-muted">
            <span>缺少学校适配？</span>
            <ExternalLink
              dataRole="preset-issue-link"
              className="text-primary-strong underline"
              href="https://github.com/muyangplus/dawn-tick-presets/issues"
              ariaLabel="提交学校信息（预设仓库 Issues）"
            >
              提交学校信息
            </ExternalLink>
            <HelpHint label="学校适配">学校适配与作息在独立的预设仓库维护</HelpHint>
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

  /** 设备与同步页卡片：主列在上、侧列在右；侧列由顶部「卡片布局」切换，没有侧列时不占宽度。 */
  const mainCards = cardsInZone('devices', layout, 'main');
  const sideCards = cardsInZone('devices', layout, 'side');
  /** 两列只在主列与侧列都有卡片时生效：全部卡片都切到侧列时，侧列自己占满整行（P2-07） */
  const twoColumn = mainCards.length > 0 && sideCards.length > 0;

  const renderCard = (card: ResolvedCard): ReactNode => {
    const body = bodies[card.def.id];
    if (body === undefined) return null;
    const section = devicesSection(card.def.id);
    return (
      <CollapsibleCard
        key={`${card.def.id}-${cardEpoch}`}
        id={card.def.id}
        title={card.def.title}
        {...(section === undefined ? {} : { icon: section.icon })}
      >
        {body}
      </CollapsibleCard>
    );
  };

  return (
    <div className="flex flex-col gap-3" data-role="devices-view" aria-label="设备与同步">
      {/* 数据类快捷动作固定在顶部，与设置页的导入课表分开，避免两处重复入口 */}
      <div className="flex flex-wrap items-center gap-2" data-role="devices-actions">
        <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
          导出备份
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            rememberCollapsed('data', false);
            setCardEpoch((value) => value + 1);
          }}
        >
          恢复快照
        </Button>
        <Button size="sm" variant="secondary" disabled={updateBusy} onClick={() => void runUpdateCheck()}>
          检查更新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-role="devices-toolbar">
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
        data-role="devices-grid"
      >
        <div className="flex min-w-0 flex-col gap-3" data-role="devices-main">
          {mainCards.map(renderCard)}
        </div>
        {sideCards.length > 0 && (
          <aside
            className="flex min-w-0 flex-col gap-3"
            data-role="devices-side"
            aria-label="设备与同步侧栏"
          >
            {sideCards.map(renderCard)}
          </aside>
        )}
      </div>

      <CardLayoutDialog
        open={layoutOpen}
        onOpenChange={setLayoutOpen}
        layout={layout}
        onChange={setLayout}
        storage={storage}
      />

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
        <DialogContent title="导出备份" description="勾选要导出的模块，并选择导出格式">
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
                  aria-label="整包包含预设"
                  checked={bundlePresets}
                  onChange={(event) => setBundlePresets(event.target.checked)}
                />
                一并打包预设
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
                      if (ok) {
                        toast.success('已复制 Base64 文本');
                        return;
                      }
                      toast.error(fail('复制', null, '请手动选中文本复制'));
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
        <DialogContent title="导入备份" description="选择备份文件，或直接粘贴 JSON / Base64 文本">
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
            aria-label="备份文本"
            placeholder="或在此粘贴 JSON / Base64 备份文本"
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
        <DialogContent title="导入备份" description="选模块与冲突处理">
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
