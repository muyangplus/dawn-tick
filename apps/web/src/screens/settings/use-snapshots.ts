import { useCallback, useEffect, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { listSnapshots, type SnapshotEntry } from '../../backup.ts';

export interface SnapshotsApi {
  snapshots: SnapshotEntry[];
  /** 重新读快照列表：备份卡创建/删除/恢复后与 WebDAV 下载前备份后都要刷新 */
  refresh: () => Promise<void>;
}

/** 快照列表：备份卡展示、WebDAV 下载后刷新，两处共用同一份状态。 */
export function useSnapshots(storage: Storage): SnapshotsApi {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const refresh = useCallback(async (): Promise<void> => {
    setSnapshots(await listSnapshots(storage));
  }, [storage]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { snapshots, refresh };
}
