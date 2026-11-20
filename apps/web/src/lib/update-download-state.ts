/** 自动更新的界面状态机：阶段、进度与事件归约，纯函数。 */

export type UpdatePlatform = 'windows' | 'android' | 'web';

/** 下载/安装阶段。`checking` 留给「重新检查」入口；弹窗拿到的是已检查过的结果。 */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'done' | 'failed';

export interface UpdateDownloadState {
  phase: UpdatePhase;
  /** 已接收字节 */
  received: number;
  /** 总字节；服务端与清单都没给时为 null */
  total: number | null;
  /** 0–1 的进度；总长未知时为 null */
  progress: number | null;
  /** 当前阶段的可读说明 */
  message: string | null;
  /** 失败原因（原始一句话，展示时由界面用 fail() 拼完整句） */
  error: string | null;
  /** 落盘路径：桌面是安装包绝对路径，Android 是 `file://` URI */
  path: string | null;
  /** Android 未授权「安装未知应用」时为 true，授权后重试即可 */
  needsPermission: boolean;
}

export const INITIAL_UPDATE_STATE: UpdateDownloadState = {
  phase: 'idle',
  received: 0,
  total: null,
  progress: null,
  message: null,
  error: null,
  path: null,
  needsPermission: false,
};

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'start' }
  | { type: 'progress'; received: number; total: number | null }
  | { type: 'verify' }
  | { type: 'install' }
  | { type: 'done'; message: string; path?: string | null }
  | { type: 'fail'; error: string; needsPermission?: boolean; path?: string | null }
  | { type: 'cancel' }
  | { type: 'reset' };

const BUSY_PHASES: readonly UpdatePhase[] = ['downloading', 'verifying', 'installing'];

/** 是否正在下载/校验/安装：界面据此禁用重复点击并提供「取消下载」。 */
export function isUpdateBusy(phase: UpdatePhase): boolean {
  return BUSY_PHASES.includes(phase);
}

/**
 * 状态机：只接受合法转移，非法事件原样返回。
 * idle → downloading → verifying → installing → done；任一阶段可 failed 或取消回 idle。
 */
export function reduceUpdateState(state: UpdateDownloadState, event: UpdateEvent): UpdateDownloadState {
  switch (event.type) {
    case 'check':
      return state.phase === 'idle' ? { ...state, phase: 'checking', message: '正在检查更新…' } : state;
    case 'start':
      if (state.phase !== 'idle' && state.phase !== 'checking' && state.phase !== 'failed' && state.phase !== 'done') {
        return state;
      }
      return { ...INITIAL_UPDATE_STATE, phase: 'downloading', message: '正在下载安装包…' };
    case 'progress': {
      if (state.phase !== 'downloading') return state;
      const total = event.total !== null && event.total > 0 ? event.total : null;
      const progress = total === null ? null : Math.min(1, Math.max(0, event.received / total));
      return { ...state, received: event.received, total, progress };
    }
    case 'verify':
      return state.phase === 'downloading'
        ? { ...state, phase: 'verifying', progress: 1, message: '正在校验安装包…' }
        : state;
    case 'install':
      return state.phase === 'verifying' ? { ...state, phase: 'installing', message: '正在写入安装包…' } : state;
    case 'done':
      return state.phase === 'idle' || isUpdateBusy(state.phase)
        ? {
            ...state,
            phase: 'done',
            progress: 1,
            message: event.message,
            error: null,
            path: event.path ?? state.path,
            needsPermission: false,
          }
        : state;
    case 'fail':
      // idle 也能失败：没有该平台的资产时还没开始下载
      return state.phase === 'idle' || state.phase === 'checking' || isUpdateBusy(state.phase)
        ? {
            ...state,
            phase: 'failed',
            message: null,
            error: event.error,
            needsPermission: event.needsPermission === true,
            path: event.path ?? state.path,
          }
        : state;
    case 'cancel':
      return isUpdateBusy(state.phase) ? { ...INITIAL_UPDATE_STATE, message: '已取消下载' } : state;
    case 'reset':
      return INITIAL_UPDATE_STATE;
    default:
      return state;
  }
}
