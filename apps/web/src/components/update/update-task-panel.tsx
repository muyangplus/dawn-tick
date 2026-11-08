import { fail } from '../../copy/zh.ts';
import { DOWNLOAD_SOURCE_LABEL } from '../../lib/download-source.ts';
import {
  dismissUpdateTask,
  installUpdateTask,
  isUpdateTaskBusy,
  retryUpdateTask,
  updateTaskSnapshot,
  useUpdateTask,
  type UpdateTask,
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
  downloading: '下载会自动继续；完成后点「安装」或重新打开更新弹窗点「立即更新」',
  verifying: '校验通过后才会给出「安装」',
  ready: '点「安装」交给系统安装器；Web 渠道刷新页面即可',
  failed: '点「继续下载」重试；反复失败请到发布页手动下载',
  cancelled: '已下载的部分作废，继续会从头开始',
};

/** 便携版没有安装向导：按钮文案与提示都要说明「退出后替换」。 */
const PORTABLE_HINT_READY = '点「更新并退出」后会先解压并准备替换脚本，应用退出时覆盖 exe 并自动重启';

/** 状态提示：便携版就绪时换成「退出后替换」的说法。 */
function taskHint(task: UpdateTask): string {
  if (task.status === 'ready' && task.target?.kind === 'portable') return PORTABLE_HINT_READY;
  return TASK_HINT[task.status as Exclude<UpdateTaskStatus, 'idle'>];
}

/** 安装动作：桌面/Android 交给系统安装器，便携版退出后替换，Web 渠道直接刷新页面。 */
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
    else
      toast.error(
        fail(final.target?.kind === 'portable' ? '准备便携版更新' : '启动安装程序', final.error, '请稍后重试'),
      );
  }
}

/** ready 时主按钮的文案：与弹窗口径一致，明确装的是什么。 */
function primaryLabel(task: UpdateTask): string {
  if (task.target?.platform === 'web') return '刷新页面';
  return task.target?.kind === 'portable' ? '更新并退出' : '安装';
}

/**
 * 设备页的「后台下载」分组：只保留主操作（继续 / 安装）与关闭，进度自动更新。
 *
 * 任务状态来自模块级 store，所以关掉更新弹窗后这里仍在推进；
 * 下载完成后点「安装」，或重新打开更新弹窗点「立即更新」都会自动进入安装。
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
  const canInstall = status === 'ready' && !task.installed;
  const canContinue = status === 'failed' || status === 'cancelled';
  return (
    <Field label="后台下载" hint={taskHint(task)}>
      <div className="flex flex-col gap-2" data-role="update-task">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-medium text-ink">版本 {task.version ?? '—'}</span>
          {task.source !== null && (
            <span className="text-xs text-muted" data-role="update-task-source">
              来源 {DOWNLOAD_SOURCE_LABEL[task.source]}
            </span>
          )}
          {task.target !== null && <span className="text-xs text-muted">{task.target.installerLabel}</span>}
          <StatusLine dataRole="update-task-status" tone={tone}>
            {text}
          </StatusLine>
        </div>
        {showProgress && task.progress !== null && (
          <UpdateProgress dataRole="update-task-progress" progress={task.progress} />
        )}
        {/* 只保留主操作与关闭：下载中进度自动走，没有多余按钮 */}
        <div className="flex flex-wrap items-center gap-2">
          {canInstall && (
            <Button size="sm" variant="primary" data-role="update-task-install" onClick={() => void installTask()}>
              {primaryLabel(task)}
            </Button>
          )}
          {canContinue && (
            <Button size="sm" variant="primary" data-role="update-task-install" onClick={() => void retryUpdateTask()}>
              继续下载
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
