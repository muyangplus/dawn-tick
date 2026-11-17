import { updateEvent, type ReminderOccurrence, type Storage } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { errorMessage } from './lib/errors.ts';
import {
  ACTION_KEEP_MS,
  isReminderSuppressed,
  normalizeReminderKind,
  parseReminderAction,
  planReminderAction,
  pruneSuppression,
  takeDue,
  type DonePlan,
  type DoneRecord,
  type MutePlan,
  type MuteRecord,
  type ReminderActionTarget,
  type SnoozePlan,
  type Suppression,
} from './lib/reminder-actions.ts';
import { logDebug, logWarn } from './log.ts';
import { notifyNow, type NotifyPermission } from './notify.ts';
import { toast } from './lib/toast.ts';
import {
  ReminderBridge,
  type ReminderActionPayload,
  type ReminderActionSource,
  type TrayReminder,
} from './reminder-bridge.ts';
import {
  collect,
  hashKey,
  type ClassReminderDefaults,
  type DeliveryItem,
  type SnoozedDelivery,
} from './reminder-collect.ts';

const SCAN_INTERVAL_MS = 30_000;
/** 补投上限：睡眠/休眠唤醒后只补最近这段时间内到点的提醒，避免一次弹出一早上的旧提醒。 */
const CATCH_UP_MS = 5 * 60 * 1000;

/** 时钟与定时器：默认用全局实现，测试可注入。 */
export interface SchedulerClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const SYSTEM_CLOCK: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** 调度器用到的平台桥接口：默认 `ReminderBridge`，测试可注入桩。 */
export type ReminderBridgeLike = Pick<
  ReminderBridge,
  | 'connect'
  | 'stop'
  | 'refreshPermission'
  | 'schedule'
  | 'deliver'
  | 'cancel'
  | 'pending'
  | 'pollActions'
  | 'syncTray'
  | 'clearTray'
>;
/** Windows 托盘最多列出几条待提醒；多了菜单过长。 */
const TRAY_LIMIT = 5;

export interface ReminderSchedulerOptions {
  storage: Storage;
  semesterId: string;
  timeZone: string;
  defaults: ClassReminderDefaults;
  /** 未来 7 天待提醒（设置页展示用） */
  onUpcoming: (items: ReminderOccurrence[]) => void;
  /** 原生通知权限状态回读 */
  onPermission: (permission: NotifyPermission) => void;
  clock?: SchedulerClock;
  bridge?: ReminderBridgeLike;
}

/**
 * 提醒投递与动作执行器（R-07）。
 *
 * 与 React 解耦：`useReminders.ts` 只负责挂载/卸载与把状态抛给界面；
 * 这里持有扫描结果、通知 id 映射、贪睡/勿扰/完成抑制；平台调用统一经
 * `reminder-bridge.ts`，动作语义全部来自 `lib/reminder-actions.ts`。
 */
export class ReminderScheduler {
  private readonly bridge: ReminderBridgeLike;
  private readonly clock: SchedulerClock;
  private readonly handled = new Set<string>();
  /** 下个扫描间隔内到点的提醒：按到点时刻单独定时，不等下一轮扫描 */
  private readonly pending = new Map<string, unknown>();
  /** 上一轮成功扫描的时刻；两轮之间到点的提醒由下一轮补投 */
  private lastScanAt: number | null = null;
  /** Android 原生贪睡：通知 id → 再次提醒时刻；对账时不撤销 */
  private nativeSnoozes = new Map<number, number>();
  private readonly deliveries = new Map<string, DeliveryItem>();
  private readonly trayPinned = new Map<string, DeliveryItem>();
  private lastScan: DeliveryItem[] = [];
  private snoozes: SnoozedDelivery[] = [];
  private mutes: MuteRecord[] = [];
  private doneRecords: DoneRecord[] = [];
  private traySignature = '';
  private timer: unknown = null;
  private stopped = false;
  private readonly options: ReminderSchedulerOptions;

  constructor(options: ReminderSchedulerOptions) {
    this.options = options;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.bridge = options.bridge ?? new ReminderBridge();
  }

  async start(): Promise<void> {
    const permission = await this.bridge.connect((payload, source) => {
      void this.applyAction(payload, source);
    });
    if (permission === 'granted') this.options.onPermission('granted');
    else if (permission === 'denied') {
      this.options.onPermission('denied');
      logWarn('reminder', '通知权限未授予：提醒不会弹出');
    }
    if (this.stopped) return;
    await this.tickSafely();
    if (this.stopped) return;
    this.timer = this.clock.setInterval(() => {
      void this.tickSafely();
    }, SCAN_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clock.clearInterval(this.timer);
    for (const handle of this.pending.values()) this.clock.clearTimeout(handle);
    this.pending.clear();
    this.bridge.stop();
  }

  /** 供测试驱动：立即执行一轮扫描。 */
  async scanNow(): Promise<void> {
    await this.tickSafely();
  }

  /** 通知权限回读：只报告，不弹系统弹窗；没有原生插件时返回 null。 */
  async refreshPermission(): Promise<NotifyPermission | null> {
    return this.bridge.refreshPermission();
  }

  private async tickSafely(): Promise<void> {
    try {
      await this.tick();
    } catch (cause: unknown) {
      logWarn('reminder', '提醒扫描失败', { message: errorMessage(cause) });
    }
  }

  private suppression(now: number): Suppression {
    const next = pruneSuppression({ mutes: this.mutes, done: this.doneRecords }, now);
    this.mutes = [...next.mutes];
    this.doneRecords = [...next.done];
    return next;
  }

  private pruneRefs(now: number): void {
    const cutoff = now - ACTION_KEEP_MS;
    for (const [key, item] of this.deliveries) {
      if (item.triggerAt < cutoff) this.deliveries.delete(key);
    }
    for (const [key, item] of this.trayPinned) {
      if (item.triggerAt < cutoff) this.trayPinned.delete(key);
    }
    this.snoozes = this.snoozes.filter((item) => item.triggerAt >= cutoff);
  }

  private async syncTray(): Promise<void> {
    if (!isDesktopApp()) return;
    const merged = new Map<string, DeliveryItem>();
    for (const item of this.trayPinned.values()) merged.set(item.key, item);
    for (const item of this.lastScan) if (!merged.has(item.key)) merged.set(item.key, item);
    const items: TrayReminder[] = [...merged.values()]
      .slice(0, TRAY_LIMIT)
      .map((item) => ({ id: item.key, title: item.title, kind: item.kind }));
    const signature = JSON.stringify(items);
    if (signature === this.traySignature) return;
    this.traySignature = signature;
    await this.bridge.syncTray(items);
  }

  private async applySnooze(plan: SnoozePlan, entry: DeliveryItem | undefined): Promise<void> {
    if (entry !== undefined) {
      const next = { ...entry, triggerAt: plan.triggerAt };
      this.deliveries.set(entry.key, next);
      this.trayPinned.set(entry.key, next);
    }
    // Android 的贪睡已由原生广播按同一 id 重排，这里不再 schedule（避免覆盖原生标题），只记下以免对账撤销
    if (isAndroidApp()) this.nativeSnoozes.set(entry?.notificationId ?? hashKey(plan.id), plan.triggerAt);
    if (isDesktopApp()) {
      const snoozed: SnoozedDelivery = {
        key: entry?.key ?? plan.id,
        notificationId: entry?.notificationId ?? hashKey(plan.id),
        kind: plan.kind,
        targetId: plan.targetId,
        title: entry?.title ?? '提醒',
        detail: entry?.detail ?? '',
        triggerAt: plan.triggerAt,
      };
      this.snoozes = [...this.snoozes.filter((item) => item.key !== snoozed.key), snoozed];
      await this.syncTray();
    }
    toast.success(`已贪睡 ${plan.minutes} 分钟`);
    logDebug('reminder', '提醒动作：贪睡', { id: plan.id, nextTriggerAt: plan.triggerAt });
  }

  private async applyMute(plan: MutePlan, source: ReminderActionSource): Promise<void> {
    this.mutes = [
      ...this.mutes.filter((record) => record.targetId !== plan.targetId),
      { targetId: plan.targetId, until: plan.until },
    ];
    for (const item of [...this.deliveries.values()]) {
      if (item.targetId !== plan.targetId || item.triggerAt >= plan.until) continue;
      this.handled.delete(item.key);
      this.deliveries.delete(item.key);
      this.trayPinned.delete(item.key);
      await this.bridge.cancel(item.notificationId);
    }
    this.snoozes = this.snoozes.filter(
      (item) => item.targetId !== plan.targetId || item.triggerAt >= plan.until,
    );
    if (source === 'desktop') await this.bridge.clearTray(plan.id);
    await this.syncTray();
    toast.success(`已勿扰 ${plan.minutes} 分钟`);
    logDebug('reminder', '提醒动作：勿扰', { targetId: plan.targetId, until: plan.until });
  }

  private async applyDone(plan: DonePlan, source: ReminderActionSource): Promise<void> {
    if (plan.write.eventId.length === 0) {
      logWarn('reminder', '提醒动作缺少条目 id，无法写回完成状态', { id: plan.id });
      toast.error('无法定位要完成的条目');
      return;
    }
    try {
      // 复用条目完成逻辑：写 events.done，和日程卡片上的「完成」是同一列
      await updateEvent(this.options.storage, plan.write.eventId, plan.write.fields);
    } catch (cause: unknown) {
      logWarn('reminder', '提醒动作写回完成状态失败', {
        eventId: plan.write.eventId,
        message: errorMessage(cause),
      });
      toast.error('标记完成失败，请到条目里重试');
      return;
    }
    this.doneRecords = [
      ...this.doneRecords.filter((record) => record.targetId !== plan.targetId),
      { targetId: plan.targetId, until: plan.suppressUntil },
    ];
    for (const item of [...this.deliveries.values()]) {
      if (item.targetId !== plan.targetId) continue;
      this.deliveries.delete(item.key);
      this.trayPinned.delete(item.key);
      await this.bridge.cancel(item.notificationId);
    }
    if (source === 'desktop') await this.bridge.clearTray(plan.id);
    await this.syncTray();
    toast.success('已标记完成');
    logDebug('reminder', '提醒动作：完成', { eventId: plan.write.eventId, id: plan.id });
  }

  private async applyAction(payload: ReminderActionPayload, source: ReminderActionSource): Promise<void> {
    try {
      const action = parseReminderAction(payload.action);
      if (action === null) {
        logWarn('reminder', '未知的提醒动作', { action: payload.action });
        return;
      }
      const entry =
        source === 'android'
          ? [...this.deliveries.values()].find((item) => item.notificationId === Number(payload.id))
          : this.deliveries.get(String(payload.id));
      const kind = entry?.kind ?? normalizeReminderKind(payload.kind) ?? 'class';
      const targetId = entry?.targetId ?? payload.targetId ?? '';
      const now = this.clock.now();
      const target: ReminderActionTarget = {
        id: entry?.key ?? String(payload.id),
        kind,
        targetId,
        triggerAt: entry?.triggerAt ?? now,
      };
      const plan = planReminderAction(target, action, now, this.options.timeZone);
      if (plan === null) {
        logWarn('reminder', '提醒动作不适用于当前提醒', { action: payload.action, kind });
        if (source === 'desktop') await this.bridge.clearTray(String(payload.id));
        return;
      }
      if (plan.action === 'snooze') await this.applySnooze(plan, entry);
      else if (plan.action === 'mute') await this.applyMute(plan, source);
      else await this.applyDone(plan, source);
    } catch (cause: unknown) {
      logWarn('reminder', '处理提醒动作失败', {
        action: payload.action,
        message: errorMessage(cause),
      });
      toast.error('处理提醒动作失败，请重试');
    }
  }

  private async deliverOnce(item: DeliveryItem): Promise<void> {
    if (this.stopped || this.handled.has(item.key)) return;
    if (isReminderSuppressed(item, this.suppression(this.clock.now()))) return;
    this.handled.add(item.key);
    this.trayPinned.set(item.key, item);
    try {
      await this.bridge.deliver(item);
    } catch (cause: unknown) {
      logWarn('reminder', '提醒投递失败', { title: item.title, message: errorMessage(cause) });
      return;
    }
    logDebug('reminder', '提醒已触发', { title: item.title, kind: item.kind, triggerAt: item.triggerAt });
    await this.syncTray();
  }

  /**
   * Android：以原生持久化为准对账。只动未到点的排定——已展示的通知与原生贪睡不碰；
   * 扫描结果里没有（删课、改时间、关提醒、被勿扰）或时刻变了的撤销，缺的补排。
   */
  private async reconcileNative(now: number): Promise<void> {
    const native = await this.bridge.pending();
    if (native === null) return;
    for (const [id, until] of this.nativeSnoozes) if (until <= now) this.nativeSnoozes.delete(id);
    const desired = new Map<number, DeliveryItem>();
    for (const item of this.lastScan) if (item.triggerAt > now) desired.set(item.notificationId, item);
    let cancelled = 0;
    let scheduled = 0;
    for (const [id, at] of native) {
      if (at <= now || this.nativeSnoozes.has(id)) continue;
      const want = desired.get(id);
      if (want !== undefined && want.triggerAt === at) continue;
      if (want === undefined) {
        await this.bridge.cancel(id);
        cancelled += 1;
      }
    }
    for (const [id, item] of desired) {
      if (native.get(id) === item.triggerAt || this.nativeSnoozes.has(id)) continue;
      if (await this.bridge.schedule(item)) scheduled += 1;
    }
    if (cancelled > 0 || scheduled > 0) logDebug('reminder', '原生排定对账', { cancelled, scheduled });
  }

  private async tick(): Promise<void> {
    const now = this.clock.now();
    // Android 由原生闹钟按同一 id 投递，补投会让同一条再响一次；其它平台补上两轮扫描之间到点的提醒
    const since = isAndroidApp()
      ? undefined
      : Math.max(this.lastScanAt ?? now - SCAN_INTERVAL_MS, now - CATCH_UP_MS);
    const items = await collect(
      this.options.storage,
      this.options.semesterId,
      this.options.timeZone,
      this.options.defaults,
      since === undefined ? { now } : { now, since },
    );
    if (this.stopped) return;
    this.lastScanAt = now;
    this.options.onUpcoming(items.filter((item) => item.triggerAt >= now).map((item) => item.occurrence));
    const state = this.suppression(now);
    this.lastScan = items.filter((item) => !isReminderSuppressed(item, state));
    this.pruneRefs(now);

    // 贪睡队列到点再投递；Android 由原生闹钟负责，这里只兜底其它平台
    if (!isAndroidApp()) {
      const { due, rest } = takeDue(this.snoozes, now);
      this.snoozes = rest;
      for (const item of due) {
        await notifyNow(item.title, item.detail);
        logDebug('reminder', '贪睡提醒再次投递', { key: item.key, title: item.title });
      }
    }

    // 本轮结果里已不存在（删除、改时间、被抑制）的定时投递要撤掉
    const current = new Set(this.lastScan.map((item) => item.key));
    for (const [key, handle] of this.pending) {
      if (current.has(key)) continue;
      this.clock.clearTimeout(handle);
      this.pending.delete(key);
    }

    for (const item of this.lastScan) {
      this.deliveries.set(item.key, item);
      if (this.handled.has(item.key)) continue;
      if (item.triggerAt <= now) {
        // Android 到点由原生闹钟投递，页面不再重复弹
        if (isAndroidApp()) this.handled.add(item.key);
        else await this.deliverOnce(item);
        continue;
      }
      // Android 的未来提醒统一由下方对账排定（覆盖完整前瞻窗口，应用关闭后也能按时响）
      if (isAndroidApp()) continue;
      if (item.triggerAt - now <= SCAN_INTERVAL_MS && !this.pending.has(item.key)) {
        const handle = this.clock.setTimeout(() => {
          this.pending.delete(item.key);
          void this.deliverOnce(item);
        }, item.triggerAt - now);
        this.pending.set(item.key, handle);
      }
    }

    await this.syncTray();
    if (isAndroidApp()) {
      // 先取回离线期间的动作（贪睡会改原生排定），再对账
      for (const payload of await this.bridge.pollActions()) {
        await this.applyAction(payload, 'android');
      }
      await this.reconcileNative(now);
    }
    logDebug('reminder', '提醒扫描', {
      upcoming: items.length,
      enabled: this.options.defaults.enabled,
      minutes: this.options.defaults.minutes,
      next: items[0] === undefined ? null : { title: items[0].title, triggerAt: items[0].triggerAt },
    });
  }
}
