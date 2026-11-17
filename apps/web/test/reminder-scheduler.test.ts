import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCourse,
  createSchedule,
  createSemester,
  dayOfWeek,
  validatedStorage,
  weekStart,
  type Storage,
} from '@dawn-tick/core';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import type { DeliveryItem } from '../src/reminder-collect.ts';
import { installCapacitorPlatform } from './kit/platform.ts';
import { ReminderScheduler, type ReminderBridgeLike, type SchedulerClock } from '../src/reminder-scheduler.ts';

const TIME_ZONE = 'Asia/Shanghai';
/** 2026-10-13 周二；第 1 节 08:00 开始，全局课前 15 分钟 ⇒ 07:45 到点。 */
const DAY = '2026-10-13';
const at = (hh: number, mm: number, ss = 0): number => Date.UTC(2026, 9, 13, hh - 8, mm, ss);
const TRIGGER = at(7, 45);

/** 手动推进的时钟：advanceTo 时按到点顺序执行定时回调。 */
class ManualClock implements SchedulerClock {
  current: number;
  private timers = new Map<number, { due: number; callback: () => void }>();
  private seq = 0;

  constructor(start: number) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    this.seq += 1;
    this.timers.set(this.seq, { due: this.current + ms, callback });
    return this.seq;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  // 扫描间隔由用例手动调用 scanNow 驱动
  setInterval(): unknown {
    return 0;
  }

  clearInterval(): void {}

  async advanceTo(target: number): Promise<void> {
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (next === undefined) break;
      this.timers.delete(next[0]);
      this.current = next[1].due;
      next[1].callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.current = target;
  }

  pendingCount(): number {
    return this.timers.size;
  }
}

interface NativeLog {
  scheduled: DeliveryItem[];
  cancelled: number[];
}

function stubBridge(
  delivered: DeliveryItem[],
  native: Map<number, number> | null = null,
  log: NativeLog = { scheduled: [], cancelled: [] },
): ReminderBridgeLike {
  return {
    connect: async () => null,
    stop: () => {},
    refreshPermission: async () => null,
    schedule: async (item) => {
      log.scheduled.push(item);
      native?.set(item.notificationId, item.triggerAt);
      return native !== null;
    },
    deliver: async (item) => {
      delivered.push(item as DeliveryItem);
    },
    cancel: async (id) => {
      log.cancelled.push(id);
      native?.delete(id);
    },
    pending: async () => (native === null ? null : new Map(native)),
    pollActions: async () => [],
    syncTray: async () => {},
    clearTray: async () => {},
  };
}

let dbSeq = 0;
async function seed(): Promise<{ storage: Storage; semesterId: string }> {
  dbSeq += 1;
  const storage = validatedStorage(await openIndexedDbStorage(`scheduler-${dbSeq}`));
  const semester = await createSemester(storage, {
    userId: 'u1',
    name: '测试学期',
    startDate: weekStart(DAY),
    totalWeeks: 20,
    timeZone: TIME_ZONE,
  });
  const course = await createCourse(storage, { semesterId: String(semester['id']), name: '高等数学' });
  await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: dayOfWeek(DAY),
    periodStart: 1,
    periodEnd: 2,
    weeks: Array.from({ length: 20 }, (_, index) => index + 1),
  });
  return { storage, semesterId: String(semester['id']) };
}

async function scheduler(start: number, native: Map<number, number> | null = null) {
  const { storage, semesterId } = await seed();
  const clock = new ManualClock(start);
  const delivered: DeliveryItem[] = [];
  const log: NativeLog = { scheduled: [], cancelled: [] };
  const upcoming: number[] = [];
  const instance = new ReminderScheduler({
    storage,
    semesterId,
    timeZone: TIME_ZONE,
    defaults: { enabled: true, minutes: 15 },
    onUpcoming: (items) => upcoming.splice(0, upcoming.length, ...items.map((item) => item.triggerAt)),
    onPermission: () => {},
    clock,
    bridge: stubBridge(delivered, native, log),
  });
  return { instance, clock, delivered, upcoming, log };
}

test('A1 到点前一个扫描间隔内设精确定时，到点即投递一次', async () => {
  const { instance, clock, delivered } = await scheduler(at(7, 40));
  await instance.scanNow();
  assert.equal(delivered.length, 0);
  assert.equal(clock.pendingCount(), 0, '离到点还远，不提前定时');

  await clock.advanceTo(at(7, 44, 50));
  await instance.scanNow();
  assert.equal(clock.pendingCount(), 1, '下个扫描间隔内到点：设定时');

  await clock.advanceTo(TRIGGER);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.triggerAt, TRIGGER);

  await clock.advanceTo(at(7, 45, 20));
  await instance.scanNow();
  assert.equal(delivered.length, 1, '同一条不重复投递');
  instance.stop();
});

test('A1 两次扫描之间到点（定时器未触发）由下一轮补投', async () => {
  const { instance, clock, delivered } = await scheduler(at(7, 44, 0));
  await instance.scanNow();
  // 模拟定时器被系统挂起：直接跳过它
  clock.clearTimeout(1);
  clock.current = at(7, 45, 25);
  await instance.scanNow();
  assert.equal(delivered.length, 1);
  instance.stop();
});

test('A1 睡眠唤醒超过补投上限的旧提醒不再弹出', async () => {
  const { instance, clock, delivered } = await scheduler(at(7, 30));
  await instance.scanNow();
  clock.current = at(7, 52);
  await instance.scanNow();
  assert.equal(delivered.length, 0);
  instance.stop();
});

test('A1 首次启动只补最近一个扫描间隔，不弹早已过点的提醒', async () => {
  const late = await scheduler(at(7, 50));
  await late.instance.scanNow();
  assert.equal(late.delivered.length, 0);
  late.instance.stop();

  const justMissed = await scheduler(at(7, 45, 10));
  await justMissed.instance.scanNow();
  assert.equal(justMissed.delivered.length, 1);
  justMissed.instance.stop();
});

test('A1 待提醒列表只给未到点的', async () => {
  const { instance, clock, upcoming } = await scheduler(at(7, 45, 10));
  await instance.scanNow();
  assert.ok(upcoming.every((triggerAt) => triggerAt >= clock.now()));
  instance.stop();
});

test('A1 停止后撤掉未触发的定时投递', async () => {
  const { instance, clock, delivered } = await scheduler(at(7, 44, 50));
  await instance.scanNow();
  assert.equal(clock.pendingCount(), 1);
  instance.stop();
  assert.equal(clock.pendingCount(), 0);
  await clock.advanceTo(TRIGGER);
  assert.equal(delivered.length, 0);
});

test('A2 Android 一次排定完整前瞻窗口，不再只排 1 小时内', async (t) => {
  t.after(installCapacitorPlatform());
  const native = new Map<number, number>();
  const { instance, log, delivered } = await scheduler(at(6, 0), native);
  await instance.scanNow();
  assert.ok(log.scheduled.some((item) => item.triggerAt === TRIGGER), '1 小时 45 分钟后的提醒也已交给原生');
  assert.equal(delivered.length, 0, 'Android 不由页面投递');
  const before = log.scheduled.length;
  await instance.scanNow();
  assert.equal(log.scheduled.length, before, '原生已有且时刻相同的不重复排');
  instance.stop();
});

test('A2 Android 对账：撤销扫描结果里已不存在的未来排定，不碰已到点与贪睡', async (t) => {
  t.after(installCapacitorPlatform());
  const stale = 4242;
  const shown = 4343;
  const native = new Map<number, number>([
    [stale, at(9, 0)],
    [shown, at(5, 0)],
  ]);
  const { instance, log } = await scheduler(at(6, 0), native);
  await instance.scanNow();
  assert.deepEqual(log.cancelled, [stale]);
  assert.ok(native.has(shown), '已展示的记录保留给动作回传');
  instance.stop();
});

test('A2 Android 对账：同一通知 id 的时刻变了就按新时刻重排', async (t) => {
  t.after(installCapacitorPlatform());
  const native = new Map<number, number>();
  const { instance, log } = await scheduler(at(6, 0), native);
  await instance.scanNow();
  const item = log.scheduled.find((entry) => entry.triggerAt === TRIGGER);
  assert.ok(item !== undefined);

  // 原生里留着旧时刻（例如改提前量前排的）：下一轮对账覆盖为扫描结果的时刻
  native.set(item.notificationId, TRIGGER - 5 * 60 * 1000);
  await instance.scanNow();
  assert.equal(native.get(item.notificationId), TRIGGER);
  instance.stop();
});
