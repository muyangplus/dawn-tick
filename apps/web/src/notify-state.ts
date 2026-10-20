import type { NotifyStatus } from './permissions.ts';

/**
 * 通知权限六态（P1-11）：状态查询与文案映射合一，界面只消费这个视图。
 * 六态：未申请 / 已允许 / 已拒绝 / 已拒绝且不再询问 / 通知已关闭 / 通知渠道已静音。
 * 另有读取中与「当前环境不支持通知」两个非权限态，用来避免假装有权限。
 */
export type NotifyState =
  | 'loading'
  | 'unsupported'
  | 'unreadable'
  | 'not-applied'
  | 'granted'
  | 'denied'
  | 'permanently-denied'
  | 'app-disabled'
  | 'channel-muted';

export interface NotifyStateView {
  state: NotifyState;
  label: string;
  /** 下一步能做什么：申请权限（还能弹系统弹窗）或去系统设置 */
  action: 'request' | 'settings' | null;
}

export const NOTIFY_STATE_LABEL: Record<NotifyState, string> = {
  loading: '读取中…',
  unsupported: '当前环境不支持通知',
  unreadable: '通知状态不可读',
  'not-applied': '未申请',
  granted: '已允许',
  denied: '已拒绝',
  'permanently-denied': '已拒绝且不再询问',
  'app-disabled': '通知已关闭',
  'channel-muted': '通知渠道已静音',
};

function view(state: NotifyState, action: NotifyStateView['action'] = null): NotifyStateView {
  return { state, label: NOTIFY_STATE_LABEL[state], action };
}

export function notifyStateOf(status: NotifyStatus | null): NotifyStateView {
  if (status === null) return view('loading');
  if (status.runtime === 'unsupported') return view('unsupported');
  if (status.runtime === 'unreadable') return view('unreadable');
  // 应用级开关与渠道静音只有 Android 原生能报：其它平台不假装存在这两个状态
  if (status.source === 'android') {
    if (!status.appEnabled) return view('app-disabled', 'settings');
    if (status.channelMuted) return view('channel-muted', 'settings');
  }
  switch (status.runtime) {
    case 'granted':
      return view('granted');
    case 'prompt':
      return view('not-applied', 'request');
    case 'denied':
      return view('denied', 'request');
    case 'permanently-denied':
      return view('permanently-denied', 'settings');
    default:
      return view('unsupported');
  }
}

/** 权限异常：提醒发不出去，且需要用户做点什么。 */
export function isNotifyAbnormal(state: NotifyStateView): boolean {
  return (
    state.state === 'denied' ||
    state.state === 'permanently-denied' ||
    state.state === 'app-disabled' ||
    state.state === 'channel-muted'
  );
}

/** 横幅上的下一步：还能弹系统弹窗就重新申请，否则只能去系统设置。 */
export function notifyNextStep(state: NotifyStateView): string {
  return state.action === 'settings' ? '去系统设置开启' : '重新申请通知权限';
}
