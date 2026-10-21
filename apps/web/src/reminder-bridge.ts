import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { errorMessage } from './lib/errors.ts';
import { invokeNative, REMINDER_ACTION_EVENT } from './lib/native.ts';
import { loadPlugin, PLUGIN_NAMES, type ReminderActionsPlugin } from './lib/plugins.ts';
import { logDebug, logWarn } from './log.ts';
import { notifyNow, type NotifyPermission } from './notify.ts';
import type { DeliveryItem, SnoozedDelivery } from './reminder-collect.ts';

export type ReminderActionSource = 'android' | 'desktop';

/** 原生事件/托盘事件里的动作负载。字段可选是为了兼容进程重启后的离线队列。 */
export interface ReminderActionPayload {
  id: string | number;
  action: string;
  targetId?: string | undefined;
  kind?: string | undefined;
}

/** 托盘「提醒」子菜单里的一条，与 Rust `PendingReminder` 字段一致。 */
export interface TrayReminder {
  id: string;
  title: string;
  kind: string;
}

export type ReminderActionListener = (
  payload: ReminderActionPayload,
  source: ReminderActionSource,
) => void;

/**
 * 提醒的原生桥（R-07）：Android 通知动作 + Windows 托盘菜单。
 *
 * 只做「平台可用性 + 插件/命令调用 + 事件归一」，不持有提醒业务状态；
 * 贪睡/勿扰/完成的计划变更与落库在 `reminder-scheduler.ts`。
 */
export class ReminderBridge {
  private plugin: ReminderActionsPlugin | null = null;
  private listener: { remove: () => Promise<void> } | null = null;
  private unlisten: (() => void) | null = null;
  private stopped = false;

  /** 连接当前平台；返回 Android 通知权限的初始状态，其它平台返回 null。 */
  async connect(onAction: ReminderActionListener): Promise<NotifyPermission | null> {
    this.stopped = false;
    let permission: NotifyPermission | null = null;
    if (isAndroidApp()) permission = await this.connectAndroid(onAction);
    if (isDesktopApp()) this.connectDesktop(onAction);
    return permission;
  }

  stop(): void {
    this.stopped = true;
    if (this.listener !== null) void this.listener.remove();
    if (this.unlisten !== null) this.unlisten();
    this.plugin = null;
    this.listener = null;
    this.unlisten = null;
  }

  /** 通知权限回读：只报告，不弹系统弹窗；没有原生插件时返回 null。 */
  async refreshPermission(): Promise<NotifyPermission | null> {
    if (this.plugin === null) return null;
    try {
      const info = await this.plugin.requestPermissionInfo();
      if (info.notifications === 'granted') return 'granted';
      if (info.notifications === 'denied') return 'denied';
      return null;
    } catch (cause: unknown) {
      logWarn('reminder', '读取提醒权限状态失败', { message: errorMessage(cause) });
      return null;
    }
  }

  /** 排定一条提醒；Android 插件不可用或调用失败时返回 false，由扫描下次重试。 */
  async schedule(item: DeliveryItem): Promise<boolean> {
    if (this.plugin === null) return false;
    try {
      await this.plugin.schedule({
        id: item.notificationId,
        title: item.title,
        body: item.detail,
        at: item.triggerAt,
        kind: item.kind,
        targetId: item.targetId,
      });
      return true;
    } catch (cause: unknown) {
      logWarn('reminder', '排定提醒失败，下次扫描重试', {
        title: item.title,
        message: errorMessage(cause),
      });
      return false;
    }
  }

  /** 立即投递：Android 交给 ReminderActions 插件（带动作按钮），其它平台走原通知。 */
  async deliver(item: DeliveryItem | SnoozedDelivery): Promise<void> {
    if (isAndroidApp() && this.plugin !== null) {
      try {
        await this.plugin.schedule({
          id: item.notificationId,
          title: item.title,
          body: item.detail,
          at: Math.max(item.triggerAt, Date.now() + 250),
          kind: item.kind,
          targetId: item.targetId,
        });
        return;
      } catch (cause: unknown) {
        logWarn('reminder', '原生投递失败，回退到页面内通知', {
          title: item.title,
          message: errorMessage(cause),
        });
      }
    }
    await notifyNow(item.title, item.detail);
  }

  /** 取消一条提醒（完成/勿扰）；非 Android 平台没有原生排定，直接跳过。 */
  async cancel(id: number): Promise<void> {
    if (this.plugin === null) return;
    try {
      await this.plugin.cancel({ id });
    } catch (cause: unknown) {
      logWarn('reminder', '取消提醒失败', { id, message: errorMessage(cause) });
    }
  }

  /** 取走进程不在线时堆积的动作。 */
  async pollActions(): Promise<ReminderActionPayload[]> {
    if (this.plugin === null) return [];
    try {
      const result = await this.plugin.pollActions();
      const items: ReminderActionPayload[] = [];
      for (const item of result.actions ?? []) {
        if (typeof item.id !== 'number' || typeof item.action !== 'string') continue;
        const payload: ReminderActionPayload = { id: item.id, action: item.action };
        if (item.targetId !== undefined) payload.targetId = item.targetId;
        if (item.kind !== undefined) payload.kind = item.kind;
        items.push(payload);
      }
      return items;
    } catch (cause: unknown) {
      logWarn('reminder', '读取提醒动作失败', { message: errorMessage(cause) });
      return [];
    }
  }

  /** 更新 Windows 托盘「提醒」子菜单；非桌面端什么都不做。 */
  async syncTray(items: readonly TrayReminder[]): Promise<void> {
    if (!isDesktopApp()) return;
    try {
      await invokeNative('set_pending_reminders', { items });
      logDebug('reminder', '已同步托盘提醒动作', { count: items.length });
    } catch (cause: unknown) {
      // 下一次扫描还会再试；这里只记日志，不打扰用户
      logWarn('reminder', '同步托盘提醒失败', { message: errorMessage(cause) });
    }
  }

  /** 前端处理完托盘动作后清掉该项。 */
  async clearTray(id: string): Promise<void> {
    if (!isDesktopApp()) return;
    try {
      await invokeNative('clear_pending_reminder', { id });
    } catch (cause: unknown) {
      logWarn('reminder', '清除托盘提醒失败', { id, message: errorMessage(cause) });
    }
  }

  private async connectAndroid(onAction: ReminderActionListener): Promise<NotifyPermission | null> {
    try {
      const loaded = await loadPlugin<ReminderActionsPlugin>(PLUGIN_NAMES.reminderActions);
      if (loaded === null || this.stopped) return null;
      this.plugin = loaded;
      this.listener = await loaded.addListener('actionPerformed', (payload) => {
        onAction(
          {
            id: payload.id,
            action: payload.action,
            targetId: payload.targetId,
            kind: payload.kind,
          },
          'android',
        );
      });
      if (this.stopped) {
        void this.listener.remove();
        this.listener = null;
        this.plugin = null;
        return null;
      }
      const permission = await this.refreshPermission();
      try {
        const info = await loaded.requestPermissionInfo();
        logDebug('reminder', '提醒权限状态', {
          notifications: info.notifications,
          exactAlarm: info.exactAlarm,
        });
      } catch {
        // 状态查询失败不影响投递
      }
      return permission;
    } catch (cause: unknown) {
      logWarn('reminder', '提醒插件加载失败，回退到页面内提醒', {
        message: errorMessage(cause),
      });
      return null;
    }
  }

  private connectDesktop(onAction: ReminderActionListener): void {
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (this.stopped) return;
        const unlisten = await listen<{ id: string; action: string }>(REMINDER_ACTION_EVENT, (event) => {
          onAction({ id: event.payload.id, action: event.payload.action }, 'desktop');
        });
        if (this.stopped) unlisten();
        else this.unlisten = unlisten;
      } catch (cause: unknown) {
        logWarn('reminder', '监听托盘提醒动作失败', { message: errorMessage(cause) });
      }
    })();
  }
}
