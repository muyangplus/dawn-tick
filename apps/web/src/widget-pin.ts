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
  { id: 'week', label: '一周概览', size: '4×4', description: '整周的课表格子' },
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

export interface PinWidgetResult {
  ok: boolean;
  /** 系统/启动器是否支持一键添加；false 时界面给出手动步骤 */
  supported: boolean;
  reason?: string | undefined;
}

/** 请求把某个小组件放到桌面：系统弹「添加到主屏幕」确认。 */
export async function pinWidget(id: MobileWidget['id']): Promise<PinWidgetResult> {
  if (!hasMobileWidgets()) {
    return { ok: false, supported: false, reason: '当前平台没有桌面小组件' };
  }
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin<{
      requestPin(options: { provider: string }): Promise<{ supported?: boolean; requested?: boolean; reason?: string }>;
    }>('DawnTickWidget');
    const result = await plugin.requestPin({ provider: id });
    const supported = result?.supported !== false;
    logInfo('widget', '请求添加桌面小组件', { provider: id, supported, requested: result?.requested === true });
    return { ok: true, supported, reason: result?.reason };
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    logWarn('widget', '请求添加桌面小组件失败', { provider: id, message: reason });
    return { ok: false, supported: false, reason };
  }
}
