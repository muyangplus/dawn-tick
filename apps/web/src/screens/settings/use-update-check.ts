import { useState } from 'react';
import type { AppSettings } from '@dawn-tick/core';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { logInfo, logWarn } from '../../log.ts';
import { fail } from '../../copy/zh.ts';
import { useAction } from '../../lib/action.ts';
import { isIgnoredVersion } from '../../lib/update-preferences.ts';
import { checkForUpdate, releaseChannelOf, resolveReceiveBeta, verifyHint } from '../../update.ts';
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
}

/**
 * 版本检查：设备页顶部快捷动作与「更新」卡共用同一份进行中状态与结果，
 * 因此状态由调用方持有、卡片只消费，避免两处各发一次请求。
 *
 * 手动检查不受「忽略此版本」限制：查到被忽略的版本也会弹窗，并在弹窗里给取消忽略入口。
 */
export function useUpdateCheck(settings: AppSettings): UpdateCheckApi {
  const action = useAction();
  const [result, setResult] = useState<StatusMessage | null>(null);
  const [latestStable, setLatestStable] = useState<string | null>(null);

  async function run(): Promise<void> {
    await action.run({
      scope: 'update',
      label: '正在检查更新…',
      log: '检查更新失败',
      fail: { what: '检查更新', next: '请稍后再试' },
      task: async () => {
        const status = await checkForUpdate({
          channel: CHANNEL,
          receiveBeta: resolveReceiveBeta(settings.receiveBeta, CHANNEL),
          currentVersion: appVersion(),
        });
        if (status.error !== null) {
          const message = fail('检查更新', status.error, '请稍后再试');
          setResult(said(message));
          toast.error(message);
          logWarn('update', '检查更新失败', { error: status.error, feed: status.feed });
          return;
        }
        const manifest = status.manifest;
        const channelLabel = CHANNEL_LABEL[releaseChannelOf(status)];
        // 查到正式版就记住它的版本号：正式版渠道据此判断是否存在「当前比正式版高」的回滚场景
        if (manifest?.channel === 'release') setLatestStable(manifest.version);
        const ignored = isIgnoredVersion(status.latest, currentIgnoredVersion());
        const message = status.available
          ? ignored
            ? `发现新版本 ${status.latest}（${channelLabel}）；已忽略此版本，可在更新弹窗里取消忽略`
            : `发现新版本 ${status.latest}（${channelLabel}），可在更新弹窗里下载安装`
          : `已是最新版本（${channelLabel}）`;
        setResult(said(message));
        toast.success(message);
        // 手动检查与启动自检共用同一个更新弹窗：只在本版本严格更高时打开（忽略的版本也打开）
        if (status.available) requestUpdatePrompt(status);
        logInfo('update', '检查更新', {
          feed: status.feed,
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

  return { busy: action.busy, result, latestStable, run };
}
