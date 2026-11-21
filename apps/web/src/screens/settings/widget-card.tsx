import { useEffect, useState } from 'react';
import {
  WIDGET_BACKGROUNDS,
  WIDGET_VARIANT_LABEL,
  WIDGET_VARIANTS,
  type AppSettings,
  type WidgetBackground,
  type WidgetVariant,
} from '@dawn-tick/core';
import { canUseWidget, hasMobileWidgets, isAndroidApp } from '../../lib/capabilities.ts';
import { hideWidget, showWidget } from '../../widget-window.ts';
import {
  MOBILE_WIDGETS,
  pinWidget,
  readMobileWidgetStates,
  type MobileWidgetState,
  type PinWidgetStatus,
} from '../../widget-pin.ts';
import { readTrayStatus } from '../../storage-config.ts';
import { Button } from '../../components/ui/button.tsx';
import { Field } from '../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SwitchField,
} from '../../components/ui/controls.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { widgetCopy } from '../../copy/settings-widget.ts';
import { HelpLink } from '../../components/help-link.tsx';

/** 一键添加的结果文案：先给事实，再给下一步。 */
const PIN_STATUS_LABEL: Record<PinWidgetStatus, string> = widgetCopy.pinStatus;

const WIDGET_LABEL: Record<WidgetBackground, string> = widgetCopy.background;

export interface WidgetCardProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

/**
 * 悬浮窗与小组件卡：桌面悬浮窗的显示/隐藏与样式、托盘状态、倒计时开关、小组件背景，
 * 以及安卓端「添加到主屏」的四种尺寸。
 *
 * 托盘与小组件状态都是本卡自己的系统查询，结果只影响本卡，因此由卡持有。
 */
export function WidgetCard({ settings, onPatch }: WidgetCardProps) {
  const [trayStatus, setTrayStatus] = useState<string | null>(null);
  /** 正在等系统确认的尺寸：按钮转圈，避免重复点 */
  const [pinPending, setPinPending] = useState<MobileWidgetState['id'] | null>(null);
  /** 每种尺寸在桌面上的状态（已添加 / 被停用） */
  const [pinStates, setPinStates] = useState<MobileWidgetState[] | null>(null);

  useEffect(() => {
    if (!canUseWidget()) return;
    let cancelled = false;
    void (async () => {
      const result = await readTrayStatus();
      if (cancelled) return;
      setTrayStatus(
        result.status === null
          ? widgetCopy.trayUnavailable(result.error ?? null)
          : result.status.created
            ? widgetCopy.trayCreated(result.status.detail)
            : widgetCopy.trayCreateFailed(result.status.detail),
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
      {hasMobileWidgets() ? (
        <div className="flex flex-col gap-2" data-role="mobile-widget-guide">
          <span className="text-sm text-ink">{widgetCopy.mobileTitle}</span>
          <HelpLink entryId="widget-android-pin" />
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
                        {widgetCopy.added}
                      </span>
                    )}
                    {state?.disabled === true && (
                      <span className="text-xs text-danger-strong" data-role="widget-disabled">
                        {widgetCopy.disabled}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={widgetCopy.pinAria(widget.label)}
                      loading={pinPending === widget.id}
                      disabled={pinPending !== null && pinPending !== widget.id}
                      onClick={() => void addWidget(widget.id)}
                    >
                      {widgetCopy.pinButton}
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
              <span>{widgetCopy.floatingTitle}</span>
              <span className="truncate text-xs text-muted">{widgetCopy.floatingDescription}</span>
            </span>
            {canUseWidget() ? (
              <span className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={widgetCopy.showAria}
                  onClick={() =>
                    void showWidget(settings.widgetVariant).then((ok) => {
                      if (ok) toast.success(widgetCopy.shownToast);
                      else toast.error(widgetCopy.showFailed);
                    })
                  }
                >
                  {widgetCopy.showButton}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={widgetCopy.hideAria}
                  onClick={() => void hideWidget().then(() => toast.success(widgetCopy.hiddenToast))}
                >
                  {widgetCopy.hideButton}
                </Button>
              </span>
            ) : (
              <span className="text-xs text-muted">{widgetCopy.desktopOnly}</span>
            )}
          </label>
          <Field label={widgetCopy.variantLabel}>
            <Select
              value={settings.widgetVariant}
              onValueChange={(value) => {
                void onPatch({ widgetVariant: value as WidgetVariant }).then(() => {
                  if (canUseWidget()) void showWidget(value);
                });
              }}
            >
              <SelectTrigger aria-label={widgetCopy.variantLabel}>
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
      {canUseWidget() && (
        <StatusLine dataRole="tray-status">{widgetCopy.trayStatus(trayStatus)}</StatusLine>
      )}
      <SwitchField
        label={widgetCopy.tomorrowLabel}
        description={widgetCopy.tomorrowDescription}
        checked={settings.tomorrowPreview}
        onCheckedChange={(checked) => void onPatch({ tomorrowPreview: checked })}
        ariaLabel={widgetCopy.tomorrowLabel}
      />
      <SwitchField
        label={widgetCopy.semesterCountdownLabel}
        description={widgetCopy.semesterCountdownDescription}
        checked={settings.semesterCountdown}
        onCheckedChange={(checked) => void onPatch({ semesterCountdown: checked })}
        ariaLabel={widgetCopy.semesterCountdownLabel}
      />
      <SwitchField
        label={widgetCopy.holidayCountdownLabel}
        description={widgetCopy.holidayCountdownDescription}
        checked={settings.holidayCountdown}
        onCheckedChange={(checked) => void onPatch({ holidayCountdown: checked })}
        ariaLabel={widgetCopy.holidayCountdownLabel}
      />
      <Field
        label={widgetCopy.backgroundLabel}
        help={hasMobileWidgets() ? widgetCopy.backgroundHelpMobile : widgetCopy.backgroundHelpDesktop}
      >
        <Select
          value={settings.widgetBackground}
          onValueChange={(value) => void onPatch({ widgetBackground: value as WidgetBackground })}
        >
          <SelectTrigger aria-label={widgetCopy.backgroundLabel}>
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
    </>
  );
}
