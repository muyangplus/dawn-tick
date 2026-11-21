/**
 * `AssistantHost` 的真实实现：复用设置页、备份与同步面板用的同一批函数，界面状态由 App 传进来。
 */
import {
  BACKUP_MODULES,
  activeSemester,
  listCourses,
  listSchedules,
  listTimeSlots,
  type AppSettings,
  type EventRow,
  type Storage,
} from '@dawn-tick/core';
import { createSnapshot, listSnapshots, pruneSnapshots, restoreSnapshot } from '../backup.ts';
import { CHANNEL, appVersion } from '../channel.ts';
import { assistantHostCopy as copy } from '../copy/assistant.ts';
import { snapshotsCopy } from '../copy/backup-snapshots.ts';
import { transferCopy } from '../copy/backup-transfer.ts';
import { exportReportCopy } from '../copy/export-report.ts';
import { statsCopy } from '../copy/home-stats.ts';
import { lanSyncPanelCopy } from '../copy/sync-lan-panel.ts';
import { lanSyncCopy } from '../copy/sync-lan.ts';
import { webdavCopy } from '../copy/sync-webdav.ts';
import { loadAppData } from '../data/load.ts';
import { exportConfig } from '../data-management.ts';
import { markLanPairingSynced, pairingSession, updateLanPairingToken } from '../lan-pairings.ts';
import { pullFromPeer, sessionExpired } from '../lan-sync-client.ts';
import { createLanPairingStore } from '../lan-sync-pairing-store.ts';
import { probeLanPairing } from '../lan-sync-reconnect.ts';
import { readWebdavPassword } from '../lib/credentials.ts';
import { buildIcsExport } from '../lib/ics-export.ts';
import { buildSemesterStats } from '../lib/semester-stats.ts';
import { semesterReportCsv, semesterReportFileName } from '../lib/semester-report.ts';
import { updateFetch } from '../lib/update-fetch.ts';
import { registerPendingRestart } from '../pending-restart.ts';
import { saveText } from '../screens/settings/file-export.ts';
import { formatBytes } from '../screens/settings/format.ts';
import { checkForUpdate, resolveReceiveBeta } from '../update.ts';
import { davConfigured, downloadAndApply, uploadPackage, type DavSettings } from '../webdav.ts';
import { canUseWidget, showWidget } from '../widget-window.ts';
import type { AssistantHost, AssistantNavTarget } from './host.ts';

export interface AssistantHostDeps {
  storage: Storage;
  userId: string;
  settings(): AppSettings;
  /** 设置页同一条写入路径：校验、落库、热加载 */
  patchSettings(patch: Partial<AppSettings>): Promise<void>;
  /** 设置被同步或恢复整体替换后重新读一遍 */
  reloadSettings(): Promise<void>;
  /** 库里的数据变了，刷新界面 */
  onDataChanged(): void;
  navigate(target: AssistantNavTarget): void;
  openImport(text: string): void;
  now?: () => number;
}

function fail(what: string, reason: string | null): Error {
  return new Error(reason === null || reason === '' ? what : `${what}：${reason}`);
}

export function createAssistantHost(deps: AssistantHostDeps): AssistantHost {
  const { storage } = deps;
  const now = deps.now ?? Date.now;

  async function currentData() {
    const data = await loadAppData(storage, deps.settings());
    return data.semester === null ? null : data;
  }

  async function davSettings(): Promise<DavSettings> {
    const settings = deps.settings();
    // 密码只在这里现读、直接交给 WebDAV 请求，不经过模型
    const stored = await readWebdavPassword(storage);
    if (stored.state === 'error') throw new Error(stored.message ?? copy.webdavPasswordUnreadable);
    return {
      webdavUrl: settings.webdavUrl,
      webdavUser: settings.webdavUser,
      webdavPassword: stored.password,
      webdavHistory: settings.webdavHistory,
    };
  }

  async function savedText(name: string, text: string, extension: string, filter: string, mime: string, done: string) {
    const saved = await saveText(name, text, extension, filter, mime);
    return saved.saved ? done : copy.saveCancelled;
  }

  return {
    settings: () => deps.settings(),

    async patchSettings(patch) {
      await deps.patchSettings(patch);
      // 与设置页一致的后续处理
      if (patch.walMode !== undefined) registerPendingRestart('wal');
      if (patch.widgetVariant !== undefined && canUseWidget()) void showWidget(patch.widgetVariant);
    },

    navigate: (target) => deps.navigate(target),
    openImport: (text) => deps.openImport(text),

    async exportBackup() {
      const outcome = await exportConfig(storage, {
        modules: BACKUP_MODULES,
        format: 'json',
        bundlePresets: false,
        bundleLogs: false,
      });
      if (outcome.cancelled) return copy.saveCancelled;
      if (!outcome.ok) throw fail(copy.backupFailed, outcome.error);
      return copy.backupExported(outcome.rows);
    },

    async exportIcs(includeEvents) {
      const semester = await activeSemester(storage, deps.userId);
      if (semester === undefined) throw new Error(copy.noSemester);
      const [slots, courses, schedules, events] = await Promise.all([
        listTimeSlots(storage, semester.id),
        listCourses(storage, semester.id),
        listSchedules(storage, semester.id),
        storage.collection<EventRow>('events').getAll(),
      ]);
      const plan = buildIcsExport({ semester, slots, courses, schedules, events }, { includeEvents });
      return savedText(plan.fileName, plan.text, 'ics', transferCopy.icsFilter, 'text/calendar', transferCopy.icsExported(plan.counts.courses));
    },

    async exportReport() {
      const data = await currentData();
      if (data === null) throw new Error(copy.noSemester);
      const stats = buildSemesterStats(data, now());
      const csv = semesterReportCsv(stats, data.semester?.name ?? exportReportCopy.semester);
      return savedText(semesterReportFileName(data.today), csv, 'csv', statsCopy.csvFilterName, 'text/csv', statsCopy.exported);
    },

    async semesterStats() {
      const data = await currentData();
      if (data === null) return null;
      const stats = buildSemesterStats(data, now());
      return { name: data.semester?.name ?? null, ...stats };
    },

    async createSnapshot() {
      const entry = await createSnapshot(storage, now());
      if (entry === null) throw new Error(copy.snapshotFailed);
      await pruneSnapshots(storage, deps.settings().backupKeep);
      return copy.snapshotCreated(entry.id);
    },

    async listSnapshots() {
      const entries = await listSnapshots(storage);
      return entries.map(({ id, createdAt, bytes }) => ({ id, createdAt, bytes }));
    },

    async restoreSnapshot(id) {
      const entry = (await listSnapshots(storage)).find((item) => item.id === id);
      if (entry === undefined) throw new Error(copy.snapshotMissing(id));
      const outcome = await restoreSnapshot(storage, entry);
      if (!outcome.ok) throw fail(copy.restoreFailed, outcome.error);
      if (outcome.needsRestart) {
        registerPendingRestart('snapshot-restore');
        return snapshotsCopy.restoreQueued;
      }
      await deps.reloadSettings();
      deps.onDataChanged();
      return snapshotsCopy.restoredWithCounts(outcome.result?.imported ?? 0, outcome.result?.removed ?? 0, false);
    },

    webdavConfigured: () => davConfigured(deps.settings()),

    async webdavUpload() {
      const result = await uploadPackage(storage, await davSettings(), now());
      if (!result.ok) throw fail(copy.webdavFailed, result.error);
      return webdavCopy.uploaded(result.name, formatBytes(result.bytes));
    },

    async webdavDownload(mode) {
      const result = await downloadAndApply(storage, await davSettings(), mode);
      if (!result.ok) throw fail(copy.webdavFailed, result.error);
      const outcome = result.outcome;
      await deps.reloadSettings();
      if (mode === 'settings') {
        return webdavCopy.appliedSettings(outcome?.settings?.imported ?? 0, outcome?.presets === true, false);
      }
      // 整库恢复要重启才完全生效
      registerPendingRestart('webdav-restore');
      deps.onDataChanged();
      return webdavCopy.restoredAll(outcome?.full?.imported ?? 0, outcome?.full?.removed ?? 0, false);
    },

    async lanDevices() {
      const pairings = await createLanPairingStore(storage).load();
      return pairings.map((item) => ({ id: item.id, name: item.name, lastSyncAt: item.lastSyncAt }));
    },

    async lanSync(deviceId, scopes) {
      const store = createLanPairingStore(storage);
      const pairings = await store.load();
      const pairing = pairings.find((item) => item.id === deviceId);
      if (pairing === undefined) throw new Error(copy.lanDeviceMissing(deviceId));
      const probe = await probeLanPairing(pairing, now());
      if (probe.state !== 'online') throw new Error(copy.lanOffline(pairing.name, probe.error ?? lanSyncCopy.unreachable));
      const token = probe.token ?? pairing.token;
      const session = {
        ...pairingSession(pairing),
        token,
        ...(probe.expiresAt === undefined ? {} : { expiresAt: probe.expiresAt }),
      };
      if (sessionExpired(session, now())) throw new Error(lanSyncPanelCopy.pairingExpired);
      const result = await pullFromPeer(storage, session, scopes, now());
      if (!result.ok) throw fail(copy.lanFailed, result.error);
      const updated = markLanPairingSynced(updateLanPairingToken(await store.load(), pairing.id, token), pairing.id, now());
      await store.save(updated);
      if (scopes.includes('settings')) await deps.reloadSettings();
      if (result.imported > 0) deps.onDataChanged();
      return lanSyncPanelCopy.syncedWith(pairing.name, result.imported, result.skipped);
    },

    async checkUpdate() {
      const settings = deps.settings();
      const status = await checkForUpdate({
        channel: CHANNEL,
        receiveBeta: resolveReceiveBeta(settings.receiveBeta, CHANNEL),
        currentVersion: appVersion(),
        fetchImpl: updateFetch(),
        ...(settings.downloadSource === 'auto' ? {} : { source: settings.downloadSource }),
        fallback: true,
      });
      if (status.error !== null) throw fail(copy.updateFailed, status.error);
      return {
        available: status.available,
        current: status.current,
        latest: status.latest,
        channel: status.feed,
        notes: status.manifest?.notes ?? null,
      };
    },
  };
}
