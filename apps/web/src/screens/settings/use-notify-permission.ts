import { useCallback, useEffect, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { openNotifySettings } from '../../system-actions.ts';
import { readNotifyStatus, type NotifyStatus } from '../../permissions.ts';
import { isNotifyAbnormal, notifyStateOf, type NotifyStateView } from '../../notify-state.ts';
import { fail } from '../../copy/zh.ts';
import { toast } from '../../components/ui/toaster.tsx';

export interface NotifyPermissionApi {
  status: NotifyStatus | null;
  /** 六态视图：文案与下一步动作都由它给出 */
  view: NotifyStateView;
  /** 权限异常：卡片角标与页面顶部提示条共用同一判断 */
  abnormal: boolean;
  /** 申请权限或去系统设置；结果 toast 由这里发，调用方不再重复提示 */
  act: (action: 'request' | 'settings') => Promise<void>;
}

/**
 * 通知权限状态：应用级开关、运行时权限、渠道静音分开读，回到前台时重读一次。
 *
 * 设置页顶部提示条、提醒卡角标与卡内状态行消费同一份状态，避免两处各读一次、
 * 出现「顶部说未授权、卡内说已允许」的分裂。
 */
export function useNotifyPermission(storage: Storage, request: () => Promise<void>): NotifyPermissionApi {
  const [status, setStatus] = useState<NotifyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void readNotifyStatus(storage).then((next) => {
        if (!cancelled) setStatus(next);
      });
    };
    refresh();
    // 从系统设置页回到应用时重新读一次：用户可能刚开了通知或改了权限
    globalThis.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      globalThis.removeEventListener('focus', refresh);
    };
  }, [storage]);

  const act = useCallback(
    async (action: 'request' | 'settings'): Promise<void> => {
      if (action === 'request') {
        await request();
        const next = await readNotifyStatus(storage);
        setStatus(next);
        toast.info(`通知权限：${notifyStateOf(next).label}`);
        return;
      }
      const opened = await openNotifySettings(status?.channelMuted === true ? status.channelId : null);
      if (!opened) {
        toast.error(fail('打开系统设置', null, '请手动到系统设置里开启通知'));
      }
      setStatus(await readNotifyStatus(storage));
    },
    [request, status, storage],
  );

  const view = notifyStateOf(status);
  return { status, view, abnormal: isNotifyAbnormal(view), act };
}
