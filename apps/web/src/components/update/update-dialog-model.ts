import { fail } from '../../copy/zh.ts';
import type { UpdatePlan } from '../../lib/update-download.ts';
import type { UpdateTask, UpdateTaskStatus } from '../../lib/update-task.ts';

/**
 * 更新弹窗的「状态 → 视图」映射：主按钮、可见动作、进度区与状态行都查表得出。
 * 组件只负责渲染与触发，不再堆状态判断；新增状态只在这里补一行。
 *
 * 交互目标：默认路径只点一次「立即更新」，下载、校验与安装自动串起来；
 * 其余入口（忽略、后台下载、打开发布页、复制链接、重试）统一收进「更多」菜单。
 */

export type UpdatePrimaryKind = 'update' | 'install' | 'refresh' | 'download-web' | 'none';

/** 安装方式：便携版没有安装程序，文案要说明「退出后替换」。 */
type InstallKind = 'installer' | 'portable';

export interface UpdateDialogView {
  primaryKind: UpdatePrimaryKind;
  primaryLabel: string;
  primaryDisabled: boolean;
  /** 下载/校验中：底部只留一个小的「取消」文本按钮 */
  showCancel: boolean;
  /** 「更多」菜单里的「后台下载并关闭」 */
  showBackground: boolean;
  /** 「更多」菜单里的「重试」（失败/取消后才给） */
  showRetry: boolean;
  /** 「更多」菜单是否可用 */
  showMore: boolean;
  showLater: boolean;
  showProgress: boolean;
  statusText: string;
  tone: 'muted' | 'success' | 'danger';
}

/** 主操作固定叫「立即更新」：不再让用户先选下载、再选安装。 */
export const PRIMARY_LABEL: Record<Exclude<UpdatePrimaryKind, 'none'>, string> = {
  update: '立即更新',
  install: '安装更新',
  refresh: '立即更新',
  'download-web': '立即更新',
};

/** 便携版就绪时的文案：说明点完会退出并自动替换，避免用户以为会弹安装向导。 */
export const PORTABLE_INSTALL_LABEL = '继续更新并退出';

/** 下载完成自动进入安装：状态行直接说「正在安装」，不再让用户找安装按钮。 */
export const INSTALLING_TEXT = '正在安装更新，请稍候…';

function primaryLabelOf(kind: UpdatePrimaryKind, installKind: InstallKind | null): string {
  if (kind === 'none') return '';
  if (kind === 'install' && installKind === 'portable') return PORTABLE_INSTALL_LABEL;
  return PRIMARY_LABEL[kind];
}

interface TaskView {
  primaryKind: UpdatePrimaryKind;
  showCancel: boolean;
  showBackground: boolean;
  showRetry: boolean;
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
const TASK_RULES: Record<Exclude<UpdateTaskStatus, 'idle'>, TaskView> = {
  downloading: {
    primaryKind: 'none',
    showCancel: true,
    showBackground: true,
    showRetry: false,
    showLater: false,
    showProgress: true,
    tone: 'muted',
    // 进度区已经给出百分比与速度，状态行不再重复
    statusText: () => '',
  },
  verifying: {
    primaryKind: 'none',
    showCancel: true,
    showBackground: true,
    showRetry: false,
    showLater: false,
    showProgress: true,
    tone: 'muted',
    statusText: (task) => task.message ?? '正在校验安装包…',
  },
  ready: {
    primaryKind: 'install',
    showCancel: false,
    showBackground: false,
    showRetry: false,
    showLater: true,
    showProgress: false,
    tone: 'success',
    statusText: (task) => task.message ?? '安装包已就绪',
  },
  failed: {
    primaryKind: 'update',
    showCancel: false,
    showBackground: false,
    showRetry: true,
    showLater: true,
    showProgress: false,
    tone: 'danger',
    statusText: failureText,
  },
  cancelled: {
    primaryKind: 'update',
    showCancel: false,
    showBackground: false,
    showRetry: true,
    showLater: true,
    showProgress: false,
    tone: 'muted',
    statusText: () => '已取消下载，点「立即更新」重新开始',
  },
};

function viewFromTask(task: UpdateTask): UpdateDialogView {
  const rule = TASK_RULES[task.status as Exclude<UpdateTaskStatus, 'idle'>];
  const installedReady = task.status === 'ready' && task.installed;
  const primaryKind: UpdatePrimaryKind = installedReady ? 'none' : rule.primaryKind;
  return {
    primaryKind,
    primaryLabel: primaryLabelOf(primaryKind, task.target?.kind ?? null),
    // 已交给安装器/替换脚本后不再允许重复触发（便携版退出前也不该再点）
    primaryDisabled: installedReady,
    showCancel: rule.showCancel,
    showBackground: rule.showBackground,
    showRetry: rule.showRetry,
    showMore: !installedReady,
    showLater: rule.showLater,
    showProgress: rule.showProgress,
    statusText: installedReady ? (task.message ?? '更新已准备，请按提示完成') : rule.statusText(task),
    tone: rule.tone,
  };
}

const IDLE_VIEW: UpdateDialogView = {
  primaryKind: 'update',
  primaryLabel: PRIMARY_LABEL.update,
  primaryDisabled: false,
  showCancel: false,
  showBackground: true,
  showRetry: false,
  showMore: true,
  showLater: true,
  showProgress: false,
  statusText: '',
  tone: 'muted',
};

/** 安装进行中：不再展示主按钮，状态行直接说「正在安装」。 */
const INSTALLING_VIEW: UpdateDialogView = {
  primaryKind: 'none',
  primaryLabel: '',
  primaryDisabled: true,
  showCancel: false,
  showBackground: false,
  showRetry: false,
  showMore: false,
  showLater: false,
  showProgress: false,
  statusText: INSTALLING_TEXT,
  tone: 'muted',
};

export interface UpdateDialogInput {
  plan: UpdatePlan;
  /** 与本版本匹配的任务；null 表示这个版本没有进行中/已就绪的任务 */
  task: UpdateTask | null;
  /** 下载完成后已经自动进入安装（界面据此显示「正在安装」） */
  installing?: boolean;
  /** Web 渠道清单里提供的 web 包地址：有则「立即更新」直接下载文件 */
  webAssetUrl?: string | null;
}

/**
 * 弹窗视图：
 * - 正在自动安装 → 只显示状态行；
 * - 有匹配任务时按任务状态查表（下载中 → 取消；ready → 安装；失败 → 立即更新 + 更多里重试）；
 * - 没有任务时按渠道计划给默认动作（下载 / 刷新 / 下载 Web 包 / 不可用）。
 */
export function describeUpdateDialog({
  plan,
  task,
  installing = false,
  webAssetUrl = null,
}: UpdateDialogInput): UpdateDialogView {
  if (installing) return INSTALLING_VIEW;
  if (task !== null && task.status !== 'idle') return viewFromTask(task);
  const installKind = plan.kind === 'download' ? plan.target.kind : null;
  if (plan.kind === 'refresh') {
    const downloadWeb = webAssetUrl !== null && webAssetUrl !== '';
    return {
      ...IDLE_VIEW,
      primaryKind: downloadWeb ? 'download-web' : 'refresh',
      primaryLabel: PRIMARY_LABEL.update,
      showBackground: false,
      statusText: downloadWeb
        ? '点击「立即更新」直接下载 Web 版安装包'
        : '新版本已发布，点击「立即更新」刷新页面后生效',
    };
  }
  if (plan.kind === 'unavailable') {
    // 不可用的原因由正文的「自动更新失败…」提示承担，状态行不再重复
    return { ...IDLE_VIEW, primaryDisabled: true, showBackground: false };
  }
  return {
    ...IDLE_VIEW,
    primaryLabel: primaryLabelOf('update', installKind),
    // 便携版：提前说清楚下载完成后会自动退出替换，不用再点安装
    statusText:
      installKind === 'portable'
        ? '下载并校验通过后会自动退出应用完成替换，随后重新启动'
        : '下载并校验通过后会自动开始安装',
  };
}
