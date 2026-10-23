import { fail } from '../../copy/zh.ts';
import type { UpdatePlan } from '../../lib/update-download.ts';
import type { UpdateTask, UpdateTaskStatus } from '../../lib/update-task.ts';

/**
 * 更新弹窗的「状态 → 视图」映射：主按钮、可见动作、进度区与状态行都查表得出。
 * 组件只负责渲染与触发，不再堆状态判断；新增状态只在这里补一行。
 */

export type UpdatePrimaryKind = 'download' | 'cancel' | 'retry' | 'install' | 'refresh';

/** 安装方式：便携版没有安装程序，文案要说明「退出后替换」。 */
type InstallKind = 'installer' | 'portable';

export interface UpdateDialogView {
  primaryKind: UpdatePrimaryKind;
  primaryLabel: string;
  primaryDisabled: boolean;
  /** 下载中才给「后台下载并关闭」：关掉弹窗继续下载 */
  showBackground: boolean;
  showLater: boolean;
  showProgress: boolean;
  statusText: string;
  tone: 'muted' | 'success' | 'danger';
}

export const PRIMARY_LABEL: Record<UpdatePrimaryKind, string> = {
  download: '下载并安装',
  cancel: '取消下载',
  retry: '重试',
  install: '安装',
  refresh: '刷新页面',
};

/** 便携版的下载/安装文案：明确说出「退出后替换」，避免用户以为会弹出安装向导。 */
export const PORTABLE_DOWNLOAD_LABEL = '下载并更新（退出后替换）';
export const PORTABLE_INSTALL_LABEL = '更新并退出';

function primaryLabelOf(kind: UpdatePrimaryKind, installKind: InstallKind | null): string {
  if (installKind === 'portable') {
    if (kind === 'download') return PORTABLE_DOWNLOAD_LABEL;
    if (kind === 'install') return PORTABLE_INSTALL_LABEL;
  }
  return PRIMARY_LABEL[kind];
}

interface TaskRule {
  primaryKind: UpdatePrimaryKind;
  showBackground: boolean;
  showLater: boolean;
  showProgress: boolean;
  tone: UpdateDialogView['tone'];
  statusText: (task: UpdateTask) => string;
}

/** 已失败：授权类问题原样给原因，其余拼成「下载更新失败：…。请稍后重试」。 */
function failureText(task: UpdateTask): string {
  if (task.needsPermission) return task.error ?? '请允许安装未知应用后重试';
  return fail('下载更新', task.error, '请稍后重试');
}

/** 任务状态表：主按钮与可见动作都在这里，`idle` 表示没有匹配的任务，不参与查表。 */
const TASK_RULES: Record<Exclude<UpdateTaskStatus, 'idle'>, TaskRule> = {
  downloading: {
    primaryKind: 'cancel',
    showBackground: true,
    showLater: false,
    showProgress: true,
    tone: 'muted',
    // 进度区已经给出百分比与速度，状态行不再重复
    statusText: () => '',
  },
  verifying: {
    primaryKind: 'cancel',
    showBackground: true,
    showLater: false,
    showProgress: true,
    tone: 'muted',
    statusText: (task) => task.message ?? '正在校验安装包…',
  },
  ready: {
    primaryKind: 'install',
    showBackground: false,
    showLater: true,
    showProgress: false,
    tone: 'success',
    statusText: (task) => task.message ?? '安装包已就绪',
  },
  failed: {
    primaryKind: 'retry',
    showBackground: false,
    showLater: true,
    showProgress: false,
    tone: 'danger',
    statusText: failureText,
  },
  cancelled: {
    primaryKind: 'download',
    showBackground: false,
    showLater: true,
    showProgress: false,
    tone: 'muted',
    statusText: () => '已取消下载',
  },
};

function viewFromTask(task: UpdateTask): UpdateDialogView {
  const rule = TASK_RULES[task.status as Exclude<UpdateTaskStatus, 'idle'>];
  // ready 的落点按渠道分：Web 没有安装包，动作是刷新页面
  const primaryKind = task.status === 'ready' && task.target?.platform === 'web' ? 'refresh' : rule.primaryKind;
  return {
    primaryKind,
    primaryLabel: primaryLabelOf(primaryKind, task.target?.kind ?? null),
    // 已交给安装器/替换脚本后不再允许重复触发（便携版退出前也不该再点）
    primaryDisabled: task.status === 'ready' && task.installed,
    showBackground: rule.showBackground,
    showLater: rule.showLater,
    showProgress: rule.showProgress,
    statusText: rule.statusText(task),
    tone: rule.tone,
  };
}

const IDLE_DOWNLOAD: UpdateDialogView = {
  primaryKind: 'download',
  primaryLabel: PRIMARY_LABEL.download,
  primaryDisabled: false,
  showBackground: false,
  showLater: true,
  showProgress: false,
  statusText: '',
  tone: 'muted',
};

export interface UpdateDialogInput {
  plan: UpdatePlan;
  /** 与本版本匹配的任务；null 表示这个版本没有进行中/已就绪的任务 */
  task: UpdateTask | null;
}

/**
 * 弹窗视图：
 * - 有匹配任务时按任务状态查表（下载中 → 取消 / 后台下载并关闭；ready → 安装或刷新；失败 → 重试）；
 * - 没有任务时按渠道计划给默认动作（下载 / 刷新 / 不可用）。
 */
export function describeUpdateDialog({ plan, task }: UpdateDialogInput): UpdateDialogView {
  if (task !== null && task.status !== 'idle') return viewFromTask(task);
  const installKind = plan.kind === 'download' ? plan.target.kind : null;
  if (plan.kind === 'refresh') {
    return {
      ...IDLE_DOWNLOAD,
      primaryKind: 'refresh',
      primaryLabel: PRIMARY_LABEL.refresh,
      statusText: '新版本已发布，刷新页面后生效',
    };
  }
  if (plan.kind === 'unavailable') {
    // 不可用的原因由正文的「自动更新失败…」提示承担，状态行不再重复
    return { ...IDLE_DOWNLOAD, primaryDisabled: true };
  }
  return { ...IDLE_DOWNLOAD, primaryLabel: primaryLabelOf('download', installKind) };
}
