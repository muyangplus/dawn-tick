import { useCallback, useEffect, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { listSnapshots, type SnapshotEntry } from '../../backup.ts';

export interface SnapshotsApi {
  snapshots: SnapshotEntry[];
  /** 重新读快照列表：备份卡创建/删除/恢复后与 WebDAV 下载前备份后都要刷新 */
  refresh: () => Promise<void>;
}

/**
 * 快照列表：备份卡展示、WebDAV 下载后刷新，两处共用同一份状态。
 *
 * `revision` 由页面持有：WebDAV 卡在下载前建完快照后递增它，
 * 备份卡据此重读列表，两张卡之间只传一个版本号，不共享组件状态。
 */
export function useSnapshots(storage: Storage, revision = 0): SnapshotsApi {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const refresh = useCallback(async (): Promise<void> => {
    setSnapshots(await listSnapshots(storage));
  }, [storage]);
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);
  return { snapshots, refresh };
}
