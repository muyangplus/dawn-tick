import { useState } from 'react';
import {
  formatDateTime,
  type AppSettings,
  type Storage,
} from '@dawn-tick/core';
import {
  createSnapshot,
  deleteSnapshot,
  pruneSnapshots,
  restoreSnapshot,
  snapshotKind,
  type SnapshotEntry,
} from '../../backup.ts';
import { confirmAction } from '../../components/ui/confirm-dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { registerPendingRestart } from '../../pending-restart.ts';
import { useAction } from '../../lib/action.ts';
import { DELETE, fail } from '../../copy/zh.ts';
import { toast } from '../../components/ui/toaster.tsx';
import { formatBytes, said } from './format.ts';
import type { SnapshotsApi } from './use-snapshots.ts';

export interface BackupBlockProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  /** 快照列表状态由数据卡持有：WebDAV 下载前也会产生一份快照 */
  snapshots: SnapshotsApi;
  onChanged: () => void;
}

/**
 * 备份块：自动快照开关与保留份数、立即创建快照、快照列表（恢复 / 删除）。
 *
 * 快照列表本身由 `useSnapshots` 持有；本块只管动作与动作结果的状态行。
 */
export function BackupBlock({ storage, settings, onPatch, snapshots, onChanged }: BackupBlockProps) {
  const snapshotAction = useAction();
  const [snapshotMessage, setSnapshotMessage] = useState<StatusMessage | null>(null);
  const entries = snapshots.snapshots;

  /** 立即做一份快照，并按保留份数清理。 */
  async function backupNow(): Promise<void> {
    setSnapshotMessage(null);
    await snapshotAction.run({
      scope: 'backup',
      label: '正在创建快照…',
      fail: false,
      task: async () => {
        const entry = await createSnapshot(storage);
        if (entry === null) {
          toast.error(fail('快照', null, '请查看「应用诊断日志」后重试'));
          return;
        }
        const removed = await pruneSnapshots(storage, settings.backupKeep);
        await snapshots.refresh();
        setSnapshotMessage(said('已备份'));
        toast.success(
          `已生成快照 ${formatDateTime(entry.createdAt, settings.timeZone)}${removed > 0 ? `，清理了 ${removed} 份旧快照` : ''}`,
        );
      },
    });
  }

  async function removeSnapshot(entry: SnapshotEntry): Promise<void> {
    await snapshotAction.run({
      scope: 'backup',
      label: '正在删除快照…',
      fail: false,
      task: async () => {
        const ok = await deleteSnapshot(storage, entry);
        await snapshots.refresh();
        if (ok) {
          toast.success('已删除该快照');
          return;
        }
        toast.error(fail('删除快照', null, '请查看「应用诊断日志」后重试'));
      },
    });
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
    setSnapshotMessage(null);
    await snapshotAction.run({
      scope: 'backup',
      label: '正在恢复快照…',
      fail: false,
      task: async () => {
        const safe = await createSnapshot(storage);
        await pruneSnapshots(storage, settings.backupKeep);
        const outcome = await restoreSnapshot(storage, entry);
        if (!outcome.ok) {
          toast.error(fail('恢复快照', outcome.error, '请查看「应用诊断日志」后重试'));
          return;
        }
        await snapshots.refresh();
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
      },
    });
  }

  return (
    <div className="flex flex-col gap-1" data-role="backup-settings">
      <SwitchField
        label="自动快照"
        checked={settings.autoBackup}
        onCheckedChange={(checked) => void onPatch({ autoBackup: checked })}
        ariaLabel="自动快照"
      />
      <SwitchField
        label="启动时快照一次"
        checked={settings.backupOnStart}
        disabled={!settings.autoBackup}
        onCheckedChange={(checked) => void onPatch({ backupOnStart: checked })}
        ariaLabel="启动时快照"
      />
      <SwitchField
        label="每天快照一次"
        checked={settings.backupDaily}
        disabled={!settings.autoBackup}
        onCheckedChange={(checked) => void onPatch({ backupDaily: checked })}
        ariaLabel="每天快照"
      />
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
          loading={snapshotAction.busy}
          onClick={() => void backupNow()}
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
      {entries.length === 0 ? (
        <EmptyState size="sm" tone="muted" title="暂无快照" data-role="snapshot-empty" />
      ) : (
        <ul className="flex flex-col gap-1" data-role="snapshot-list">
          {entries.map((entry) => (
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
                disabled={snapshotAction.busy}
                onClick={() => void confirmRestoreSnapshot(entry)}
              >
                恢复
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`删除快照 ${entry.id}`}
                disabled={snapshotAction.busy}
                onClick={() => void confirmRemoveSnapshot(entry)}
              >
                删除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
