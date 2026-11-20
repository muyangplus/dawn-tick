import { hasMobileWidgets } from './lib/capabilities.ts';
import { nativeErrorMessage } from './lib/native.ts';
import { PLUGIN_NAMES, loadPlugin, type WidgetPinPlugin } from './lib/plugins.ts';
import { logInfo, logWarn } from './log.ts';
import { appSystemCopy } from './copy/app-system.ts';

/** 是否有主屏小组件（仅 Android）：实现收在 lib/capabilities.ts，这里保留原导出路径。 */
export { hasMobileWidgets };

/** 手机端小组件：id 与 Android 端注册的 receiver 一一对应。 */
export interface MobileWidget {
  id: 'next' | 'today' | 'week' | 'exam';
  label: string;
  size: string;
  description: string;
}

export const MOBILE_WIDGETS: readonly MobileWidget[] = [
  { id: 'next', size: '2×2', ...appSystemCopy.widget.next },
  { id: 'today', size: '4×2', ...appSystemCopy.widget.today },
  { id: 'week', size: '4×4', ...appSystemCopy.widget.week },
  { id: 'exam', size: '2×2', ...appSystemCopy.widget.exam },
];

/** 一键添加的结果：把「系统不支持 / 被停用 / 已添加 / 取消或没弹窗 / 成功」分开。 */
export type PinWidgetStatus =
  | 'added'
  | 'already-added'
  | 'cancelled'
  | 'unsupported'
  | 'disabled'
  | 'rejected'
  | 'error';

export interface PinWidgetResult {
  status: PinWidgetStatus;
  /** 原生侧给的补充说明；界面优先用固定文案，只有排查时才看它 */
  reason?: string | undefined;
}

/** 桌面上已有的小组件状态：设置页显示「已添加」，也用来判断组件是否被停用。 */
export interface MobileWidgetState {
  id: MobileWidget['id'];
  /** 桌面上已放了这个尺寸 */
  added: boolean;
  /** 组件被系统或启动器停用 */
  disabled: boolean;
}

async function loadWidgetPlugin(): Promise<WidgetPinPlugin | null> {
  try {
    return await loadPlugin<WidgetPinPlugin>(PLUGIN_NAMES.widgetPin);
  } catch (cause: unknown) {
    logWarn('widget', '小组件插件不可用', { message: nativeErrorMessage(cause) });
    return null;
  }
}

const PIN_STATUS: readonly PinWidgetStatus[] = [
  'added',
  'already-added',
  'cancelled',
  'unsupported',
  'disabled',
  'rejected',
  'error',
];

function pinStatusOf(value: string | undefined): PinWidgetStatus {
  return PIN_STATUS.find((item) => item === value) ?? 'error';
}

/** 请求把某个小组件放到桌面：系统弹「添加到主屏幕」确认，并回报确认结果。 */
export async function pinWidget(id: MobileWidget['id']): Promise<PinWidgetResult> {
  const plugin = await loadWidgetPlugin();
  if (plugin === null) {
    return { status: 'unsupported', reason: appSystemCopy.widget.unsupported };
  }
  try {
    const result = await plugin.requestPin({ provider: id });
    const status = pinStatusOf(result?.status);
    logInfo('widget', '已请求添加主屏小组件', { provider: id, status, reason: result?.reason ?? null });
    return { status, reason: result?.reason };
  } catch (cause: unknown) {
    const reason = nativeErrorMessage(cause);
    logWarn('widget', '主屏小组件添加请求失败', { provider: id, message: reason });
    return { status: 'error', reason };
  }
}

/** 读每种尺寸在桌面上的状态；非安卓或读取失败时返回 null。 */
export async function readMobileWidgetStates(): Promise<MobileWidgetState[] | null> {
  const plugin = await loadWidgetPlugin();
  if (plugin === null) return null;
  try {
    const result = await plugin.readStates();
    if (!Array.isArray(result?.widgets)) return null;
    const states: MobileWidgetState[] = [];
    for (const item of result.widgets) {
      const known = MOBILE_WIDGETS.find((widget) => widget.id === item.provider);
      if (known === undefined) continue;
      states.push({ id: known.id, added: item.added === true, disabled: item.enabled === false });
    }
    return states;
  } catch (cause: unknown) {
    logWarn('widget', '主屏小组件状态读取失败', {
      message: nativeErrorMessage(cause),
    });
    return null;
  }
}
