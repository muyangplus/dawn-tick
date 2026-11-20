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
import { fail } from '../../copy/common.ts';
import { toast } from '../../components/ui/toaster.tsx';
import { formatBytes, said } from './format.ts';
import type { SnapshotsApi } from './use-snapshots.ts';
import { snapshotsCopy as copy } from '../../copy/backup-snapshots.ts';

export interface BackupBlockProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  /** 快照列表状态由数据卡持有：WebDAV 下载前也会产生一份快照 */
  snapshots: SnapshotsApi;
  onChanged: () => void;
}

/**
 * 备份块：自动快照开关与保留份数、新建快照、快照列表（恢复 / 删除）。
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
      label: copy.creating,
      fail: false,
      task: async () => {
        const entry = await createSnapshot(storage);
        if (entry === null) {
          toast.error(fail(copy.createWhat, null, copy.checkLogNext));
          return;
        }
        const removed = await pruneSnapshots(storage, settings.backupKeep);
        await snapshots.refresh();
        setSnapshotMessage(said(copy.backedUp));
        toast.success(copy.created(formatDateTime(entry.createdAt, settings.timeZone), removed));
      },
    });
  }

  async function removeSnapshot(entry: SnapshotEntry): Promise<void> {
    await snapshotAction.run({
      scope: 'backup',
      label: copy.deleting,
      fail: false,
      task: async () => {
        const ok = await deleteSnapshot(storage, entry);
        await snapshots.refresh();
        if (ok) {
          toast.success(copy.deleted);
          return;
        }
        toast.error(fail(copy.deleteWhat, null, copy.checkLogNext));
      },
    });
  }

  /** 恢复/删除快照都要先确认；文案在 copy/backup-snapshots.ts。 */
  async function confirmRestoreSnapshot(entry: SnapshotEntry): Promise<void> {
    const ok = await confirmAction({
      title: copy.restoreTitle,
      description: copy.restoreDescription,
      confirmLabel: copy.restoreConfirm,
    });
    if (!ok) return;
    await restoreSnapshotNow(entry);
  }

  async function confirmRemoveSnapshot(entry: SnapshotEntry): Promise<void> {
    const ok = await confirmAction({
      title: copy.deleteTitle,
      description: copy.deleteDescription,
      confirmLabel: copy.deleteConfirm,
    });
    if (!ok) return;
    await removeSnapshot(entry);
  }

  /** 恢复：文件快照排队到重启后套用，JSON 快照当场覆盖数据。 */
  async function restoreSnapshotNow(entry: SnapshotEntry): Promise<void> {
    setSnapshotMessage(null);
    await snapshotAction.run({
      scope: 'backup',
      label: copy.restoring,
      fail: false,
      task: async () => {
        const safe = await createSnapshot(storage);
        await pruneSnapshots(storage, settings.backupKeep);
        const outcome = await restoreSnapshot(storage, entry);
        if (!outcome.ok) {
          toast.error(fail(copy.restoreWhat, outcome.error, copy.checkLogNext));
          return;
        }
        await snapshots.refresh();
        if (outcome.needsRestart) {
          // 文件快照要重启后才套用：登记给统一待重启条
          registerPendingRestart('snapshot-restore');
          setSnapshotMessage(said(copy.restoreQueued));
          toast.success(copy.restoreQueued);
          return;
        }
        const result = outcome.result;
        const text =
          result === null
            ? copy.restored
            : copy.restoredWithCounts(result.imported, result.removed, safe !== null);
        setSnapshotMessage(said(text));
        toast.success(text);
        onChanged();
      },
    });
  }

  return (
    <div className="flex flex-col gap-1" data-role="backup-settings">
      <SwitchField
        label={copy.autoSnapshot}
        checked={settings.autoBackup}
        onCheckedChange={(checked) => void onPatch({ autoBackup: checked })}
        ariaLabel={copy.autoSnapshot}
      />
      <SwitchField
        label={copy.snapshotOnStart}
        checked={settings.backupOnStart}
        disabled={!settings.autoBackup}
        onCheckedChange={(checked) => void onPatch({ backupOnStart: checked })}
        ariaLabel={copy.snapshotOnStartLabel}
      />
      <SwitchField
        label={copy.snapshotDaily}
        checked={settings.backupDaily}
        disabled={!settings.autoBackup}
        onCheckedChange={(checked) => void onPatch({ backupDaily: checked })}
        ariaLabel={copy.snapshotDailyLabel}
      />
      <Field label={copy.keepLabel} hint={copy.keepHint}>
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
          aria-label={copy.createButton}
          loading={snapshotAction.busy}
          onClick={() => void backupNow()}
        >
          {copy.createButton}
        </Button>
        <span className="text-xs text-muted" data-role="backup-kind">
          {snapshotKind() === 'file' ? copy.kindFile : copy.kindJson}
        </span>
      </div>
      <span className="text-xs text-muted" data-role="snapshot-plain">
        {copy.notEncrypted}
      </span>
      {snapshotMessage !== null && (
        <StatusLine dataRole="snapshot-message" at={snapshotMessage.at}>
          {snapshotMessage.text}
        </StatusLine>
      )}
      {entries.length === 0 ? (
        <EmptyState size="sm" tone="muted" title={copy.empty} data-role="snapshot-empty" />
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
                aria-label={copy.restoreLabel(entry.id)}
                disabled={snapshotAction.busy}
                onClick={() => void confirmRestoreSnapshot(entry)}
              >
                {copy.restoreButton}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={copy.deleteLabel(entry.id)}
                disabled={snapshotAction.busy}
                onClick={() => void confirmRemoveSnapshot(entry)}
              >
                {copy.deleteButton}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
