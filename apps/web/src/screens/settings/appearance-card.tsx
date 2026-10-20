import { useEffect, useState } from 'react';
import {
  MOTION_LABEL,
  MOTION_MODES,
  THEME_PRESETS,
  VIEW_DAY_OPTIONS,
  WIDGET_BACKGROUNDS,
  WIDGET_VARIANTS,
  isValidTimeZone,
  type AppSettings,
  type MotionMode,
  type ThemePreset,
  type TodoSort,
  type WidgetBackground,
  type WidgetVariant,
} from '@dawn-tick/core';
import { PRESETS } from '../../design/tokens.ts';
import { canUseWidget, hasMobileWidgets, isAndroidApp, isAutoStartSupported } from '../../lib/capabilities.ts';
import { hideWidget, showWidget } from '../../widget-window.ts';
import {
  MOBILE_WIDGETS,
  pinWidget,
  readMobileWidgetStates,
  type MobileWidgetState,
  type PinWidgetStatus,
} from '../../widget-pin.ts';
import { readTrayStatus } from '../../storage-config.ts';
import { StartupSettings } from '../../components/startup-settings.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SwitchField,
} from '../../components/ui/controls.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { fail } from '../../copy/zh.ts';

/** 一键添加的结果文案：先给事实，再给下一步。 */
const PIN_STATUS_LABEL: Record<PinWidgetStatus, string> = {
  added: '已添加到主屏',
  'already-added': '已在主屏上',
  cancelled: '没收到系统确认，请长按主屏添加',
  unsupported: '启动器不支持，请长按主屏添加',
  disabled: '小组件被停用，请在系统设置启用',
  rejected: '系统没接受请求，请长按主屏添加',
  error: '添加失败，请长按主屏添加',
};

const THEME_LABEL: Record<ThemePreset, string> = {
  vivid: '青春活力',
  fresh: '清爽学院',
  mono: '极简墨色',
  muted: '莫兰迪柔光',
};

const WIDGET_LABEL: Record<WidgetBackground, string> = {
  light: '浅色',
  dark: '深色',
  transparent: '透明',
};

/** 时区候选：常用 IANA 时区，默认上海；系统时区不在列表里时会额外补一项。 */
export const TIME_ZONE_OPTIONS: readonly string[] = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

const WIDGET_VARIANT_LABEL: Record<WidgetVariant, string> = {
  bar: '紧凑条：下一节课 + 倒计时',
  today: '今日课表：今天的课，当前课高亮',
  minimal: '极简数字：只显示大号倒计时',
  combo: '组合卡：下一节课 + 待办作业',
};

export interface AppearanceCardProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

/**
 * 外观卡：主题与深浅、周视图、动效、小组件与悬浮窗、时区、待办排序、启动项。
 *
 * 托盘与小组件状态都是本卡自己的系统查询，结果只影响本卡，因此由卡持有；
 * 设置项一律通过 `onPatch` 落库。
 */
export function AppearanceCard({ settings, onPatch }: AppearanceCardProps) {
  const [trayStatus, setTrayStatus] = useState<string | null>(null);
  /** 正在等系统确认的尺寸：按钮转圈，避免重复点 */
  const [pinPending, setPinPending] = useState<MobileWidgetState['id'] | null>(null);
  /** 每种尺寸在桌面上的状态（已添加 / 被停用） */
  const [pinStates, setPinStates] = useState<MobileWidgetState[] | null>(null);
  const zoneInvalid = !isValidTimeZone(settings.timeZone);

  useEffect(() => {
    if (!canUseWidget()) return;
    let cancelled = false;
    void (async () => {
      const result = await readTrayStatus();
      if (cancelled) return;
      setTrayStatus(
        result.status === null
          ? `不可用（${result.error ?? '未知原因'}）`
          : `${result.status.created ? '已创建' : '创建失败'}（${result.status.detail}）`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAndroidApp()) return;
    let cancelled = false;
    void (async () => {
      const states = await readMobileWidgetStates();
      if (!cancelled) setPinStates(states);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 请求把一种尺寸的小组件添加到桌面：动作结果走 toast，等系统确认后再给结果。 */
  async function addWidget(id: MobileWidgetState['id']): Promise<void> {
    setPinPending(id);
    const result = await pinWidget(id);
    setPinPending(null);
    if (result.status === 'added' || result.status === 'already-added') {
      toast.success(PIN_STATUS_LABEL[result.status]);
      const states = await readMobileWidgetStates();
      if (states !== null) setPinStates(states);
      return;
    }
    toast.info(PIN_STATUS_LABEL[result.status]);
  }

  return (
    <>
      <Field label="主题风格">
        <Select
          value={settings.themePreset}
          onValueChange={(value) => void onPatch({ themePreset: value as ThemePreset })}
        >
          <SelectTrigger aria-label="主题风格">
            <span>{THEME_LABEL[settings.themePreset]}</span>
          </SelectTrigger>
          <SelectContent>
            {THEME_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {PRESETS[preset].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="深浅模式">
        <Select
          value={settings.theme}
          onValueChange={(value) => void onPatch({ theme: value as AppSettings['theme'] })}
        >
          <SelectTrigger aria-label="深浅模式">
            <span>
              {settings.theme === 'system' ? '跟随系统' : settings.theme === 'dark' ? '深色' : '浅色'}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">跟随系统</SelectItem>
            <SelectItem value="light">浅色</SelectItem>
            <SelectItem value="dark">深色</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="周视图天数" hint="1–7 天" help="列宽按屏宽等分，不横向滚动">
        <Select value={String(settings.viewDays)} onValueChange={(value) => void onPatch({ viewDays: Number(value) })}>
          <SelectTrigger aria-label="周视图天数">
            <span>{settings.viewDays} 天</span>
          </SelectTrigger>
          <SelectContent>
            {VIEW_DAY_OPTIONS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {days} 天
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <SwitchField
        label="今天为第一天"
        description="关掉从本周周一开头"
        checked={settings.weekStartsToday}
        onCheckedChange={(checked) => void onPatch({ weekStartsToday: checked })}
        ariaLabel="今天为第一天"
      />
      <SwitchField
        label="始终不显示周末"
        description="跳过周六日，列数按天数"
        checked={settings.hideWeekends}
        onCheckedChange={(checked) => void onPatch({ hideWeekends: checked })}
        ariaLabel="始终不显示周末"
      />
      <Field label="界面动效" hint="页面与弹窗过渡" help="跟随系统时遵守系统的「减少动态效果」">
        <Select value={settings.motion} onValueChange={(value) => void onPatch({ motion: value as MotionMode })}>
          <SelectTrigger aria-label="界面动效">
            <span>{MOTION_LABEL[settings.motion]}</span>
          </SelectTrigger>
          <SelectContent>
            {MOTION_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {MOTION_LABEL[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <SwitchField
        label="周视图显示非本周课程"
        description="这一周不上的课用虚线框标出"
        checked={settings.showOtherWeeks}
        onCheckedChange={(checked) => void onPatch({ showOtherWeeks: checked })}
        ariaLabel="周视图显示非本周课程"
      />
      {hasMobileWidgets() ? (
        <div className="flex flex-col gap-2" data-role="mobile-widget-guide">
          <span className="text-sm text-ink">主屏小组件</span>
          <span className="text-xs text-muted">
            主屏长按 → 小组件 → 晓刻
          </span>
          {MOBILE_WIDGETS.map((widget) => {
            const state = pinStates?.find((item) => item.id === widget.id) ?? null;
            return (
              <div
                key={widget.id}
                className="flex flex-col gap-1 rounded-md border border-line bg-surface p-2"
                data-role="mobile-widget-row"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-ink">
                      {widget.label}
                      <span className="ml-1 text-xs text-muted">{widget.size}</span>
                    </span>
                    <span className="truncate text-xs text-muted">{widget.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {state?.added === true && (
                      <span className="text-xs text-muted" data-role="widget-added">
                        已添加
                      </span>
                    )}
                    {state?.disabled === true && (
                      <span className="text-xs text-danger-strong" data-role="widget-disabled">
                        已停用
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`添加小组件到主屏：${widget.label}`}
                      loading={pinPending === widget.id}
                      disabled={pinPending !== null && pinPending !== widget.id}
                      onClick={() => void addWidget(widget.id)}
                    >
                      添加到主屏
                    </Button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
            <span className="flex min-w-0 flex-col">
              <span>悬浮窗</span>
              <span className="truncate text-xs text-muted">无边框置顶小条，显示下一节课与倒计时</span>
            </span>
            {canUseWidget() ? (
              <span className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="显示悬浮窗"
                  onClick={() =>
                    void showWidget(settings.widgetVariant).then((ok) => {
                      if (ok) toast.success('已显示悬浮窗');
                      else toast.error(fail('显示悬浮窗', null, '请重试'));
                    })
                  }
                >
                  显示
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="隐藏悬浮窗"
                  onClick={() => void hideWidget().then(() => toast.success('已隐藏悬浮窗'))}
                >
                  隐藏
                </Button>
              </span>
            ) : (
              <span className="text-xs text-muted">仅桌面版</span>
            )}
          </label>
          <Field label="悬浮窗样式">
            <Select
              value={settings.widgetVariant}
              onValueChange={(value) => {
                void onPatch({ widgetVariant: value as WidgetVariant }).then(() => {
                  if (canUseWidget()) void showWidget(value);
                });
              }}
            >
              <SelectTrigger aria-label="悬浮窗样式">
                <span>{WIDGET_VARIANT_LABEL[settings.widgetVariant]}</span>
              </SelectTrigger>
              <SelectContent>
                {WIDGET_VARIANTS.map((variant) => (
                  <SelectItem key={variant} value={variant}>
                    {WIDGET_VARIANT_LABEL[variant]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
      <span className="text-xs text-muted">卡片显隐在顶部「卡片布局」</span>
      {canUseWidget() && (
        <StatusLine dataRole="tray-status">托盘状态：{trayStatus === null ? '读取中…' : trayStatus}</StatusLine>
      )}
      <SwitchField
        label="明日课程预告"
        description="当天没课或课上完时显示"
        checked={settings.tomorrowPreview}
        onCheckedChange={(checked) => void onPatch({ tomorrowPreview: checked })}
        ariaLabel="明日课程预告"
      />
      <SwitchField
        label="开学倒计时"
        description="学期开始前显示距离开学还有几天"
        checked={settings.semesterCountdown}
        onCheckedChange={(checked) => void onPatch({ semesterCountdown: checked })}
        ariaLabel="开学倒计时"
      />
      <SwitchField
        label="假期倒计时"
        description="显示距离下一个法定假日还有几天"
        checked={settings.holidayCountdown}
        onCheckedChange={(checked) => void onPatch({ holidayCountdown: checked })}
        ariaLabel="假期倒计时"
      />
      <Field label="小组件背景">
        <Select
          value={settings.widgetBackground}
          onValueChange={(value) => void onPatch({ widgetBackground: value as WidgetBackground })}
        >
          <SelectTrigger aria-label="小组件背景">
            <span>{WIDGET_LABEL[settings.widgetBackground]}</span>
          </SelectTrigger>
          <SelectContent>
            {WIDGET_BACKGROUNDS.map((background) => (
              <SelectItem key={background} value={background}>
                {WIDGET_LABEL[background]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="时区"
        hint="默认上海；首次启动会按系统时区对齐一次"
        error={zoneInvalid ? '时区名无效' : undefined}
      >
        <Select value={settings.timeZone} onValueChange={(value) => void onPatch({ timeZone: value })}>
          <SelectTrigger aria-label="时区">
            <span>{settings.timeZone}</span>
          </SelectTrigger>
          <SelectContent>
            {TIME_ZONE_OPTIONS.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone}
              </SelectItem>
            ))}
            {!TIME_ZONE_OPTIONS.includes(settings.timeZone) && (
              <SelectItem value={settings.timeZone}>{settings.timeZone}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
      <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="size-4"
          checked={settings.autoTimeZone}
          onChange={(event) => void onPatch({ autoTimeZone: event.target.checked })}
        />
        时区跟随设备
      </label>
      <Field label="待办排序">
        <Select value={settings.todoSort} onValueChange={(value) => void onPatch({ todoSort: value as TodoSort })}>
          <SelectTrigger aria-label="待办排序">
            <span>{settings.todoSort === 'type' ? '按类型' : '按开始时间'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="start">按开始时间</SelectItem>
            <SelectItem value="type">按类型（作业 → 考试 → 实验 → 日程）</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <StartupSettings supported={isAutoStartSupported()} settings={settings} onPatch={onPatch} />
    </>
  );
}
