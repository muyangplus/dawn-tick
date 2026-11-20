import { useEffect, useState } from 'react';
import { LOG_LEVELS, type AppSettings, type LogLevel, type Storage } from '@dawn-tick/core';
import {
  BUILTIN_PRESET_VERSION,
  checkPresetUpdate,
  fetchSnapshot,
  resolvePresetSource,
  storeDownloadedSnapshot,
  type PresetSource,
} from '../../preset-update.ts';
import { CHANNEL } from '../../channel.ts';
import { resolveFeed, resolveReceiveBeta } from '../../update.ts';
import { DOWNLOAD_SOURCE_LABEL, MIRRORS, type DownloadSource } from '../../lib/download-source.ts';
import { resolveDownloadSource } from '../../lib/download-selection.ts';
import { updateFetch } from '../../lib/update-fetch.ts';
import { logInfo, logWarn } from '../../log.ts';
import { canUseWidget } from '../../lib/capabilities.ts';
import { readElevationStatus, requestElevation } from '../../autostart.ts';
import { registerPendingRestart } from '../../pending-restart.ts';
import { useAction } from '../../lib/action.ts';
import { fail } from '../../copy/common.ts';
import { Button } from '../../components/ui/button.tsx';
import { ExternalLink } from '../../components/ui/external-link.tsx';
import { Field } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { exportLogs } from './file-export.ts';
import { isAndroidApp } from '../../lib/capabilities.ts';
import { DiagnosticsLogDialog } from '../../components/diagnostics-log-dialog.tsx';
import { said } from './format.ts';
import { maintenanceCopy as copy } from '../../copy/backup-maintenance.ts';
import { HelpLink } from '../../components/help-link.tsx';

/** 预设来源对用户只说是仓库；具体取源（raw / API）只进日志。 */
function presetSourceLabel(source: DownloadSource): string {
  return copy.presetRepoSource(DOWNLOAD_SOURCE_LABEL[source]);
}

/** 未检查前的来源文案：自动检测还没结果时说明会探测两个源。 */
function presetSourceHint(source: AppSettings['downloadSource']): string {
  return source === 'auto' ? copy.presetAutoSource : DOWNLOAD_SOURCE_LABEL[source];
}

/** 日志级别说明（与诊断与维护卡文案一致）。 */
const LOG_LEVEL_HINT: Record<LogLevel, string> = {
  error: copy.levelError,
  warn: copy.levelWarn,
  info: copy.levelInfo,
  debug: copy.levelDebug,
  trace: copy.levelTrace,
};

export interface MaintenanceCardProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

/**
 * 诊断与维护卡：诊断日志开关/级别、导出日志、预设仓库与运行权限。
 *
 * 更新区（检查更新、渠道开关、忽略版本、回滚）已独立成「更新」卡；
 * 本卡只保留维护类动作，并自己持有预设更新与运行权限的进行中状态和结果。
 */
export function MaintenanceCard({ storage, settings, onPatch }: MaintenanceCardProps) {
  const presetAction = useAction();
  const logAction = useAction();
  const [presetSource, setPresetSource] = useState<PresetSource | null>(null);
  const [presetResult, setPresetResult] = useState<StatusMessage | null>(null);
  /** 诊断日志弹窗：安卓导出文件不可靠，查看/复制是主要路径 */
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  /** 最近一次预设检查实际用的下载源：null 表示还没检查过 */
  const [presetRemote, setPresetRemote] = useState<DownloadSource | null>(null);
  const [elevated, setElevated] = useState<boolean | null>(null);

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

  useEffect(() => {
    if (!canUseWidget()) return;
    let cancelled = false;
    void (async () => {
      const value = await readElevationStatus();
      if (!cancelled) setElevated(value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestAdmin(): Promise<void> {
    const result = await requestElevation();
    if (!result.ok) {
      toast.error(fail(copy.elevateWhat, result.error ?? '', copy.elevateNext));
    }
  }

  /** 检查预设更新：快照写入缓存、下次启动由 resolvePresetSource 生效；失败时界面沿用内置预设。 */
  async function runPresetCheck(): Promise<void> {
    const result = await presetAction.run({
      scope: 'preset',
      label: copy.checkingPreset,
      log: '预设快照下载失败',
      logLevel: 'warn',
      fail: { what: copy.checkPresetWhat, next: copy.retryLater },
      task: async () => {
        const currentVersion = presetSource?.version ?? BUILTIN_PRESET_VERSION;
        // 预设与更新共用同一个下载源：auto 按探测结果选，手动指定优先；跨源回退只在自动模式开启
        const doFetch = updateFetch();
        const resolved =
          typeof doFetch === 'function'
            ? await resolveDownloadSource(settings.downloadSource, doFetch, {
                feed: resolveFeed(CHANNEL, resolveReceiveBeta(settings.receiveBeta, CHANNEL)),
              })
            : null;
        const source: DownloadSource = resolved?.source ?? 'github';
        const fallback = settings.downloadSource === 'auto';
        const status = await checkPresetUpdate({
          cachedVersion: currentVersion,
          source,
          fallback,
        });
        if (status.error !== null) {
          const message = fail(copy.checkPresetWhat, status.error, copy.retryLater);
          setPresetResult(said(message));
          toast.error(message);
          logWarn('preset', '预设更新检查失败', { error: status.error, current: currentVersion, source });
          return;
        }
        setPresetRemote(status.downloadSource ?? source);
        if (!status.available || status.version === null) {
          const message = copy.presetLatest(
            currentVersion,
            status.source === undefined ? null : presetSourceLabel(status.downloadSource ?? source),
          );
          setPresetResult(said(message));
          toast.success(message);
          logInfo('preset', '预设已是最新', {
            current: currentVersion,
            latest: status.version,
            source: status.source,
            downloadSource: status.downloadSource ?? source,
          });
          return;
        }
        // 取快照优先用实际取到版本清单的源，避免再从刚失败的源重试一遍
        const snapshotSource = status.downloadSource ?? source;
        const snapshot = await fetchSnapshot(status.version, undefined, { source: snapshotSource, fallback });
        // 正文校验通过才落盘：不合法时保留原有缓存，不提示「下次启动生效」
        const stored = await storeDownloadedSnapshot(storage, snapshot);
        if (!stored.ok) {
          logWarn('preset', '预设正文校验未通过，未缓存', {
            version: snapshot.version,
            message: stored.reason ?? '未知原因',
          });
          const failure = fail(copy.downloadPresetWhat, copy.presetInvalid(snapshot.version), copy.presetInvalidNext);
          setPresetResult(said(failure));
          toast.error(failure);
          return;
        }
        setPresetSource(await resolvePresetSource(storage));
        const message = copy.presetDownloaded(
          snapshot.version,
          snapshot.sources.timetables.length,
          snapshot.sources.systems.length,
          presetSourceLabel(status.downloadSource ?? source),
        );
        setPresetResult(said(message));
        toast.success(message);
        // 预设要下次启动才套用：与其它待重启改动共用一条提示
        registerPendingRestart('preset-update');
        logInfo('preset', '预设快照已下载', {
          version: snapshot.version,
          hash: snapshot.hash,
          downloadSource: status.downloadSource ?? source,
        });
      },
    });
    if (!result.ok && result.error !== null) {
      setPresetResult(said(fail(copy.checkPresetWhat, result.error, copy.retryLater)));
    }
  }

  return (
    <>
      {/* 应用诊断日志：开关控制 dawn-tick.log，级别决定门槛 */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-role="log-settings">
        <span className="text-sm font-medium text-ink">{copy.logTitle}</span>
        <span className="text-xs text-muted">
          {copy.logSubtitle}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label={copy.viewLogLabel}
            data-role="diagnostics-open"
            onClick={() => setLogDialogOpen(true)}
          >
            {copy.viewLog}
          </Button>
          {!isAndroidApp() && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={copy.exportLogLabel}
              onClick={() => void logAction.run({ scope: 'log', label: copy.exportingLog, task: exportLogs })}
            >
              {copy.exportLog}
            </Button>
          )}
          <HelpLink entryId="about-diagnostics" />
        </div>
        <SwitchField
          label={copy.logEnabled}
          checked={settings.logEnabled}
          onCheckedChange={(checked) => void onPatch({ logEnabled: checked })}
          ariaLabel={copy.logEnabled}
        />
        <Field label={copy.logLevel} help={copy.logLevelHelp}>
          <Select value={settings.logLevel} onValueChange={(value) => void onPatch({ logLevel: value as LogLevel })}>
            <SelectTrigger aria-label={copy.logLevel}>
              <span>{settings.logLevel}</span>
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {copy.levelOption(level, LOG_LEVEL_HINT[level])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
        <span>{copy.presetRepo}</span>
        <ExternalLink
          dataRole="preset-repo-link"
          className="text-primary-strong underline"
          href={`${MIRRORS.github.site}/${MIRRORS.github.presets}`}
          ariaLabel={copy.presetRepoGithub}
        >
          GitHub
        </ExternalLink>
        <ExternalLink
          dataRole="preset-repo-link-gitee"
          className="text-primary-strong underline"
          href={`${MIRRORS.gitee.site}/${MIRRORS.gitee.presets}`}
          ariaLabel={copy.presetRepoGitee}
        >
          Gitee
        </ExternalLink>
        <StatusLine dataRole="preset-version">
          {copy.presetVersion(
            presetSource === null
              ? copy.reading
              : copy.presetVersionValue(presetSource.version, presetSource.kind === 'cached'),
          )}
        </StatusLine>
      </span>
      <StatusLine dataRole="preset-source">
        {copy.presetSource(
          presetRemote !== null ? presetSourceLabel(presetRemote) : presetSourceHint(settings.downloadSource),
        )}
      </StatusLine>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label={copy.checkPreset}
          loading={presetAction.busy}
          onClick={() => void runPresetCheck()}
        >
          {copy.checkPreset}
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
            {copy.elevation(elevated === null ? copy.reading : elevated ? copy.elevationAdmin : copy.elevationUser)}
          </StatusLine>
          <Button
            size="sm"
            variant="secondary"
            aria-label={copy.restartAsAdmin}
            disabled={elevated !== false}
            onClick={() => void requestAdmin()}
          >
            {copy.restartAsAdmin}
          </Button>
        </div>
      )}
      <DiagnosticsLogDialog open={logDialogOpen} onClose={() => setLogDialogOpen(false)} />
    </>
  );
}
