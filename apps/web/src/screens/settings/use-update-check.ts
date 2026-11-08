import { useEffect, useState } from 'react';
import type { AppSettings } from '@dawn-tick/core';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { logInfo, logWarn } from '../../log.ts';
import { fail } from '../../copy/zh.ts';
import { useAction } from '../../lib/action.ts';
import { DOWNLOAD_SOURCE_LABEL } from '../../lib/download-source.ts';
import {
  describeSourceLine,
  manualResolution,
  resolveDownloadSource,
  type DownloadSourceResolution,
} from '../../lib/download-selection.ts';
import { probeAllSources } from '../../lib/download-probe.ts';
import { updateFetch } from '../../lib/update-fetch.ts';
import { isIgnoredVersion } from '../../lib/update-preferences.ts';
import { checkForUpdate, releaseChannelOf, resolveFeed, resolveReceiveBeta, verifyHint } from '../../update.ts';
import { currentIgnoredVersion, requestUpdatePrompt } from '../../components/update-prompt.ts';
import { toast } from '../../components/ui/toaster.tsx';
import type { StatusMessage } from '../../components/ui/status-line.tsx';
import { said } from './format.ts';

export interface UpdateCheckApi {
  busy: boolean;
  /** 上一次检查的结果：留在卡片里可回看，动作结果另走 toast */
  result: StatusMessage | null;
  /** 最近一次检查看到的正式版：设备页据此判断要不要给「回滚到正式版」 */
  latestStable: string | null;
  run: () => Promise<void>;
  /** 下载源解析结果：null 表示还没解析（界面显示「正在探测」） */
  downloadSource: DownloadSourceResolution | null;
  /** 正在探测下载源 */
  sourceBusy: boolean;
  /** 下载源状态行：`自动：Gitee（120ms） · GitHub（480ms）` / `手动：GitHub` */
  sourceLine: string;
  /** 打开「更新」分组时调用：自动模式下探测一次（命中会话缓存则直接复用） */
  ensureSource: () => Promise<void>;
  /** 「重新检测」：强制重新探测两个源（手动模式只补探测结果，不改变选择） */
  refreshSource: () => Promise<void>;
}

/**
 * 版本检查：设备页顶部快捷动作与「更新」卡共用同一份进行中状态与结果，
 * 因此状态由调用方持有、卡片只消费，避免两处各发一次请求。
 *
 * 下载源：自动模式在打开更新分组时探测一次（会话缓存 10 分钟），手动模式不探测；
 * 「重新检测」强制刷新；检查更新与下载都使用解析出的实际源，并在结果里标明。
 */
export function useUpdateCheck(settings: AppSettings): UpdateCheckApi {
  const action = useAction();
  const [result, setResult] = useState<StatusMessage | null>(null);
  const [latestStable, setLatestStable] = useState<string | null>(null);
  const [downloadSource, setDownloadSource] = useState<DownloadSourceResolution | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const preference = settings.downloadSource;

  // 切换设置项后旧结果不再成立：等「更新」分组重新探测
  useEffect(() => {
    setDownloadSource((current) => (current?.preference === preference ? current : null));
  }, [preference]);

  async function resolveNow(fresh: boolean): Promise<DownloadSourceResolution | null> {
    // 探测与取源都走原生 HTTP：桌面 Tauri，Android 由 CapacitorHttp 接管
    const doFetch = updateFetch();
    if (typeof doFetch !== 'function') return null;
    const feed = resolveFeed(CHANNEL, resolveReceiveBeta(settings.receiveBeta, CHANNEL));
    setSourceBusy(true);
    try {
      const next =
        preference === 'auto'
          ? await resolveDownloadSource('auto', doFetch, { fresh, feed })
          : fresh
            ? manualResolution(preference, await probeAllSources(doFetch, { feed }))
            : await resolveDownloadSource(preference, doFetch, { feed });
      setDownloadSource(next);
      return next;
    } catch {
      return null;
    } finally {
      setSourceBusy(false);
    }
  }

  /** 打开更新分组：已有同一偏好的解析结果就不再探测。 */
  async function ensureSource(): Promise<void> {
    if (downloadSource !== null && downloadSource.preference === preference) return;
    await resolveNow(false);
  }

  async function refreshSource(): Promise<void> {
    await resolveNow(true);
  }

  async function run(): Promise<void> {
    await action.run({
      scope: 'update',
      label: '正在检查更新…',
      log: '检查更新失败',
      fail: { what: '检查更新', next: '请稍后再试' },
      task: async () => {
        // 手动检查前先确保有源：自动模式命中缓存时不会额外发请求
        const resolved = await resolveNow(false);
        const status = await checkForUpdate({
          channel: CHANNEL,
          receiveBeta: resolveReceiveBeta(settings.receiveBeta, CHANNEL),
          currentVersion: appVersion(),
          fetchImpl: updateFetch(),
          ...(resolved === null ? {} : { source: resolved.source }),
          // 选中的源失败时自动回退另一个源：Gitee 镜像还没同步时也能更新
          fallback: true,
        });
        if (status.error !== null) {
          const message = fail('检查更新', status.error, '请稍后再试');
          setResult(said(message));
          toast.error(message);
          logWarn('update', '检查更新失败', { error: status.error, feed: status.feed, source: status.source });
          return;
        }
        const manifest = status.manifest;
        const channelLabel = CHANNEL_LABEL[releaseChannelOf(status)];
        const sourceLabel = DOWNLOAD_SOURCE_LABEL[status.source];
        const fallbackNote =
          status.fallbackFrom === undefined
            ? ''
            : `；${DOWNLOAD_SOURCE_LABEL[status.fallbackFrom]} 不可用，已回退`;
        // 查到正式版就记住它的版本号：正式版渠道据此判断是否存在「当前比正式版高」的回滚场景
        if (manifest?.channel === 'release') setLatestStable(manifest.version);
        const ignored = isIgnoredVersion(status.latest, currentIgnoredVersion());
        const message = status.available
          ? ignored
            ? `发现新版本 ${status.latest}（${channelLabel}，来源 ${sourceLabel}${fallbackNote}）；已忽略此版本，可在更新弹窗里取消忽略`
            : `发现新版本 ${status.latest}（${channelLabel}，来源 ${sourceLabel}${fallbackNote}），可在更新弹窗里下载安装`
          : `已是最新版本（${channelLabel}，来源 ${sourceLabel}${fallbackNote}）`;
        setResult(said(message));
        toast.success(message);
        // 手动检查与启动自检共用同一个更新弹窗：只在本版本严格更高时打开（忽略的版本也打开）
        if (status.available) requestUpdatePrompt(status);
        logInfo('update', '检查更新', {
          feed: status.feed,
          source: status.source,
          ...(status.fallbackFrom === undefined ? {} : { fallbackFrom: status.fallbackFrom }),
          current: status.current,
          latest: status.latest,
          available: status.available,
          ignored,
          verify: verifyHint(status.feed, 'windows'),
          ...(manifest?.notes === undefined ? {} : { notes: manifest.notes }),
        });
      },
    });
  }

  return {
    busy: action.busy,
    result,
    latestStable,
    run,
    downloadSource,
    sourceBusy,
    sourceLine: describeSourceLine(downloadSource),
    ensureSource,
    refreshSource,
  };
}
