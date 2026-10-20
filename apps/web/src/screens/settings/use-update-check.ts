import { useState } from 'react';
import type { AppSettings } from '@dawn-tick/core';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { logInfo, logWarn } from '../../log.ts';
import { fail } from '../../copy/zh.ts';
import { useAction } from '../../lib/action.ts';
import { checkForUpdate, resolveReceiveBeta, verifyHint } from '../../update.ts';
import { toast } from '../../components/ui/toaster.tsx';
import type { StatusMessage } from '../../components/ui/status-line.tsx';
import { said } from './format.ts';

export interface UpdateCheckApi {
  busy: boolean;
  /** 上一次检查的结果：留在卡片里可回看，动作结果另走 toast */
  result: StatusMessage | null;
  run: () => Promise<void>;
}

/**
 * 版本检查：设备页顶部快捷动作与「更新与维护」卡共用同一份进行中状态与结果，
 * 因此状态由调用方持有、卡片只消费，避免两处各发一次请求。
 */
export function useUpdateCheck(settings: AppSettings): UpdateCheckApi {
  const action = useAction();
  const [result, setResult] = useState<StatusMessage | null>(null);

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
        const message = status.available
          ? `发现新版本 ${status.latest}（${CHANNEL_LABEL[status.feed]}），可在发布页下载`
          : `已是最新版本（${CHANNEL_LABEL[status.feed]}）`;
        setResult(said(message));
        toast.success(message);
        logInfo('update', '检查更新', {
          feed: status.feed,
          current: status.current,
          latest: status.latest,
          available: status.available,
          verify: verifyHint(status.feed, 'windows'),
          ...(manifest?.notes === undefined ? {} : { notes: manifest.notes }),
        });
      },
    });
  }

  return { busy: action.busy, result, run };
}
