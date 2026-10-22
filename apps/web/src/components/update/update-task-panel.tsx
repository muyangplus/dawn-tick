import { fail } from '../../copy/zh.ts';
import {
  cancelUpdateTask,
  dismissUpdateTask,
  installUpdateTask,
  isUpdateTaskBusy,
  retryUpdateTask,
  updateTaskSnapshot,
  useUpdateTask,
  type UpdateTaskStatus,
} from '../../lib/update-task.ts';
import { Button } from '../ui/button.tsx';
import { Field } from '../ui/input.tsx';
import { StatusLine } from '../ui/status-line.tsx';
import { toast } from '../ui/toaster.tsx';
import { UpdateProgress } from './update-progress.tsx';

/** 状态 → 一句说明；失败原因另行拼 `fail()`，不再堆条件。 */
const TASK_LABEL: Record<Exclude<UpdateTaskStatus, 'idle'>, string> = {
  downloading: '正在后台下载',
  verifying: '正在校验并写入安装包',
  ready: '安装包已就绪',
  failed: '后台下载失败',
  cancelled: '已取消下载',
};

const TASK_HINT: Record<Exclude<UpdateTaskStatus, 'idle'>, string> = {
  downloading: '关闭更新弹窗后仍会继续，可随时回到这里查看',
  verifying: '校验通过后才会给出「安装」',
  ready: '点「安装」交给系统安装器；Web 渠道刷新页面即可',
  failed: '可重试；反复失败请到发布页手动下载',
  cancelled: '已下载的部分作废，重试会从头开始',
};

/** 安装动作：桌面/Android 交给系统安装器，Web 渠道直接刷新页面。 */
async function installTask(): Promise<void> {
  await installUpdateTask();
  const final = updateTaskSnapshot();
  if (final.installed) {
    toast.success(final.message ?? '安装程序已启动，请按提示完成安装');
    if (final.target?.platform === 'web') globalThis.location?.reload();
    return;
  }
  if (final.status === 'failed') {
    if (final.needsPermission) toast.info(final.error ?? '请允许安装未知应用后重试');
    else toast.error(fail('启动安装程序', final.error, '请稍后重试'));
  }
}

/**
 * 设备页的「后台下载」分组：进度、取消、安装、重试都收在这里。
 * 任务状态来自模块级 store，所以关掉更新弹窗后这里仍在推进。
 */
export function UpdateTaskPanel() {
  const task = useUpdateTask();
  if (task.status === 'idle') return null;
  const status = task.status;
  const busy = isUpdateTaskBusy(status);
  const tone = status === 'failed' ? 'danger' : status === 'ready' ? 'success' : 'muted';
  const text =
    status === 'failed'
      ? task.needsPermission
        ? (task.error ?? '请允许安装未知应用后重试')
        : fail('下载更新', task.error, '请稍后重试')
      : (task.message ?? TASK_LABEL[status]);
  const showProgress = task.progress !== null;
  return (
    <Field label="后台下载" hint={TASK_HINT[status]}>
      <div className="flex flex-col gap-2" data-role="update-task">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-medium text-ink">版本 {task.version ?? '—'}</span>
          {task.target !== null && <span className="text-xs text-muted">{task.target.installerLabel}</span>}
          <StatusLine dataRole="update-task-status" tone={tone}>
            {text}
          </StatusLine>
        </div>
        {showProgress && task.progress !== null && (
          <UpdateProgress dataRole="update-task-progress" progress={task.progress} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {busy && (
            <Button size="sm" variant="secondary" data-role="update-task-cancel" onClick={cancelUpdateTask}>
              取消下载
            </Button>
          )}
          {(status === 'failed' || status === 'cancelled') && (
            <Button
              size="sm"
              variant="secondary"
              data-role="update-task-retry"
              onClick={() => void retryUpdateTask()}
            >
              重试
            </Button>
          )}
          {status === 'ready' && !task.installed && (
            <Button size="sm" variant="primary" data-role="update-task-install" onClick={() => void installTask()}>
              {task.target?.platform === 'web' ? '刷新页面' : '安装'}
            </Button>
          )}
          {!busy && (
            <Button size="sm" variant="ghost" data-role="update-task-dismiss" onClick={dismissUpdateTask}>
              关闭
            </Button>
          )}
        </div>
      </div>
    </Field>
  );
}
