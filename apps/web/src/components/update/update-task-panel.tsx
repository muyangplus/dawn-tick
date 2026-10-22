import { fail } from '../../copy/zh.ts';
import { formatTransferProgress } from '../../lib/update-download.ts';
import {
  cancelUpdateTask,
  installUpdateTask,
  isUpdateTaskActive,
  isUpdateTaskBusy,
  retryUpdateTask,
  useUpdateTask,
  type UpdateTaskState,
} from '../../lib/update-task.ts';
import { Button } from '../ui/button.tsx';
import { StatusLine } from '../ui/status-line.tsx';
import { UpdateProgress } from './update-progress.tsx';

/** 任务状态 → 设备页文案；失败沿用 `fail()` 句式，授权问题原样给系统提示。 */
export function updateTaskText(task: UpdateTaskState): string {
  switch (task.status) {
    case 'downloading':
      return formatTransferProgress(task);
    case 'verifying':
      return task.message ?? '正在校验安装包…';
    case 'ready':
      return task.installed
        ? (task.message ?? '新版本已就绪')
        : task.action === 'refresh'
          ? '新版本已就绪，刷新页面后生效'
          : (task.message ?? '安装包已就绪，可以安装');
    case 'failed':
      return task.needsPermission ? (task.error ?? '') : fail('下载更新', task.error, '请稍后重试');
    case 'cancelled':
      return task.message ?? '已取消下载';
    default:
      return '';
  }
}

/**
 * 设备页的后台更新区：常驻展示同一个后台任务（与更新弹窗单一事实来源）。
 * 下载中给进度 + 速度/剩余 + 取消；就绪给安装/刷新；失败给原因 + 重试。
 */
export function UpdateTaskPanel() {
  const task = useUpdateTask();
  if (!isUpdateTaskActive(task)) return null;

  const busy = isUpdateTaskBusy(task);
  const ready = task.status === 'ready';
  const failed = task.status === 'failed';
  const retryable = failed || task.status === 'cancelled';
  const text = updateTaskText(task);
  const version = task.version === null ? '' : ` ${task.version}`;

  return (
    <div className="flex flex-col gap-2" data-role="update-task">
      <span className="text-sm font-medium text-ink">后台更新{version}</span>
      {busy || ready ? (
        <UpdateProgress
          percent={(task.progress ?? 0) * 100}
          text={text}
          barRole="update-task-progress"
          statusRole="update-task-status"
        />
      ) : (
        <StatusLine dataRole="update-task-status" tone={failed ? 'danger' : 'muted'}>
          {text}
        </StatusLine>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {busy && (
          <Button
            size="sm"
            variant="secondary"
            aria-label="取消后台下载"
            data-role="update-task-cancel"
            onClick={() => cancelUpdateTask()}
          >
            取消下载
          </Button>
        )}
        {ready && !task.installed && (
          <Button
            size="sm"
            variant="primary"
            aria-label={task.action === 'refresh' ? '刷新页面以完成更新' : '安装已下载的更新'}
            data-role={task.action === 'refresh' ? 'update-task-refresh' : 'update-task-install'}
            loading={task.installing}
            onClick={() => void installUpdateTask()}
          >
            {task.action === 'refresh' ? '刷新页面' : '安装'}
          </Button>
        )}
        {retryable && (
          <Button
            size="sm"
            variant="secondary"
            aria-label="重试下载更新"
            data-role="update-task-retry"
            onClick={() => void retryUpdateTask()}
          >
            重试
          </Button>
        )}
      </div>
    </div>
  );
}
