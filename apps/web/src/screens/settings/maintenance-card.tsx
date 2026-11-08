import { useEffect, useState } from 'react';
import { LOG_LEVELS, type AppSettings, type LogLevel, type Storage } from '@dawn-tick/core';
import {
  BUILTIN_PRESET_VERSION,
  cacheSnapshotContent,
  checkPresetUpdate,
  fetchSnapshot,
  resolvePresetSource,
  writeCachedSnapshot,
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
import { fail } from '../../copy/zh.ts';
import { Button } from '../../components/ui/button.tsx';
import { ExternalLink } from '../../components/ui/external-link.tsx';
import { Field } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { exportLogs } from './file-export.ts';
import { said } from './format.ts';

/** 预设来源对用户只说是仓库；具体取源（raw / API）只进日志。 */
function presetSourceLabel(source: DownloadSource): string {
  return `预设仓库（${DOWNLOAD_SOURCE_LABEL[source]}）`;
}

/** 未检查前的来源文案：自动检测还没结果时说明会探测两个源。 */
function presetSourceHint(source: AppSettings['downloadSource']): string {
  return source === 'auto' ? '自动检测（Gitee / GitHub 择快）' : DOWNLOAD_SOURCE_LABEL[source];
}

/** 日志级别说明（与诊断与维护卡文案一致）。 */
const LOG_LEVEL_HINT: Record<LogLevel, string> = {
  error: '仅严重错误',
  warn: '错误 + 警告信息',
  info: '一般操作信息（默认）',
  debug: '详细信息，包含请求/响应详情',
  trace: '全部日志，最详细',
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
      toast.error(fail('提权', result.error ?? '', '请手动以管理员身份运行'));
    }
  }

  /** 检查预设更新：快照写入缓存、下次启动由 resolvePresetSource 生效；失败时界面沿用内置预设。 */
  async function runPresetCheck(): Promise<void> {
    const result = await presetAction.run({
      scope: 'preset',
      label: '正在读取预设更新…',
      log: '下载预设快照失败',
      fail: { what: '检查预设更新', next: '请稍后再试' },
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
          const message = fail('检查预设更新', status.error, '请稍后再试');
          setPresetResult(said(message));
          toast.error(message);
          logWarn('preset', '检查预设更新失败', { error: status.error, current: currentVersion, source });
          return;
        }
        setPresetRemote(status.downloadSource ?? source);
        if (!status.available || status.version === null) {
          const message = `预设已是最新（${currentVersion}）${status.source === undefined ? '' : `，来源 ${presetSourceLabel(status.downloadSource ?? source)}`}`;
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
        const message = `已下载预设 ${snapshot.version}（${snapshot.sources.timetables.length} 套作息、${snapshot.sources.systems.length} 个教务系统，来源 ${presetSourceLabel(status.downloadSource ?? source)}），下次启动生效`;
        setPresetResult(said(message));
        toast.success(message);
        // 预设要下次启动才套用：与其它待重启改动共用一条提示
        registerPendingRestart('preset-update');
        logInfo('preset', '已下载预设快照', {
          version: snapshot.version,
          hash: snapshot.hash,
          downloadSource: status.downloadSource ?? source,
        });
      },
    });
    if (!result.ok && result.error !== null) {
      setPresetResult(said(fail('检查预设更新', result.error, '请稍后再试')));
    }
  }

  return (
    <>
      {/* 应用诊断日志：开关控制 dawn-tick.log，级别决定门槛 */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-role="log-settings">
        <span className="text-sm font-medium text-ink">应用诊断日志</span>
        <span className="text-xs text-muted">
          写入文件的门槛
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="打开日志"
            onClick={() => void logAction.run({ scope: 'log', label: '正在导出日志…', task: exportLogs })}
          >
            打开日志
          </Button>
          <span className="text-xs text-muted">导出当前缓冲区</span>
        </div>
        <SwitchField
          label="启用应用诊断日志"
          checked={settings.logEnabled}
          onCheckedChange={(checked) => void onPatch({ logEnabled: checked })}
          ariaLabel="启用应用诊断日志"
        />
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
          href={`${MIRRORS.github.site}/${MIRRORS.github.presets}`}
          ariaLabel="打开预设仓库（GitHub）"
        >
          GitHub
        </ExternalLink>
        <ExternalLink
          dataRole="preset-repo-link-gitee"
          className="text-primary-strong underline"
          href={`${MIRRORS.gitee.site}/${MIRRORS.gitee.presets}`}
          ariaLabel="打开预设仓库（Gitee）"
        >
          Gitee
        </ExternalLink>
        <StatusLine dataRole="preset-version">
          预设版本：
          {presetSource === null
            ? '读取中…'
            : `${presetSource.version}（${presetSource.kind === 'cached' ? '已更新' : '内置'}）`}
        </StatusLine>
      </span>
      <StatusLine dataRole="preset-source">
        预设源：
        {presetRemote !== null ? presetSourceLabel(presetRemote) : presetSourceHint(settings.downloadSource)}
      </StatusLine>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="检查预设更新"
          loading={presetAction.busy}
          onClick={() => void runPresetCheck()}
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
            onClick={() => void requestAdmin()}
          >
            以管理员身份重新启动
          </Button>
        </div>
      )}
    </>
  );
}
