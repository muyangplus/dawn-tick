import { detectPlatform } from './platform-detect.ts';
import { logInfo, logWarn } from './log.ts';

/** 手机端小组件：id 与 Android 端注册的 receiver 一一对应。 */
export interface MobileWidget {
  id: 'next' | 'today' | 'week' | 'exam';
  label: string;
  size: string;
  description: string;
}

export const MOBILE_WIDGETS: readonly MobileWidget[] = [
  { id: 'next', label: '下一节课', size: '2×2', description: '下一节课的课程、时间与地点' },
  { id: 'today', label: '今日课表', size: '4×2', description: '今天所有课程与进行中的一节' },
  { id: 'week', label: '一周概览', size: '4×4', description: '一周课程清单' },
  { id: 'exam', label: '考试倒计时', size: '2×2', description: '最近的考试与剩余天数' },
];

/** 手动添加步骤：一键添加不可用时按这个来。 */
export const WIDGET_PIN_STEPS: readonly string[] = [
  '长按桌面空白处，进入「小组件」列表',
  '在列表里找到「晓刻 DawnTick」',
  '选尺寸后拖到桌面上',
];

/** 只有 Android 应用内才有桌面小组件；Windows 用悬浮窗、Web 没有。 */
export function hasMobileWidgets(): boolean {
  return detectPlatform() === 'capacitor';
}

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

/** 原生小组件插件：请求添加、读取每种尺寸的当前状态。 */
interface WidgetPlugin {
  requestPin(options: { provider: string }): Promise<{ status?: string; reason?: string }>;
  readStates(): Promise<{
    supported?: boolean;
    widgets?: { provider?: string; added?: boolean; enabled?: boolean }[];
  }>;
}

async function loadWidgetPlugin(): Promise<WidgetPlugin | null> {
  if (!hasMobileWidgets()) return null;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    return registerPlugin<WidgetPlugin>('DawnTickWidget');
  } catch (cause: unknown) {
    logWarn('widget', '小组件插件不可用', { message: cause instanceof Error ? cause.message : String(cause) });
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
    return { status: 'unsupported', reason: '当前平台没有桌面小组件' };
  }
  try {
    const result = await plugin.requestPin({ provider: id });
    const status = pinStatusOf(result?.status);
    logInfo('widget', '请求添加桌面小组件', { provider: id, status, reason: result?.reason ?? null });
    return { status, reason: result?.reason };
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    logWarn('widget', '请求添加桌面小组件失败', { provider: id, message: reason });
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
    logWarn('widget', '读取桌面小组件状态失败', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}
