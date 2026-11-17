// 冒烟用的种子数据、DOM 操作与桩：entry.tsx 只放按顺序执行的检查。
import * as fakeIndexedDb from 'fake-indexeddb';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  addDays,
  createCourse,
  createEvent,
  createSchedule,
  createSemester,
  validatedStorage,
  writeSettings,
} from '@dawn-tick/core';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import {
  canonicalPresetJson,
  sha256HexSync,
  type CachedPresetContent,
  type PresetSnapshot,
} from '../src/preset-update.ts';

// jsdom 不带 IndexedDB，这里把 fake-indexeddb 的全部实现挂到全局（显式引用，避免被 tree-shake）
for (const [key, value] of Object.entries(fakeIndexedDb)) {
  if (key === 'default' || value === undefined) continue;
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

export const USER_ID = 'u1';

export interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeSeed {
  /** 当前周的周一 */
  monday: string;
  /** 造好的过期待办 id：用来验证自动完成不回写数据库 */
  overdueTodoId: string;
  /** 今天：窗口默认从今天开始，断言大量用到 */
  today: string;
  /** 多天假期的第一天与第二天：都落在默认窗口里 */
  holidayStart: string;
  holidaySecond: string;
}

/** 造一份固定数据；返回当前周的周一日期，供后续断言推算有课的日期。 */
export async function seed(): Promise<SmokeSeed> {
  const storage = validatedStorage(await openIndexedDbStorage());
  const now = new Date();
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
  const todayText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  /** 今天对应的周几（1=周一）：窗口从今天开始，放假列就是这一列 */
  const nowDayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '2026-2027 第一学期',
    startDate: '2026-09-07',
    totalWeeks: 20,
    timeZone: 'Asia/Shanghai',
  });
  const course = await createCourse(storage, {
    semesterId: String(semester['id']),
    name: '高等数学',
    shortName: '高数',
    teacher: '张老师',
    location: '教三-201',
  });
  await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: Array.from({ length: 20 }, (_, index) => index + 1),
  });
  // 只在第 1-2 周上的课，用来验证非本周课程的虚线显示
  const earlyCourse = await createCourse(storage, {    semesterId: String(semester['id']),
    name: '大学物理',
    shortName: '大物',
    teacher: '李老师',
    location: '理科楼-105',
  });
  await createSchedule(storage, {
    courseId: String(earlyCourse['id']),
    dayOfWeek: 3,
    periodStart: 3,
    periodEnd: 4,
    weeks: [1, 2],
  });
  // 周二、周四都上的课：用来验证假期第二天（周二）与日程时间线的时间区间
  const linearCourse = await createCourse(storage, {
    semesterId: String(semester['id']),
    name: '线性代数',
    shortName: '线代',
  });
  await createSchedule(storage, {
    courseId: String(linearCourse['id']),
    dayOfWeek: 2,
    periodStart: 5,
    periodEnd: 6,
    weeks: Array.from({ length: 20 }, (_, index) => index + 1),
  });
  await createSchedule(storage, {
    courseId: String(linearCourse['id']),
    dayOfWeek: 4,
    periodStart: 7,
    periodEnd: 8,
    weeks: Array.from({ length: 20 }, (_, index) => index + 1),
  });
  // 只在第 1-2 周上的周一课：当天放假又非本周，用来验证放假优先于非本周
  const probabilityCourse = await createCourse(storage, {
    semesterId: String(semester['id']),
    name: '概率论',
    shortName: '概率',
  });
  await createSchedule(storage, {
    courseId: String(probabilityCourse['id']),
    dayOfWeek: nowDayOfWeek,
    periodStart: 5,
    periodEnd: 6,
    weeks: [1, 2],
  });
  // 周视图铺满 7 天，才能验证「高亮当天列」
  await writeSettings(storage, { viewDays: 7 });
  // 今天与明天放假：窗口默认从今天开始，必落在窗口里；前一天设为工作日
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
  const mondayText = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  const holidayStartText = todayText;
  const holidaySecondText = addDays(todayText, 1);
  // 实验条目：覆盖「改实验 → 保存 → 写回」这条链路（曾经静默失败、没有日志）
  // 排在第 7-8 节：周一第 3 节要留空给空白格拖动用例（今天正好是周一时也不冲突）
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'lab',
    title: '物理实验',
    onDate: todayText,
    periodStart: 7,
    periodEnd: 8,
    nature: 'lab',
    showInTimetable: true,
  });
  // 打开「显示在课表上」的日程：应当和实验一样占课表格子
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'todo',
    title: '组会',
    onDate: todayText,
    startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0).getTime(),
    showInTimetable: true,
    countdown: true,
    subject: String(probabilityCourse['id']),
  });
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'holiday',
    title: '国庆节',
    onDate: holidayStartText,
  });
  // 把假期前一天设为工作日：保证今天是这段假期的第一天（不受内置节假日表影响）
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'workday',
    title: '非假日',
    onDate: addDays(holidayStartText, -1),
  });
  // 明天也放假：形成一段两天假期，用来验证第二天起只显示「放假」
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'holiday',
    title: '国庆节',
    onDate: holidaySecondText,
  });
  // 每个星期几都上的晚课（第 9-10 节，20:40 结束）：日程时间线里「过期的课自动完成」用它，
  // 白天所有空格的交互断言都不受影响（那些都落在第 1-3 节）
  const pastCourse = await createCourse(storage, {
    semesterId: String(semester['id']),
    name: '往期课',
    shortName: '往期',
    location: '实验楼-501',
  });
  for (let day = 1; day <= 7; day += 1) {
    await createSchedule(storage, {
      courseId: String(pastCourse['id']),
      dayOfWeek: day,
      periodStart: 9,
      periodEnd: 10,
      weeks: Array.from({ length: 20 }, (_, index) => index + 1),
    });
  }
  // 时间线用的三条日程：带截止时间且已过期的待办、没有时间的待办、没有开考时间的考试
  const overdue = await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'todo',
    title: '过期待办',
    onDate: addDays(mondayText, 8),
    dueAt: Date.now() - 3_600_000,
  });
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'todo',
    title: '无时间待办',
    onDate: addDays(mondayText, -1),
  });
  // 窗口内的那一天：③ 段要看「日程」性质的待办
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'todo',
    title: '窗口内待办',
    onDate: addDays(mondayText, 7),
  });
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'exam',
    title: '期末模拟考',
    onDate: addDays(mondayText, 7),
  });
  return {
    monday: mondayText,
    overdueTodoId: String(overdue['id']),
    today: todayText,
    holidayStart: holidayStartText,
    holidaySecond: holidaySecondText,
  };
}

// 冒烟从「设备页默认只展开第一张」开始：清掉旧折叠记忆与手风琴记忆，避免影响断言
globalThis.localStorage?.setItem('dt.settings.collapsed', '[]');
// 设备页的卡片手风琴从默认展开第一张开始；记忆行为由后面的重进页面用例单独验证
globalThis.localStorage?.removeItem('dt.cards.expanded');

/** 切换 jsdom 的通知权限桩（实现在 tools/verify/smoke-ui.mjs 的 setupDom 里）。 */
export function setNotifyPermission(value: NotificationPermission): void {
  (globalThis as { __notifyPermission?: NotificationPermission }).__notifyPermission = value;
}

export function mount(element: ReactElement): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  root.render(element);
  return { root, container };
}

export async function flush(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** 轮询等待异步渲染结果：重复预检要读存储，固定 flush 轮数不够稳。 */
export async function waitFor(predicate: () => boolean, rounds = 40): Promise<boolean> {
  for (let index = 0; index < rounds; index += 1) {
    if (predicate()) return true;
    await flush(1);
  }
  return predicate();
}

export function clickByText(container: HTMLElement, label: string): boolean {
  const button = [...container.querySelectorAll('button')].find(
    (item) => (item.textContent ?? '').trim() === label,
  );
  if (button === undefined) return false;
  button.click();
  return true;
}

/** 卡片式按钮的文字后面还有说明，用前缀匹配。 */
export function clickByTextStart(container: HTMLElement, prefix: string): boolean {
  const button = [...container.querySelectorAll('button')].find((item) =>
    (item.textContent ?? '').trim().startsWith(prefix),
  );
  if (button === undefined) return false;
  button.click();
  return true;
}

export function clickByLabel(container: HTMLElement, prefix: string): boolean {
  const button = container.querySelector(`button[aria-label^="${prefix}"]`);
  if (!(button instanceof HTMLElement)) return false;
  button.click();
  return true;
}

/** 设置页分组清单容器（无障碍名称固定为「设置分组」）。 */
export function settingsNav(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('nav[aria-label="设置分组"]');
}

/** 导入预览等分组内容里的「返回」：分组导航自己的「返回列表」按钮带 aria-label，要避开。 */
export function clickContentBack(container: HTMLElement): boolean {
  const button = [...container.querySelectorAll('button')].find(
    (item) =>
      (item.textContent ?? '').trim() === '返回' && (item.getAttribute('aria-label') ?? '') === '',
  );
  if (button === undefined) return false;
  button.click();
  return true;
}

/** 分组清单里的全部入口。 */
export function settingsNavItems(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-role="settings-nav-item"]')];
}

/** 按标题找分组入口：清单行同时带标题与摘要，用包含匹配足够稳。 */
export function settingsNavItem(container: HTMLElement, title: string): HTMLElement | null {
  return (
    settingsNavItems(container).find((item) => (item.textContent ?? '').includes(title)) ?? null
  );
}

/** 分组内容区：与分组清单同级、排在 nav 后面的 section。 */
export function settingsPanel(container: HTMLElement): HTMLElement | null {
  return settingsNav(container)?.parentElement?.querySelector('section') ?? null;
}

/** 移动端清单态：清单可见、内容区隐藏（桌面由 desktop: 前缀覆盖为两栏）。 */
export function settingsNavIsListOnly(container: HTMLElement): boolean {
  const nav = settingsNav(container);
  const panel = settingsPanel(container);
  return (
    nav !== null &&
    !nav.classList.contains('hidden') &&
    panel !== null &&
    panel.classList.contains('hidden') &&
    panel.classList.contains('desktop:block')
  );
}

/** 移动端子页态：清单隐藏、内容区可见。 */
export function settingsSubpageOpen(container: HTMLElement): boolean {
  const nav = settingsNav(container);
  const panel = settingsPanel(container);
  return (
    nav !== null &&
    nav.classList.contains('hidden') &&
    panel !== null &&
    !panel.classList.contains('hidden')
  );
}

/**
 * 设置页是「分组导航 + 下钻」：点分组清单里的目标组，右侧/子页只挂载这一组内容。
 * 等清单渲染出来再点，避免与异步数据竞态；同一组再点时直接成功。
 */
export async function openSettingsGroup(container: HTMLElement, title: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const item = settingsNavItem(container, title);
    if (item !== null) {
      item.click();
      await flush(12);
      return true;
    }
    await flush(1);
  }
  return false;
}

/** 点顶部的「周 / 日」页签：Radix Tabs 在 mousedown 时切页，光 click 不生效。 */
export function clickTab(container: HTMLElement, label: string): boolean {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (item) => (item.textContent ?? '').trim() === label,
  );
  if (tab === undefined) return false;
  tab.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  tab.click();
  return true;
}

export function hasLabel(container: HTMLElement, prefix: string): boolean {
  return container.querySelector(`button[aria-label^="${prefix}"]`) !== null;
}

/** 打开顶部「＋」或「⋯」下拉后，点其中的菜单项 */
export function clickMenu(container: HTMLElement, menu: string, label: string): boolean {
  const trigger = container.querySelector(`summary[aria-label="${menu}"]`);
  if (trigger instanceof HTMLElement) trigger.click();
  const item = [...container.querySelectorAll(`[role="menu"][aria-label="${menu}"] [role="menuitem"]`)].find(
    (entry) => (entry.textContent ?? '').trim() === label,
  );
  if (!(item instanceof HTMLElement)) return false;
  item.click();
  return true;
}

export function setInputValue(element: HTMLElement, value: string): void {
  const prototype =
    element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/**
 * 让输入框失焦：真实浏览器失焦会先派发不冒泡的 blur，再派发冒泡的 focusout；
 * React 的 onBlur 挂在 focusout 上，所以两个都派发，保持与浏览器一致的事件序列。
 */
export function blurInput(element: HTMLElement): void {
  element.dispatchEvent(new window.FocusEvent('blur'));
  element.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
}

/** 在输入框里按回车。 */
export function pressEnter(element: HTMLElement): void {
  element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

export function pointerEvent(type: string, init: Record<string, unknown>): Event {
  const EventCtor = window.PointerEvent ?? window.MouseEvent;
  return new EventCtor(type, { bubbles: true, cancelable: true, ...init } as never);
}

/** 点击某天列某一节上的一行（该节空着时才有效，period 从 1 开始）。 */
export function clickGridCell(container: HTMLElement, day: number, period = 1): boolean {
  const column = container.querySelector(`[data-day="${day}"]`);
  if (!(column instanceof window.HTMLElement)) return false;
  stubRect(column, day * 100, 100);
  const row = [...column.querySelectorAll('div')][period - 1];
  const target = row instanceof window.HTMLElement ? row : column;
  const clientY = 100 + (period - 1) * 56 + 4;
  // 真实鼠标点击前一定先有 pointerdown，周视图的落点判断依赖它
  target.dispatchEvent(pointerEvent('pointerdown', { pointerId: 41, button: 0, clientX: 150, clientY }));
  target.dispatchEvent(pointerEvent('pointerup', { pointerId: 41, clientX: 150, clientY }));
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientY }));
  return true;
}

/** 占位块滚轮条上的节次范围文案。 */
export function slotRange(container: HTMLElement): string {
  return (container.querySelector('[data-role="period-wheel"]')?.textContent ?? '').trim();
}

/** 课程表单里某个下拉框当前显示的值。 */
export function triggerText(label: string): string {
  return (document.querySelector(`[aria-label="${label}"]`)?.textContent ?? '').trim();
}

/** 按住占位块本体拖动：dy 为相对按下的像素位移（56 一格）。 */
export function dragEmptySlot(
  slot: HTMLElement,
  startY = 400,
): {
  down: () => void;
  move: (dy: number) => void;
  up: (dy: number) => void;
} {
  const fire = (type: string, dy: number): void => {
    slot.dispatchEvent(
      pointerEvent(type, { pointerId: 31, button: 0, clientX: 150, clientY: startY + dy }),
    );
  };
  return {
    down: () => fire('pointerdown', 0),
    move: (dy: number) => fire('pointermove', dy),
    up: (dy: number) => fire('pointerup', dy),
  };
}

/**
 * jsdom 没有布局（getBoundingClientRect 全是 0），周视图的落点定位依赖它，
 * 所以只在这几个节点上按 100 宽、56 高的规则行造一份几何。
 */
export function stubRect(element: Element, left: number, top: number, width = 100, height = 56): void {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as unknown as DOMRect;
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => rect,
    configurable: true,
    writable: true,
  });
}

/** 在课程卡上按下指针并按住超过长按时长，再发窗口指针事件、移动与抬手。 */
export async function dragLesson(
  container: HTMLElement,
  name: string,
  moveTo?: { day: number; clientY?: number },
): Promise<boolean> {
  const card = [...container.querySelectorAll('[data-tone]')].find((item) =>
    (item.textContent ?? '').includes(name),
  );
  const holder = card?.parentElement;
  if (!(card instanceof window.HTMLElement) || !(holder instanceof window.HTMLElement)) return false;
  stubRect(holder, 100, 100);
  holder.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 150, clientY: 104 }));
  window.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, button: 0 }));
  holder.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 152, clientY: 106 }));
  await new Promise((resolve) => setTimeout(resolve, 420));
  await flush(4);
  if (moveTo !== undefined) {
    const column = container.querySelector(`[data-day="${moveTo.day}"]`);
    if (column instanceof window.HTMLElement) stubRect(column, moveTo.day * 100, 100);
    holder.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 1,
        clientX: moveTo.day * 100 + 50,
        clientY: moveTo.clientY ?? 104,
      }),
    );
  }
  await flush(2);
  holder.dispatchEvent(
    pointerEvent('pointerup', {
      pointerId: 1,
      clientX: moveTo === undefined ? 152 : moveTo.day * 100 + 50,
      clientY: moveTo?.clientY ?? 106,
    }),
  );
  await flush(4);
  window.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1 }));
  return true;
}

/**
 * 直接拖动课程卡：按下后立刻越过抖动阈值再拖到目标列，不先按住等长按。
 * 回归 I-10：新建/普通课程卡只认「按住不动」时，快速拖动会被当成滑动而取消。
 */
export async function quickDragLesson(
  container: HTMLElement,
  name: string,
  moveTo: { day: number; clientY?: number },
): Promise<boolean> {
  const found = findLessonCard(container, name);
  if (found === null) return false;
  stubRect(found.holder, 100, 100);
  found.holder.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, button: 0, clientX: 150, clientY: 104 }));
  // 先原地越过阈值：鼠标/触控笔应当直接进入拖动，而不是等满长按时长
  found.holder.dispatchEvent(pointerEvent('pointermove', { pointerId: 5, clientX: 152, clientY: 130 }));
  await flush(2);
  const column = container.querySelector(`[data-day="${moveTo.day}"]`);
  if (column instanceof window.HTMLElement) stubRect(column, moveTo.day * 100, 100);
  found.holder.dispatchEvent(
    pointerEvent('pointermove', { pointerId: 5, clientX: moveTo.day * 100 + 50, clientY: moveTo.clientY ?? 130 }),
  );
  await flush(2);
  found.holder.dispatchEvent(
    pointerEvent('pointerup', {
      pointerId: 5,
      clientX: moveTo.day * 100 + 50,
      clientY: moveTo.clientY ?? 130,
    }),
  );
  await flush(6);
  window.dispatchEvent(pointerEvent('pointercancel', { pointerId: 5 }));
  return true;
}

/** 找到课程卡（CourseCard 渲染的按钮）与承接指针事件的外层容器。 */
export function findLessonCard(container: HTMLElement, name: string): { card: HTMLElement; holder: HTMLElement } | null {
  const card = [...container.querySelectorAll('[data-tone]')].find((item) =>
    (item.textContent ?? '').includes(name),
  );
  const holder = card?.parentElement;
  if (!(card instanceof window.HTMLElement) || !(holder instanceof window.HTMLElement)) return null;
  return { card, holder };
}

/** 只补发一次 click（不再按下指针）：用来验证拖动收尾那次 click 是否被抑制。 */
export function clickLessonCard(container: HTMLElement, name: string): boolean {
  const found = findLessonCard(container, name);
  if (found === null) return false;
  found.card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}

/**
 * 普通单击课程卡：pointerdown → pointerup → click。
 * 两帧之间只有 40ms，远小于长按阈值 350ms，因此不会进入拖动。
 * React 18 只在根容器上监听，click 必须打在卡片自身上才会命中它的 onClick。
 */
export async function tapLessonCard(container: HTMLElement, name: string): Promise<boolean> {
  const found = findLessonCard(container, name);
  if (found === null) return false;
  stubRect(found.holder, 100, 100);
  found.holder.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, button: 0, clientX: 150, clientY: 104 }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  found.holder.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 150, clientY: 104 }));
  await flush(2);
  found.card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await flush(10);
  return true;
}

export const PAGE_SAMPLE = `<table id="kbtable"><tr>
  <td id="1-1"><div><span class="title">网页导入课程</span><p>张老师</p><p>教三-401</p><p>1-16周</p></div></td>
  <td id="2-1"><div><span class="title">网页导入课程二</span><p>李老师</p><p>理科楼-201</p><p>2-16周(双)</p></div></td>
</tr></table>`;

export const PAGE_WEEKDAY_SAMPLE = `<table><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td></tr>
  <tr><td>第1节</td><td>手动映射课程<br>1-16周</td><td></td><td></td></tr>
  <tr><td>第2节</td><td></td><td>手动映射课程二<br>2-16周</td><td></td></tr>
</table>`;

/**
 * P2-16：前两条与 `PAGE_SAMPLE` 完全一致（同一批数据导入后就成为冲突项），
 * 第三条是新课，用来验证「只看冲突项」筛选只藏非冲突行。
 */
export const PAGE_MIXED_DUPLICATE_SAMPLE = `<table id="kbtable"><tr>
  <td id="1-1"><div><span class="title">网页导入课程</span><p>张老师</p><p>教三-401</p><p>1-16周</p></div></td>
  <td id="2-1"><div><span class="title">网页导入课程二</span><p>李老师</p><p>理科楼-201</p><p>2-16周(双)</p></div></td>
  <td id="5-3"><div><span class="title">无冲突新增课程</span><p>王老师</p><p>教二-101</p><p>5-8周</p></div></td>
</tr></table>`;

/** P2-16：全新课程，用来验证「没有冲突项」的空筛选提示。 */
export const PAGE_NO_DUPLICATE_SAMPLE = `<table id="kbtable"><tr>
  <td id="4-5"><div><span class="title">零冲突课程</span><p>赵老师</p><p>教一-102</p><p>3-6周</p></div></td>
</tr></table>`;

/** 预设更新冒烟用的假 Response：全程不联网。 */
export function presetJsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/**
 * 缓存快照 1.1.0 自带的作息正文：内容是「内置 default 的另一种作息」。
 * 用同一份数据测两件事——下载时能通过正文校验、启动时能真的覆盖掉内置预设。
 */
export const CACHE_TIMETABLE_ID = 'default';
export const CACHE_TIMETABLE_NAME = '缓存作息（测试）';
export const CACHE_PERIODS = [
  { periodNo: 1, start: '08:30', end: '09:15' },
  { periodNo: 2, start: '09:25', end: '10:10' },
  { periodNo: 3, start: '10:25', end: '11:10' },
  { periodNo: 4, start: '11:20', end: '12:05' },
  { periodNo: 5, start: '13:30', end: '14:15' },
  { periodNo: 6, start: '14:25', end: '15:10' },
  { periodNo: 7, start: '15:20', end: '16:05' },
  { periodNo: 8, start: '16:15', end: '17:00' },
  { periodNo: 9, start: '18:30', end: '19:15' },
  { periodNo: 10, start: '19:25', end: '20:10' },
];

/** 缓存正文（`presets_content_v1` 的形状）：与内置同名 id，但正文不同，足以证明「换掉了」。 */
export function fakePresetContent(version: string): CachedPresetContent {
  return {
    version,
    timetables: [
      { id: CACHE_TIMETABLE_ID, name: CACHE_TIMETABLE_NAME, periods: CACHE_PERIODS },
      { id: 'usts', name: '苏州科技大学', periods: [{ periodNo: 1, start: '08:00', end: '08:45' }] },
    ],
    systems: [
      {
        id: 'jwglxt',
        name: '正方教务（缓存）',
        entryPath: '/jwglxt/xtgl/login_slogin.html',
        hint: '缓存正文',
        detect: { markers: ['jwglxt'], timetableTableIds: [], timetableTableClasses: [], gridCellIdPatterns: [] },
      },
    ],
  };
}

/**
 * 造一份哈希自洽的快照（hash 用模块自身的规范化口径算，等价于预设仓库的生成器）。
 * `sources` 里的每一条同时带正文：`id`/`path`/`sha256` 进清单哈希，多出来的正文字段
 * **不参与**哈希（清单描述的是预设仓库里的文件），因此这里加正文不会改变签名口径。
 * 路径照合并后的结构写：作息表是历史契约符号路径（`timetable.json` 已并入 school.json），
 * 教务系统是 `systems/<id>/system.json`。
 *
 * 顶层还带 **内嵌索引 `index`**（原 `presets/index.json` 的信息已并入快照）：它**参与**哈希，
 * 所以这里的 hash 是「含索引」的新版哈希，与真实产物同口径。
 */
export function fakePresetSnapshot(version: string): PresetSnapshot {
  const content = fakePresetContent(version);
  const unsigned = {
    version,
    schemaVersion: 1,
    generatedAt: '2026-02-01T00:00:00.000Z',
    sources: {
      timetables: content.timetables.map((preset) => ({
        path: `presets/schools/${preset.id}/timetable.json`,
        sha256: `sha256:${sha256HexSync(canonicalPresetJson(preset))}`,
        ...preset,
      })),
      systems: content.systems.map((system) => ({
        path: `presets/systems/${system.id}/system.json`,
        sha256: `sha256:${sha256HexSync(canonicalPresetJson(system))}`,
        ...system,
      })),
      adapters: {},
    },
    index: {
      _generated: true,
      version,
      schemaVersion: 1,
      generatedAt: '2026-02-01T00:00:00.000Z',
      // 合并后学校只有一个 school.json：configPath 与 timetablePath 都指它
      schools: content.timetables.map((preset) => ({
        id: preset.id,
        name: preset.name,
        system: null,
        configPath: `presets/schools/${preset.id}/school.json`,
        timetablePath: `presets/schools/${preset.id}/school.json`,
      })),
      systems: content.systems.map((system) => ({
        id: system.id,
        name: system.name,
        metaPath: `presets/systems/${system.id}/system.json`,
        loginPath: `presets/systems/${system.id}/system.json`,
        // 索引里的 detect 四个子键必须齐全（空数组是合法值）
        detect: {
          markers: system.detect.markers ?? [],
          timetableTableIds: system.detect.timetableTableIds ?? [],
          timetableTableClasses: system.detect.timetableTableClasses ?? [],
          gridCellIdPatterns: system.detect.gridCellIdPatterns ?? [],
        },
        entryPath: system.entryPath,
        hint: system.hint,
      })),
    },
  };
  return { ...unsigned, hash: `sha256:${sha256HexSync(canonicalPresetJson(unsigned))}` } as unknown as PresetSnapshot;
}

/**
 * jsdom 没有 Canvas 2D：给课表图片导出装一个最小上下文桩。
 * 它只负责让绘制调用不报错，并按画布尺寸返回全零像素，PNG 编码仍走真实实现。
 */
export function installCanvas2dStub(): () => void {
  const prototype = window.HTMLCanvasElement.prototype;
  const original = prototype.getContext;
  Object.defineProperty(prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: function (this: HTMLCanvasElement, type: string): unknown {
      if (type !== '2d') return null;
      const canvas = this;
      const state: Record<string, unknown> = {};
      const gradient = { addColorStop: () => {} };
      return new Proxy(state, {
        get(target, property) {
          if (property === 'canvas') return canvas;
          if (property === 'measureText') return (value: string) => ({ width: String(value).length * 8 });
          if (property === 'getImageData') {
            return (_x: number, _y: number, width: number, height: number) => ({
              data: new Uint8ClampedArray(width * height * 4),
              width,
              height,
            });
          }
          if (property === 'createLinearGradient') return () => gradient;
          if (property in target) return (target as unknown as Record<string | symbol, unknown>)[property];
          return () => {};
        },
        set(target, property, value) {
          target[property as string] = value;
          return true;
        },
      });
    },
  });
  return () => {
    Object.defineProperty(prototype, 'getContext', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}
