import * as fakeIndexedDb from 'fake-indexeddb';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  activeSemester,
  addDays,
  BUILTIN_PRESET_VERSION,
  BUILTIN_TIMETABLES,
  builtinHolidays,
  createCourse,
  createEvent,
  createSchedule,
  createSemester,
  DEFAULT_TIMETABLE_ID,
  effectivePresetVersion,
  findTimetable,
  fromBase64Utf8,
  setPresetOverride,
  validatedStorage,
  writeSettings,
} from '@dawn-tick/core';
import { App } from '../src/App.tsx';
import { formatLogTimestamp } from '../src/log.ts';
import { MiniShell } from '../src/mini/shell.tsx';
import { shouldShowTomorrow, tomorrowPreviewLessons } from '../src/mini/tomorrow.ts';
import { MOBILE_WIDGETS, WIDGET_PIN_STEPS, hasMobileWidgets, pinWidget } from '../src/widget-pin.ts';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import {
  PRESET_CONTENT_META_KEY,
  PRESET_SNAPSHOT_META_KEY,
  PRESET_SNAPSHOT_URL,
  PRESET_VERSION_URL,
  canonicalPresetJson,
  presetIndexFromSnapshot,
  sha256HexSync,
  writeCachedPresetContent,
  type CachedPresetContent,
  type PresetSnapshot,
} from '../src/preset-update.ts';

// jsdom 不带 IndexedDB，这里把 fake-indexeddb 的全部实现挂到全局（显式引用，避免被 tree-shake）
for (const [key, value] of Object.entries(fakeIndexedDb)) {
  if (key === 'default' || value === undefined) continue;
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

const USER_ID = 'u1';

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
async function seed(): Promise<SmokeSeed> {
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
  // 窗口内的那一天：③ 段要看「其他」性质的待办
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

// 冒烟固定把所有设置卡片视为展开，避免折叠记忆影响断言
globalThis.localStorage?.setItem('dt.settings.collapsed', '[]');
function mount(element: ReactElement): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  root.render(element);
  return { root, container };
}

async function flush(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function clickByText(container: HTMLElement, label: string): boolean {
  const button = [...container.querySelectorAll('button')].find(
    (item) => (item.textContent ?? '').trim() === label,
  );
  if (button === undefined) return false;
  button.click();
  return true;
}

/** 卡片式按钮的文字后面还有说明，用前缀匹配。 */
function clickByTextStart(container: HTMLElement, prefix: string): boolean {
  const button = [...container.querySelectorAll('button')].find((item) =>
    (item.textContent ?? '').trim().startsWith(prefix),
  );
  if (button === undefined) return false;
  button.click();
  return true;
}

function clickByLabel(container: HTMLElement, prefix: string): boolean {
  const button = container.querySelector(`button[aria-label^="${prefix}"]`);
  if (!(button instanceof HTMLElement)) return false;
  button.click();
  return true;
}

/** 点顶部的「周 / 日」页签：Radix Tabs 在 mousedown 时切页，光 click 不生效。 */
function clickTab(container: HTMLElement, label: string): boolean {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (item) => (item.textContent ?? '').trim() === label,
  );
  if (tab === undefined) return false;
  tab.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  tab.click();
  return true;
}

function hasLabel(container: HTMLElement, prefix: string): boolean {
  return container.querySelector(`button[aria-label^="${prefix}"]`) !== null;
}

function clickByAriaPrefix(container: HTMLElement, prefix: string): boolean {
  const element = container.querySelector(`button[aria-label^="${prefix}"]`);
  if (!(element instanceof HTMLElement)) return false;
  element.click();
  return true;
}

/** 打开顶部「＋」或「⋯」下拉后，点其中的菜单项 */
function clickMenu(container: HTMLElement, menu: string, label: string): boolean {
  const trigger = container.querySelector(`summary[aria-label="${menu}"]`);
  if (trigger instanceof HTMLElement) trigger.click();
  const item = [...container.querySelectorAll(`[role="menu"][aria-label="${menu}"] [role="menuitem"]`)].find(
    (entry) => (entry.textContent ?? '').trim() === label,
  );
  if (!(item instanceof HTMLElement)) return false;
  item.click();
  return true;
}

function setInputValue(element: HTMLElement, value: string): void {
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
function blurInput(element: HTMLElement): void {
  element.dispatchEvent(new window.FocusEvent('blur'));
  element.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
}

/** 在输入框里按回车。 */
function pressEnter(element: HTMLElement): void {
  element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function pointerEvent(type: string, init: Record<string, unknown>): Event {
  const EventCtor = window.PointerEvent ?? window.MouseEvent;
  return new EventCtor(type, { bubbles: true, cancelable: true, ...init } as never);
}

/** 点击某天列某一节上的一行（该节空着时才有效，period 从 1 开始）。 */
function clickGridCell(container: HTMLElement, day: number, period = 1): boolean {
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
function slotRange(container: HTMLElement): string {
  return (container.querySelector('[data-role="period-wheel"]')?.textContent ?? '').trim();
}

/** 课程表单里某个下拉框当前显示的值。 */
function triggerText(label: string): string {
  return (document.querySelector(`[aria-label="${label}"]`)?.textContent ?? '').trim();
}

/** 按住占位块本体拖动：dy 为相对按下的像素位移（56 一格）。 */
function dragEmptySlot(
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
function stubRect(element: Element, left: number, top: number, width = 100, height = 56): void {
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
async function dragLesson(
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

/** 找到课程卡（CourseCard 渲染的按钮）与承接指针事件的外层容器。 */
function findLessonCard(container: HTMLElement, name: string): { card: HTMLElement; holder: HTMLElement } | null {
  const card = [...container.querySelectorAll('[data-tone]')].find((item) =>
    (item.textContent ?? '').includes(name),
  );
  const holder = card?.parentElement;
  if (!(card instanceof window.HTMLElement) || !(holder instanceof window.HTMLElement)) return null;
  return { card, holder };
}

/** 只补发一次 click（不再按下指针）：用来验证拖动收尾那次 click 是否被抑制。 */
function clickLessonCard(container: HTMLElement, name: string): boolean {
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
async function tapLessonCard(container: HTMLElement, name: string): Promise<boolean> {
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

const PAGE_SAMPLE = `<table id="kbtable"><tr>
  <td id="1-1"><div><span class="title">网页导入课程</span><p>张老师</p><p>教三-401</p><p>1-16周</p></div></td>
  <td id="2-1"><div><span class="title">网页导入课程二</span><p>李老师</p><p>理科楼-201</p><p>2-16周(双)</p></div></td>
</tr></table>`;

const PAGE_WEEKDAY_SAMPLE = `<table><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td></tr>
  <tr><td>第1节</td><td>手动映射课程<br>1-16周</td><td></td><td></td></tr>
  <tr><td>第2节</td><td></td><td>手动映射课程二<br>2-16周</td><td></td></tr>
</table>`;

/** 预设更新冒烟用的假 Response：全程不联网。 */
function presetJsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/**
 * 缓存快照 1.1.0 自带的作息正文：内容是「内置 default 的另一种作息」。
 * 用同一份数据测两件事——下载时能通过正文校验、启动时能真的覆盖掉内置预设。
 */
const CACHE_TIMETABLE_ID = 'default';
const CACHE_TIMETABLE_NAME = '缓存作息（测试）';
const CACHE_PERIODS = [
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
function fakePresetContent(version: string): CachedPresetContent {
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
        detect: { markers: ['jwglxt'] },
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
function fakePresetSnapshot(version: string): PresetSnapshot {
  const content = fakePresetContent(version);
  const unsigned = {
    version,
    schemaVersion: 1,
    generatedAt: '2026-02-01T00:00:00.000Z',
    sources: {
      timetables: content.timetables.map((preset) => ({
        id: preset.id,
        path: `presets/schools/${preset.id}/timetable.json`,
        sha256: `sha256:${sha256HexSync(canonicalPresetJson(preset))}`,
        ...preset,
      })),
      systems: content.systems.map((system) => ({
        id: system.id,
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

export async function runSmoke(): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  const check = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail });
  };

  const empty = mount(<App />);
  await flush(10);
  check(
    '空库渲染引导页',
    (empty.container.textContent ?? '').includes('欢迎使用晓刻 DawnTick'),
    (empty.container.textContent ?? '').slice(0, 60),
  );
  empty.root.unmount();

  const seeded = await seed();
  const seededMonday = seeded.monday;
  const overdueTodoId = seeded.overdueTodoId;
  // 窗口默认从今天开始：后面的断言大量用今天与这两天假期
  const todayText = seeded.today;
  const holidayStartText = seeded.holidayStart;
  const holidaySecondText = seeded.holidaySecond;
  const view = mount(<App />);
  await flush(20);
  // 渠道提示：dev 构建首次进入会弹一次开发版提醒，按掉后再继续其余用例
  check(
    'dev 构建首次提示开发版滚动更新',
    (document.body.textContent ?? '').includes('开发版提示') &&
      (document.body.textContent ?? '').includes('开发版滚动更新'),
    (document.body.textContent ?? '').slice(0, 60),
  );
  if (clickByText(document.body, '知道了')) await flush(10);
  check('提示按掉后不再显示', !(document.body.textContent ?? '').includes('开发版提示'), '');
  const text = view.container.textContent ?? '';
  check('课表渲染课程', text.includes('高数'), text.slice(0, 80));
  // 卡片无论是可点击的 button 还是只读 div，都要带 data-role：行高自适应靠它量布局
  check(
    '课表卡片带可测量的 data-role',
    view.container.querySelectorAll('[data-role="course-card"]').length > 0,
    `${view.container.querySelectorAll('[data-role="course-card"]').length} 张`,
  );
  check('工具栏渲染周次', /第\s*\d+\s*周/.test(text), '');
  check('渲染当前时间指示线', view.container.querySelector('[aria-hidden="true"]') !== null, '');
  check('高亮当天列', view.container.querySelector('[data-today="true"]') !== null, '');
  check(
    '非本周课程用虚线框显示',
    text.includes('大物') && view.container.querySelector('[data-dashed="true"]') !== null,
    '',
  );
  // 20:00 的组会晚于最后一节课：网格要按真实分钟向下扩展，而不是把卡片夹回来
  const gridPadBottom = view.container.querySelector<HTMLElement>('[data-role="grid-pad-bottom"]');
  const customCard = view.container.querySelector<HTMLElement>('[data-custom-time="true"]');
  const gridBox = view.container.querySelector<HTMLElement>('[data-role="app-main"]');
  check(
    '晚于最后一节的条目把网格尾部按分钟扩展',
    gridPadBottom !== null &&
      customCard !== null &&
      /^\d{2}:\d{2}–\d{2}:\d{2}$/.test((gridPadBottom.textContent ?? '').trim()) &&
      Number.parseFloat(customCard.style.top) > 0 &&
      gridBox !== null,
    gridPadBottom === null ? '没有尾部补白' : `补白 ${gridPadBottom.textContent?.trim() ?? ''}`,
  );

  const roomField = view.container.querySelector('[data-field="room"]');
  const teacherField = view.container.querySelector('[data-field="teacher"]');
  check(
    '地点与老师分两行且可换行',
    roomField !== null &&
      teacherField !== null &&
      !roomField.contains(teacherField) &&
      !teacherField.contains(roomField) &&
      roomField.className.includes('break-words') &&
      teacherField.className.includes('break-words'),
    '',
  );
  check('表头显示月日', /\d+\/\d+/.test(text), '');
  check(
    '非本周课程标注更浅并写明非本周',
    text.includes('非本周') && view.container.querySelector('[data-tone="ghost"]') !== null,
    '',
  );

  // 周视图 = 从今天开始的 N 天窗口：列数 = 设置天数，第一列是今天，前后切换按 N 天平移
  const windowNav = (): HTMLElement | null => view.container.querySelector('[data-role="window-nav"]');
  const windowStartOf = (): string => windowNav()?.getAttribute('data-window-start') ?? '(无)';
  const windowDaysOf = (): string => windowNav()?.getAttribute('data-window-days') ?? '(无)';
  check(
    '窗口从今天开始且列数等于设置天数',
    windowStartOf() === todayText &&
      windowDaysOf() === '7' &&
      view.container.querySelectorAll('[data-date]').length === 7 &&
      view.container.querySelector(`[data-date="${todayText}"]`) !== null,
    `起=${windowStartOf()} 天=${windowDaysOf()} 列=${view.container.querySelectorAll('[data-date]').length}`,
  );
  if (clickByLabel(view.container, '下一屏')) await flush(20);
  check('下一屏按设置天数平移', windowStartOf() === addDays(todayText, 7), windowStartOf());
  if (clickByLabel(view.container, '上一屏')) await flush(20);
  check('上一屏回到今天', windowStartOf() === todayText, windowStartOf());
  if (clickByLabel(view.container, '上一屏')) await flush(20);
  check('上一屏可以退到今天之前', windowStartOf() === addDays(todayText, -7), windowStartOf());
  if (clickByLabel(view.container, '回到今天')) await flush(30);
  check('「回到今天」回到以今天开头的窗口', windowStartOf() === todayText, windowStartOf());
  // 快捷键在输入框里会被忽略：先失焦再按，避免日期输入框吃掉按键
  if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await flush(30);
  check('快捷键 → 平移一屏', windowStartOf() === addDays(todayText, 7), windowStartOf());
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 't', bubbles: true }));
  await flush(30);
  check('快捷键 T 回到以今天开头的窗口', windowStartOf() === todayText, windowStartOf());
  check(
    '放假日课程灰显',
    text.includes('放假') && view.container.querySelector('[data-tone="holiday"]') !== null,
    '',
  );
  check(
    '课表不再依赖左右滑动',
    view.container.querySelector('.overflow-x-auto') === null &&
      view.container.querySelector('[class*="min-w-[40rem]"]') === null,
    '',
  );
  const timetableLabels = [...view.container.querySelectorAll('[data-role="lab-label"]')].map((node) =>
    (node.textContent ?? '').trim(),
  );
  check(
    '日程按开关显示在课表上，实验默认显示',
    timetableLabels.includes('实验') && timetableLabels.includes('日程'),
    timetableLabels.join(' / ') || '(无课表条目)',
  );
  // 课表里的待办条目要显示所属课程
  const eventCell = [...view.container.querySelectorAll('[data-role="lab-label"]')]
    .map((node) => node.closest('div[data-tone]') ?? node.parentElement?.parentElement ?? null)
    .find((node) => (node?.textContent ?? '').includes('组会'));
  check(
    '课表里的待办显示所属课程',
    (eventCell?.textContent ?? '').includes('概率论'),
    (eventCell?.textContent ?? '(未找到条目)').slice(0, 40),
  );

  // ③ 放假优先于非本周：周一既放假、又只在第 1-2 周上的「概率论」必须按放假渲染
  const holidayGhostCard = [...view.container.querySelectorAll('[data-tone]')].find((item) =>
    (item.textContent ?? '').includes('概率'),
  );
  const holidayGhostTone = holidayGhostCard?.getAttribute('data-tone') ?? '(未找到)';
  check(
    '放假与非本周同时成立时按放假渲染',
    holidayGhostTone === 'holiday' && holidayGhostCard?.getAttribute('data-dashed') === null,
    `${holidayGhostTone} / dashed=${holidayGhostCard?.getAttribute('data-dashed') ?? 'null'}`,
  );

  // ④ 多天假期：第一天卡片上显示假期名称，第二天起只显示「放假」
  // 用每天都有的「往期课」取卡片，否则这条断言只在假期第一天恰好有课时才成立
  const holidayLabelAt = (date: string, name: string): string | undefined =>
    [...(view.container.querySelector(`[data-date="${date}"]`)?.querySelectorAll('[data-tone="holiday"]') ?? [])]
      .find((item) => (item.textContent ?? '').includes(name))
      ?.querySelector('[data-role="holiday-label"]')
      ?.textContent?.trim();
  const firstDayLabel = holidayLabelAt(holidayStartText, '往期');
  const laterDayLabel = holidayLabelAt(holidaySecondText, '往期');
  check('多天假期第一天卡片显示假期名称', firstDayLabel === '国庆节', firstDayLabel ?? '(未找到)');
  check('假期第二天起只显示放假', laterDayLabel === '放假', laterDayLabel ?? '(未找到)');

  // C1：长按拖动 + 吸附后选作用范围
  const heldWithoutMove = await dragLesson(view.container, '高数');
  await flush(6);
  check(
    '原地长按松手不弹调整弹窗',
    heldWithoutMove && !(document.body.textContent ?? '').includes('调整课程时间'),
    '',
  );
  const heldAndMoved = await dragLesson(view.container, '高数', { day: 4 });
  await flush(6);
  const moveDialogText = document.body.textContent ?? '';
  check(
    '长按拖到别列后弹出调整课程时间',
    heldAndMoved &&
      moveDialogText.includes('调整课程时间') &&
      moveDialogText.includes('本周生效') &&
      moveDialogText.includes('每周生效') &&
      moveDialogText.includes('指定周的同一天') &&
      moveDialogText.includes('指定日期') &&
      moveDialogText.includes('第 1–2 节'),
    moveDialogText.slice(-60),
  );
  if (clickByText(document.body, '取消')) await flush(6);
  check('取消调整弹窗后课表不变', (view.container.textContent ?? '').includes('高数'), '');

  // C1b：单击课程卡打开详情。拖动收尾只抑制紧随的那一次 click，且 pointerdown 会复位抑制标记。
  await dragLesson(view.container, '高数');
  await flush(4);
  const tailClick = clickLessonCard(view.container, '高数');
  await flush(6);
  check(
    '拖动收尾的那次点击不打开详情',
    tailClick && document.querySelector('[data-role="reminder-section"]') === null,
    '',
  );
  // 再拖一次但不补 click（模拟抬手落在卡片外，抑制标记会残留），随后普通单击必须仍能打开详情
  await dragLesson(view.container, '高数');
  await flush(4);
  const tapped = await tapLessonCard(view.container, '高数');
  const detailText = document.body.textContent ?? '';
  check(
    '点课程卡打开详情',
    tapped &&
      document.querySelector('[data-role="reminder-section"]') !== null &&
      detailText.includes('删除整门课'),
    detailText.slice(-60),
  );
  // P0-02：删除排课先弹确认，取消后数据仍在
  const removeScheduleButton = document.querySelector<HTMLElement>('[aria-label="删除该排课"]');
  check(
    '课程详情提供删除排课入口',
    removeScheduleButton !== null,
    removeScheduleButton?.tagName ?? '(无)',
  );
  removeScheduleButton?.click();
  await flush(8);
  const confirmText = document.body.textContent ?? '';
  check(
    '删除排课先弹确认并说明后果',
    confirmText.includes('将删除') && confirmText.includes('不可撤销'),
    confirmText.slice(-80),
  );
  if (clickByText(document.body, '取消')) await flush(8);
  check(
    '取消删除后排课仍在',
    document.querySelector('[data-role="reminder-section"]') !== null &&
      (view.container.textContent ?? '').includes('高数'),
    '',
  );

  // 课前提醒：区块标题 + 「使用全局配置」子项开关（不再是标题态的复选框）
  const reminderSection = document.querySelector('[data-role="reminder-section"]');
  const globalSwitch = reminderSection?.querySelector<HTMLElement>('[role="switch"][aria-label="使用全局配置"]');
  check(
    '课前提醒为区块标题且全局配置是子项开关',
    reminderSection !== null &&
      (reminderSection.textContent ?? '').includes('课前提醒') &&
      globalSwitch !== null &&
      globalSwitch.getAttribute('aria-checked') === 'true' &&
      reminderSection.querySelector('input[type="checkbox"][aria-label="使用全局配置"]') === null &&
      (reminderSection.textContent ?? '').includes('跟随全局设置'),
    `switch=${globalSwitch?.getAttribute('aria-checked') ?? '(无)'}`,
  );
  if (globalSwitch !== null) {
    globalSwitch.click();
    await flush(8);
    check(
      '关掉全局配置后出现本课程单独设置',
      (reminderSection.textContent ?? '').includes('本课程单独设置') &&
        (reminderSection.textContent ?? '').includes('保存提醒'),
      (reminderSection.textContent ?? '').slice(-40),
    );
    globalSwitch.click();
    await flush(8);
  }
  // P0-03：详情关闭出口（✕ / Esc / 切页清空）
  const closeDetailButton = document.querySelector<HTMLElement>('[aria-label="关闭课程详情"]');
  check('课程详情有关闭按钮', closeDetailButton !== null, closeDetailButton?.tagName ?? '(无)');
  closeDetailButton?.click();
  await flush(8);
  check('点关闭按钮收起课程详情', document.querySelector('[data-role="reminder-section"]') === null, '');

  await tapLessonCard(view.container, '高数');
  await flush(6);
  check('重新打开详情后可再次关闭', document.querySelector('[data-role="reminder-section"]') !== null, '');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(8);
  check('Esc 关闭课程详情', document.querySelector('[data-role="reminder-section"]') === null, '');

  await tapLessonCard(view.container, '高数');
  await flush(6);
  clickByText(document.body, '设置');
  await flush(10);
  clickByText(document.body, '课表');
  await flush(10);
  check(
    '切到设置再回课表不残留详情',
    document.querySelector('[data-role="reminder-section"]') === null,
    '',
  );

  // C2：点空白格 → 虚线占位块 → 滚轮改节次 → 进课程表单预填（周二第 1 节是空的）
  const clickInfo = clickGridCell(view.container, 2);
  await flush(6);
  const slot = view.container.querySelector('[data-role="empty-slot"]');
  const wheel = view.container.querySelector('[data-role="period-wheel"]');
  check(
    '点空白格出现单节占位块',
    slot !== null && (wheel?.textContent ?? '').trim() === '第 1 节',
    `${(wheel?.textContent ?? '').trim()} | ${clickInfo}`,
  );
  wheel?.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
  await flush(6);
  check(
    '滚轮可扩展节次范围',
    (view.container.querySelector('[data-role="period-wheel"]')?.textContent ?? '').trim() === '第 1–2 节',
    `${(view.container.querySelector('[data-role="period-wheel"]')?.textContent ?? '').trim()}`,
  );
  check('滚轮改范围不弹出加课弹窗', document.querySelector('[aria-label="起始节"]') === null, '');
  // 真实鼠标点「＋」之前会先发 pointerdown：范围不能被列上的 pointerdown 重置成单节
  const plusButton = slot?.querySelector('button[aria-label="在此新建课程"]');
  if (plusButton instanceof window.HTMLElement) {
    plusButton.dispatchEvent(pointerEvent('pointerdown', { pointerId: 11, button: 0, clientX: 150, clientY: 104 }));
    plusButton.dispatchEvent(pointerEvent('pointerup', { pointerId: 11, clientX: 150, clientY: 104 }));
    await flush(4);
  }
  clickByLabel(view.container, '在此新建课程');
  await flush(12);
  const createdText = document.body.textContent ?? '';
  // 预填的周次应当是「当前查看的那一周」，所以只检查恰好压中一周，不写死周序号
  const pressedWeeks = [...document.querySelectorAll('[aria-label^="第 "][aria-label$=" 周"]')].filter(
    (item) => item.getAttribute('aria-pressed') === 'true',
  );
  check(
    '空白格新建预填星期与节次',
    createdText.includes('添加课程') &&
      createdText.includes('周二') &&
      createdText.includes('第 1 节') &&
      createdText.includes('第 2 节') &&
      createdText.includes('已选 1/20 周') &&
      pressedWeeks.length === 1,
    `weeks=${pressedWeeks.map((item) => item.getAttribute('aria-label')).join(',')} tail=${createdText.slice(-40)}`,
  );
  check(
    '点 + 保留占位块节次范围',
    triggerText('起始节') === '第 1 节' && triggerText('结束节') === '第 2 节',
    `${triggerText('起始节')} → ${triggerText('结束节')}`,
  );
  // 内容超过屏高的弹窗必须留在视口内，并由正文区滚动
  const tallDialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const tallBody = tallDialog?.querySelector<HTMLElement>('[data-role="dialog-body"]');
  check(
    '弹窗有高度上限且正文区可滚动',
    tallDialog !== null &&
      tallBody !== null &&
      tallDialog.className.includes('max-h-') &&
      tallDialog.className.includes('overflow-hidden') &&
      tallBody.className.includes('overflow-y-auto'),
    `弹窗=${tallDialog?.className.includes('max-h-') === true ? '有上限' : '无上限'} / 正文=${tallBody?.className.includes('overflow-y-auto') === true ? '可滚动' : '不可滚动'}`,
  );
  if (clickByText(document.body, '取消')) await flush(6);
  check('取消后占位块消失', view.container.querySelector('[data-role="empty-slot"]') === null, '');

  // C2b：按住占位块本体拖动改范围 → 跨过已占用的格只提示不阻止 → 松手直接进课程表单
  clickGridCell(view.container, 1, 3);
  await flush(6);
  const bodySlot = view.container.querySelector('[data-role="empty-slot"]');
  check(
    '周一空白格出现单节占位块',
    bodySlot instanceof window.HTMLElement && slotRange(view.container) === '第 3 节',
    slotRange(view.container),
  );
  if (bodySlot instanceof window.HTMLElement) {
    const drag = dragEmptySlot(bodySlot);
    drag.down();
    await flush(4);
    check(
      '按住占位块本体出现拖动反馈',
      bodySlot.getAttribute('data-dragging') === 'true' &&
        view.container.querySelector('[data-role="empty-drag-label"]') !== null,
      `${bodySlot.getAttribute('data-dragging')}`,
    );
    drag.move(-2 * 56);
    await flush(4);
    check('拖动占位块可扩展节次范围', slotRange(view.container) === '第 1–3 节', slotRange(view.container));
    drag.move(0);
    await flush(4);
    check('拖动占位块可收缩回单节', slotRange(view.container) === '第 3 节', slotRange(view.container));
    drag.move(-2 * 56);
    await flush(4);
    const clashText = view.container.querySelector('[data-role="empty-clash"]')?.textContent ?? '';
    const clashToast = document.body.textContent ?? '';
    check(
      '跨越已占用格只提示不阻止',
      slotRange(view.container) === '第 1–3 节' &&
        clashText.includes('高等数学') &&
        clashToast.includes('与「高等数学」第 1–2 节重叠，仍可继续新建'),
      `${slotRange(view.container)} | ${clashText} | ${clashToast.includes('仍可继续新建')}`,
    );
    drag.up(-2 * 56);
    await flush(12);
    check(
      '拖动松手自动打开加课弹窗并预填范围',
      (document.body.textContent ?? '').includes('添加课程') &&
        triggerText('星期') === '周一' &&
        triggerText('起始节') === '第 1 节' &&
        triggerText('结束节') === '第 3 节' &&
        (document.body.textContent ?? '').includes('已选 1/20 周'),
      `${triggerText('星期')} ${triggerText('起始节')} → ${triggerText('结束节')}`,
    );
  }
  const nameBox = document.querySelector('[role="dialog"] input');
  if (nameBox instanceof window.HTMLInputElement) setInputValue(nameBox, '重叠测试课');
  await flush(4);
  if (clickByText(document.body, '保存')) await flush(16);
  check(
    '重叠课程保存成功并提示',
    (view.container.textContent ?? '').includes('重叠测试课') &&
      (document.body.textContent ?? '').includes('与「高等数学」第 1–2 节重叠，已同时保留'),
    (document.body.textContent ?? '').slice(-70),
  );

  // C2b-2：多节占位块按住下半（下缘跟随）：向下继续扩展、向上收缩
  clickGridCell(view.container, 5, 1);
  await flush(6);
  clickByLabel(view.container, '下一节');
  await flush(4);
  clickByLabel(view.container, '下一节');
  await flush(4);
  const bottomSlot = view.container.querySelector('[data-role="empty-slot"]');
  check(
    '箭头按钮可把占位块扩到多节',
    bottomSlot instanceof window.HTMLElement && slotRange(view.container) === '第 1–3 节',
    slotRange(view.container),
  );
  if (bottomSlot instanceof window.HTMLElement) {
    // jsdom 没有布局：给占位块造一份几何，按下点才会落在下半（下缘跟随）
    stubRect(bottomSlot, 500, 102, 100, 152);
    const drag = dragEmptySlot(bottomSlot);
    drag.down();
    drag.move(56);
    await flush(4);
    check('多节占位块按住下半向下扩展', slotRange(view.container) === '第 1–4 节', slotRange(view.container));
    drag.move(-56);
    await flush(4);
    check('多节占位块按住下半向上收缩', slotRange(view.container) === '第 1–2 节', slotRange(view.container));
    drag.up(-56);
    await flush(12);
    check(
      '多节占位块松手也自动弹窗并预填',
      triggerText('起始节') === '第 1 节' && triggerText('结束节') === '第 2 节',
      `${triggerText('起始节')} → ${triggerText('结束节')}`,
    );
  }
  if (clickByText(document.body, '取消')) await flush(6);

  // C2b-3：多节占位块按住上半（上缘跟随）：起点随指针走
  clickGridCell(view.container, 6, 1);
  await flush(6);
  clickByLabel(view.container, '下一节');
  await flush(4);
  clickByLabel(view.container, '下一节');
  await flush(4);
  const topSlot = view.container.querySelector('[data-role="empty-slot"]');
  if (topSlot instanceof window.HTMLElement) {
    stubRect(topSlot, 600, 102, 100, 152);
    const drag = dragEmptySlot(topSlot, 110);
    drag.down();
    drag.move(56);
    await flush(4);
    check('按住占位块上半拖动时上缘跟随', slotRange(view.container) === '第 2–3 节', slotRange(view.container));
    drag.up(56);
    await flush(12);
    check(
      '按住上半松手也自动弹窗并预填',
      triggerText('起始节') === '第 2 节' && triggerText('结束节') === '第 3 节',
      `${triggerText('起始节')} → ${triggerText('结束节')}`,
    );
  }
  if (clickByText(document.body, '取消')) await flush(6);

  // C2b-4：空白格按下不松手直接拖出范围（第一次按下就要能拖），松手直接进加课弹窗
  const column = view.container.querySelector(`[data-day="7"]`);
  if (column instanceof window.HTMLElement) {
    stubRect(column, 700, 100);
    const downY = 104;
    const upY = 100 + 2 * 56 + 4;
    const cell = [...column.querySelectorAll('div')][0];
    const target = cell instanceof window.HTMLElement ? cell : column;
    target.dispatchEvent(pointerEvent('pointerdown', { pointerId: 51, button: 0, clientX: 750, clientY: downY }));
    await flush(6);
    check(
      '空白格按下即出现单节占位块',
      slotRange(view.container) === '第 1 节' && view.container.querySelector('[data-role="empty-slot"]') !== null,
      slotRange(view.container),
    );
    target.dispatchEvent(pointerEvent('pointermove', { pointerId: 51, clientX: 750, clientY: upY }));
    await flush(6);
    check(
      '不松手继续拖动即可扩成范围',
      slotRange(view.container) === '第 1–3 节' &&
        view.container.querySelector('[data-role="empty-drag-label"]') !== null,
      `${slotRange(view.container)} / 反馈=${view.container.querySelector('[data-role="empty-drag-label"]') === null ? '无' : '有'}`,
    );
    target.dispatchEvent(pointerEvent('pointerup', { pointerId: 51, clientX: 750, clientY: upY }));
    // 真实浏览器里 click 紧跟在 pointerup 之后：这里同样紧邻派发，验证收尾那次点击被抑制
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientY: upY }));
    await flush(12);
    check(
      '第一次按下拖出的范围直接进加课弹窗',
      (document.body.textContent ?? '').includes('添加课程') &&
        triggerText('星期') === '周日' &&
        triggerText('起始节') === '第 1 节' &&
        triggerText('结束节') === '第 3 节',
      `${triggerText('星期')} ${triggerText('起始节')} → ${triggerText('结束节')}`,
    );
    check(
      '拖动松手后的那次点击不另起占位块',
      view.container.querySelector('[data-role="empty-slot"]') === null &&
        (document.body.textContent ?? '').includes('添加课程'),
      `占位块=${view.container.querySelector('[data-role="empty-slot"]') === null ? '无' : slotRange(view.container)} / 弹窗=${(document.body.textContent ?? '').includes('添加课程') ? '在' : '不在'}`,
    );
  }
  if (clickByText(document.body, '取消')) await flush(6);

  // 只按一下不动（轻微抖动也算单击）：保留单节占位块，不弹加课弹窗
  // 选一个第 5 节一定空着、又不是今天的列：今天有概率论、周二与周四有线代（第 5–8 节）
  const todayDayOfWeek = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const emptyDay = [1, 2, 3, 4, 5, 6, 7].find(
    (day) => day !== todayDayOfWeek && day !== 2 && day !== 4,
  ) ?? 1;
  clickGridCell(view.container, emptyDay, 5);
  await flush(8);
  check(
    '空白格单击（未拖动）只留单节占位块',
    slotRange(view.container) === '第 5 节' && document.querySelector('[aria-label="起始节"]') === null,
    `${slotRange(view.container)} @ 周${emptyDay}`,
  );
  // 清掉占位块，避免影响后面的拖动调课断言
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(6);

  // C2c：拖动调课落到已占用的节次：仍然能调，只多一条重叠提醒
  await dragLesson(view.container, '高数', { day: 1, clientY: 216 });
  await flush(6);
  const overlapMoveText = document.body.textContent ?? '';
  check(
    '拖到已占用节次仍可打开调整弹窗',
    overlapMoveText.includes('调整课程时间') && overlapMoveText.includes('第 3–4 节'),
    overlapMoveText.slice(-60),
  );
  if (clickByText(document.body, '本周生效')) await flush(16);
  check(
    '重叠调课保存成功并提示',
    (document.body.textContent ?? '').includes('调整后与「重叠测试课」第 1–3 节重叠，已同时保留'),
    (document.body.textContent ?? '').slice(-70),
  );
  // 本周生效的调课要在课表里落到两个位置：原位置灰显标「已调课」，目标位置标「调课」
  const movedOutCard = view.container.querySelector('[data-tone="movedOut"]');
  const movedInCard = view.container.querySelector('[data-role="moved-in-label"]')?.closest('[data-tone]') ?? null;
  check(
    '本周调课后课表标出原位置与落点',
    movedOutCard !== null &&
      (movedOutCard.querySelector('[data-role="moved-out-label"]')?.textContent ?? '').trim() === '已调课' &&
      (movedOutCard.textContent ?? '').includes('高数') &&
      movedInCard !== null &&
      (movedInCard.textContent ?? '').includes('高数') &&
      movedOutCard.className.includes('opacity-45'),
    `${movedOutCard?.textContent?.trim() ?? '(无原位置)'} / ${movedInCard?.textContent?.trim() ?? '(无落点)'}`,
  );
  const switchedToSchedule = clickByText(view.container, '日程');
  await flush(10);
  const scheduleText = view.container.textContent ?? '';
  check('切到日程页', switchedToSchedule && scheduleText.includes('倒计时'), scheduleText.slice(0, 60));
  // 日程页收敛为「顶部一行 + 时间线 + 侧栏卡片」：加日程/加考试/课程调整收进「＋」，其余收进「⋯」
  check(
    '日程页默认只剩顶部一行与时间线',
    view.container.querySelector('summary[aria-label="添加"]') !== null &&
      view.container.querySelector('summary[aria-label="更多操作"]') !== null &&
      view.container.querySelector('[aria-label="日程侧栏"]') !== null,
    '',
  );
  // ① 时间线课程显示开始–结束；② 行内「调课」按钮移除，改为点课程进详情再调课
  const seededHolidays = new Set<string>(builtinHolidays());
  seededHolidays.delete(addDays(holidayStartText, -1));
  seededHolidays.add(holidayStartText);
  seededHolidays.add(holidaySecondText);
  // 拖动测试会改高数的排课，这里只挑没被动过的线代：周二 14:00–15:40 与周四 16:00–17:40
  const timelinePicks = [
    { date: addDays(seededMonday, 8), range: '14:00–15:40', course: '线性代数' },
    { date: addDays(seededMonday, 10), range: '16:00–17:40', course: '线性代数' },
    { date: addDays(seededMonday, 7), range: '08:00–09:40', course: '高等数学' },
  ];
  const picked = timelinePicks.find((item) => !seededHolidays.has(item.date)) ?? timelinePicks[0];
  const dateBox = view.container.querySelector('input[aria-label="查看日期"]');
  if (dateBox instanceof window.HTMLInputElement) setInputValue(dateBox, picked.date);
  await flush(10);
  const rangeText = (view.container.querySelector('[data-role="lesson-time"]')?.textContent ?? '').trim();
  check('日程时间线课程显示开始–结束', rangeText === picked.range, `${rangeText} @ ${picked.date}`);
  check('时间线行不再有行内调课按钮', !hasLabel(view.container, '调课：'), '');
  // 课程条目不再显示「第 X 节」：左侧时间列、性质标签与标题都还在，只是不再有节次文案
  const timelineLessonRowSample = view.container.querySelector('[data-role="timeline-row"][data-kind="lesson"]');
  const lessonRowText = (timelineLessonRowSample?.textContent ?? '').trim();
  check(
    '日程课程条目不显示第 X 节',
    timelineLessonRowSample !== null &&
      rangeText === picked.range &&
      !/第\s*\d+(\s*[-–]\s*\d+)?\s*节/.test(lessonRowText) &&
      lessonRowText.includes(picked.course) &&
      (timelineLessonRowSample.querySelector('[data-role="timeline-nature"]')?.textContent ?? '').trim() ===
        '课程',
    `${rangeText} | ${lessonRowText}`,
  );

  const timelineLessonRow = view.container.querySelector('[data-role="timeline-lesson"]');
  let rowClicked = false;
  if (timelineLessonRow instanceof window.HTMLElement) {
    timelineLessonRow.click();
    rowClicked = true;
  }
  await flush(14);
  check(
    '点时间线课程打开课程详情',
    rowClicked &&
      document.querySelector('[aria-label="调课"]') !== null &&
      (document.body.textContent ?? '').includes('删除整门课'),
    (document.body.textContent ?? '').slice(-60),
  );
  if (clickByLabel(document.body, '调课')) await flush(14);
  const adjustFromDate = document.querySelector('input[aria-label="原来哪一天"]');
  check(
    '详情页调课入口打开调整弹窗并预填课次',
    (document.body.textContent ?? '').includes('临时加课') &&
      triggerText('哪门课') === picked.course &&
      adjustFromDate instanceof window.HTMLInputElement &&
      adjustFromDate.value === picked.date,
    `${triggerText('哪门课')} / ${adjustFromDate instanceof window.HTMLInputElement ? adjustFromDate.value : '(无)'}`,
  );
  if (clickByText(document.body, '取消')) await flush(8);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(8);

  // —— 日程时间线（重做后）：按结束时间自动完成、已完成分组、性质标签、地点与颜色条 ——
  const setViewDate = async (date: string): Promise<void> => {
    const box = view.container.querySelector('input[aria-label="查看日期"]');
    if (box instanceof window.HTMLInputElement) setInputValue(box, date);
    await flush(10);
  };
  const rowsIn = (role: string): Element[] => [
    ...view.container.querySelectorAll(`[data-role="${role}"] [data-role="timeline-row"]`),
  ];
  const rowIn = (role: string, text: string): Element | undefined =>
    rowsIn(role).find((row) => (row.textContent ?? '').includes(text));
  const rowsText = (role: string): string =>
    rowsIn(role)
      .map((row) => (row.textContent ?? '').trim())
      .join(' | ');
  const natureOf = (row: Element | null | undefined): string =>
    row?.querySelector('[data-role="timeline-nature"]')?.textContent?.trim() ?? '(无)';
  const doneGroup = (): Element | null => view.container.querySelector('[data-role="timeline-completed"]');
  const doneToggle = (): Element | null => view.container.querySelector('[data-role="timeline-completed-toggle"]');
  const doneList = (): Element | null => view.container.querySelector('[data-role="timeline-completed-list"]');
  const mainList = (): Element | null => view.container.querySelector('[data-role="timeline-main"]');

  // ① 上一天（周日的第 9-10 节晚课已经结束）：没人勾选也自动完成；
  //    同一天「没有时间」的待办不受影响，仍然留在主列表里。
  const pastDate = addDays(seededMonday, -1);
  await setViewDate(pastDate);
  const pastCourseRow = rowIn('timeline-completed', '往期课');
  const noTimeRow = rowIn('timeline-main', '无时间待办');
  const courseNature = natureOf(pastCourseRow);
  const otherNature = natureOf(noTimeRow);
  check(
    '日程时间线：过期的课自动归入已完成',
    pastCourseRow !== undefined &&
      pastCourseRow.getAttribute('data-auto') === 'true' &&
      !rowsText('timeline-main').includes('往期课'),
    `已完成=${rowsText('timeline-completed').slice(0, 40)} / 主=${rowsText('timeline-main').slice(0, 40)}`,
  );
  check(
    '日程时间线：没有时间的条目永不自动完成',
    noTimeRow !== undefined &&
      noTimeRow.getAttribute('data-auto') === null &&
      !rowsText('timeline-completed').includes('无时间待办'),
    `主=${rowsText('timeline-main').slice(0, 40)}`,
  );
  const colorBar = pastCourseRow?.querySelector('[data-role="timeline-color"]');
  const locationLine = pastCourseRow?.querySelector('[data-role="timeline-location"]');
  const plainColor = noTimeRow?.querySelector('[data-role="timeline-color"]')?.getAttribute('data-color') ?? '';
  check(
    '日程时间线：条目有定位图标的地点行与颜色条',
    (locationLine?.textContent ?? '').includes('实验楼-501') &&
      locationLine?.querySelector('[aria-hidden="true"]') !== null &&
      (colorBar?.getAttribute('data-color') ?? '') !== '' &&
      plainColor === 'var(--dt-primary)',
    `地点=${locationLine?.textContent?.trim() ?? '(无)'} 色=${colorBar?.getAttribute('data-color') ?? '(无)'} 无颜色=${plainColor}`,
  );
  const groupNode = doneGroup();
  const mainNode = mainList();
  check(
    '日程时间线：已完成分组置顶且标题带条数',
    groupNode !== null &&
      mainNode !== null &&
      (groupNode.compareDocumentPosition(mainNode) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
      (doneToggle()?.textContent ?? '').includes(`已完成 ${rowsIn('timeline-completed').length}`) &&
      groupNode.getAttribute('data-count') === String(rowsIn('timeline-completed').length) &&
      rowsIn('timeline-completed').length === 1,
    `count=${groupNode?.getAttribute('data-count')} 行=${rowsIn('timeline-completed').length}`,
  );
  check(
    '日程时间线：还有未完成条目时已完成分组默认收起',
    (mainList()?.textContent ?? '').includes('无时间待办') &&
      doneToggle()?.getAttribute('aria-expanded') === 'false' &&
      doneList()?.hasAttribute('hidden') === true,
    `aria=${doneToggle()?.getAttribute('aria-expanded') ?? '(无)'}`,
  );
  const collapsedToggle = doneToggle();
  if (collapsedToggle instanceof window.HTMLElement) collapsedToggle.click();
  await flush(6);
  check(
    '日程时间线：点标题可手动展开已完成分组',
    doneToggle()?.getAttribute('aria-expanded') === 'true' && doneList()?.hasAttribute('hidden') === false,
    `aria=${doneToggle()?.getAttribute('aria-expanded') ?? '(无)'}`,
  );

  // ② 再往前挑一个非假日的过去日期：那天只剩已经结束的课 → 已完成分组自动展开
  let allDoneDate = addDays(seededMonday, -2);
  for (let step = 3; step <= 14 && seededHolidays.has(allDoneDate); step += 1) {
    allDoneDate = addDays(seededMonday, -step);
  }
  await setViewDate(allDoneDate);
  const allDoneToggle = doneToggle();
  const allDoneList = doneList();
  check(
    '日程时间线：全部完成时已完成分组自动展开',
    doneGroup() !== null &&
      rowsIn('timeline-main').length === 0 &&
      rowsIn('timeline-completed').length > 0 &&
      allDoneToggle?.getAttribute('aria-expanded') === 'true' &&
      allDoneList?.hasAttribute('hidden') === false,
    `${allDoneDate}：主 ${rowsIn('timeline-main').length} / 已完成 ${rowsIn('timeline-completed').length} / aria=${allDoneToggle?.getAttribute('aria-expanded') ?? '(无)'}`,
  );

  // ③ 过期待办在线代那天（+8）：自动完成但不回写数据库
  await setViewDate(addDays(seededMonday, 8));
  const probe = validatedStorage(await openIndexedDbStorage());
  const overdueRow = await probe.collection<Record<string, unknown>>('events').get(overdueTodoId);
  check(
    '日程时间线：过期待办自动完成且不回写数据库',
    rowIn('timeline-completed', '过期待办') !== undefined &&
      rowIn('timeline-main', '过期待办') === undefined &&
      overdueRow !== undefined &&
      overdueRow['done'] === 0,
    `done=${overdueRow === undefined ? '(未找到)' : String(overdueRow['done'])}`,
  );
  // 再切到窗口内的周一（调课落点与另外两条种子在那天）核对四种性质标签
  await setViewDate(addDays(seededMonday, 7));
  const adjustNature = natureOf(view.container.querySelector('[data-kind="adjust"]'));
  const examNature = natureOf(rowIn('timeline-main', '期末模拟考'));
  check(
    '日程时间线：显示条目性质标签（课程/调整/其他/考试）',
    courseNature === '课程' && adjustNature === '调整' && otherNature === '其他' && examNature === '考试',
    `课程=${courseNature} 调整=${adjustNature} 其他=${otherNature} 考试=${examNature}`,
  );

  // ④ 停课：日程里默认已完成（进已完成分组、不计入未完成），课表里灰显并标注「停课」
  const cancelDate = addDays(seededMonday, 9);
  await setViewDate(cancelDate);
  if (clickMenu(view.container, '更多操作', '当天全部停课')) await flush(18);
  const cancelledRow = rowIn('timeline-completed', '往期课');
  check(
    '日程时间线：停课默认已完成并进已完成分组',
    cancelledRow !== undefined &&
      cancelledRow.getAttribute('data-done') === 'true' &&
      cancelledRow.getAttribute('data-completed') === 'true' &&
      !rowsText('timeline-main').includes('往期课'),
    `已完成=${rowsText('timeline-completed').slice(0, 40)} / 主=${rowsText('timeline-main').slice(0, 40)}`,
  );
  check(
    '日程时间线：停课条目写明停课',
    (cancelledRow?.textContent ?? '').includes('停课'),
    cancelledRow?.textContent?.trim() ?? '(无)',
  );
  if (clickByText(view.container, '课表')) await flush(16);
  const cancelledCard = view.container.querySelector('[data-tone="cancelled"]');
  check(
    '停课的课次在课表里灰显并标注',
    cancelledCard !== null &&
      (cancelledCard.querySelector('[data-role="cancelled-label"]')?.textContent ?? '').trim() === '停课' &&
      cancelledCard.className.includes('opacity-45') &&
      (cancelledCard.textContent ?? '').includes('往期'),
    cancelledCard?.textContent?.trim() ?? '(无)',
  );
  if (clickByText(view.container, '日程')) await flush(12);

  if (clickMenu(view.container, '添加', '加待办')) await flush(12);
  const examKindButton = document.querySelector<HTMLElement>('[aria-label="待办类型：考试"]');
  examKindButton?.click();
  await flush(8);
  check(
    '加待办入口可选考试类型',
    document.body.textContent?.includes('添加待办') === true &&
      examKindButton !== null &&
      document.querySelector('[aria-label="开考时间"]') !== null &&
      (document.querySelector('[aria-label="开启倒计时"]')?.getAttribute('aria-checked') ?? '') === 'true',
    `类型按钮=${examKindButton === null ? '无' : '有'}`,
  );
  if (clickByText(document.body, '取消')) await flush(6);

  if (clickMenu(view.container, '添加', '加待办')) await flush(12);
  check(
    '加待办可关联课程并带提醒',
    document.querySelector('[aria-label="关联课程"]') !== null &&
      document.querySelector('[aria-label="待办提前提醒"]') !== null &&
      document.querySelector('[aria-label="开启倒计时"]') !== null &&
      document.querySelector('[aria-label="需要手动确认完成"]') !== null &&
      document.querySelector('[aria-label="自定义时间"]') !== null &&
      document.querySelector('[aria-label="显示在课表上"]') !== null,
    '',
  );
  // 打开「自定义时间」：给出真实起止时间，不再填节次
  const customSwitch = document.querySelector<HTMLElement>('[aria-label="自定义时间"]');
  customSwitch?.click();
  await flush(8);
  check(
    '自定义时间给出起止时间',
    document.querySelector('[aria-label="开始时间"]') !== null &&
      document.querySelector('[aria-label="结束时间"]') !== null,
    '',
  );
  if (clickByText(document.body, '取消')) await flush(6);
  check('日程与作业合并为一个入口', !scheduleText.includes('加作业/汇报'), '');

  // 改实验：单击时间线里的实验进详情，改名保存后必须写回
  const labRow = [...view.container.querySelectorAll('[data-role="timeline-row"]')].find((row) =>
    (row.textContent ?? '').includes('物理实验'),
  );
  const labOpen = labRow?.querySelector('[data-role="timeline-event"]');
  if (labOpen instanceof window.HTMLElement) labOpen.click();
  await flush(14);
  const labTitleInput = document.querySelector('[aria-label="实验名称"]');
  if (labTitleInput instanceof window.HTMLInputElement) setInputValue(labTitleInput, '物理实验（改）');
  await flush(6);
  const labSaved = clickByText(document.body, '保存');
  await flush(24);
  check(
    '改实验保存后写回时间线',
    labOpen !== null &&
      labSaved &&
      (view.container.textContent ?? '').includes('物理实验（改）'),
    `入口=${labOpen === null ? '无' : '有'}；保存=${labSaved ? '已点' : '未找到'}`,
  );

  // 倒计时卡片：显示类型与所属课程
  check(
    '倒计时条目显示类型与所属课程',
    (view.container.querySelector('[data-role="countdown-type"]')?.textContent ?? '').trim() === '日程' &&
      (view.container.querySelector('[data-role="countdown-course"]')?.textContent ?? '').includes('概率论'),
    `${view.container.querySelector('[data-role="countdown-type"]')?.textContent ?? '(无类型)'} / ${
      view.container.querySelector('[data-role="countdown-course"]')?.textContent ?? '(无课程)'
    }`,
  );

  // 原来的「倒计时」与「日期与倒计时」已合并成一张卡：桌上不再有第二个标题
  const countdownHeading = [...view.container.querySelectorAll<HTMLElement>('span')].find(
    (item) => (item.textContent ?? '').trim() === '倒计时' && item.className.includes('font-semibold'),
  );
  const countdownCardRoot = countdownHeading?.parentElement ?? null;
  check(
    '开学假期徽标与条目倒计时合并在一张卡片里',
    (document.body.textContent ?? '').includes('日期与倒计时') === false &&
      countdownCardRoot !== null &&
      countdownCardRoot.querySelector('[data-role="countdown-row"]') !== null,
    `卡片根=${countdownCardRoot === null ? '无' : '有'}`,
  );

  // 倒计时卡片：可以直接勾完成，也可以点进详情
  const countdownDone = [...view.container.querySelectorAll('input[type="checkbox"]')].find(
    (box) => box.getAttribute('aria-label') === '标记完成：组会',
  );
  if (countdownDone instanceof window.HTMLInputElement) {
    countdownDone.click();
    await flush(18);
  }
  check(
    '倒计时条目可直接勾选完成',
    countdownDone !== undefined &&
      [...view.container.querySelectorAll('[data-role="countdown-row"]')].some(
        (node) => (node.textContent ?? '').includes('组会') && node.querySelector('.line-through') !== null,
      ),
    countdownDone === undefined ? '倒计时里没有勾选框' : '已勾选',
  );
  // 勾回来，后面的「已完成待办」用例仍从「未完成」开始
  const countdownUndo = [...view.container.querySelectorAll('input[type="checkbox"]')].find(
    (box) => box.getAttribute('aria-label') === '标记完成：组会',
  );
  if (countdownUndo instanceof window.HTMLInputElement) {
    countdownUndo.click();
    await flush(18);
  }

  // 倒计时卡片：点条目进同一条待办的详情编辑
  const countdownRow = view.container.querySelector('[data-role="countdown-row"]');
  if (countdownRow instanceof window.HTMLElement) countdownRow.click();
  await flush(14);
  check(
    '倒计时条目单击可编辑',
    countdownRow !== null &&
      (document.body.textContent ?? '').includes('待办详情') &&
      (document.querySelector('[aria-label="标题"]') as HTMLInputElement | null)?.value === '组会',
    `卡片=${countdownRow === null ? '无' : '有'}；详情=${(document.body.textContent ?? '').includes('待办详情') ? '已开' : '未开'}`,
  );
  if (clickByText(document.body, '取消')) await flush(8);

  // 已完成的待办：勾掉之后展开已完成分组，点整行仍要能编辑
  const meetingCheckbox = [...view.container.querySelectorAll('input[type="checkbox"]')].find(
    (box) => box.getAttribute('aria-label') === '标记完成：组会',
  );
  if (meetingCheckbox instanceof window.HTMLInputElement) {
    meetingCheckbox.click();
    await flush(18);
  }
  const completedToggle = [...view.container.querySelectorAll('button')].find((node) =>
    (node.textContent ?? '').includes('已完成'),
  );
  if (completedToggle instanceof window.HTMLElement && completedToggle.getAttribute('aria-expanded') !== 'true') {
    completedToggle.click();
    await flush(12);
  }
  const completedRow = [...view.container.querySelectorAll('[data-role="timeline-completed-list"] [data-role="timeline-row"]')].find(
    (row) => (row.textContent ?? '').includes('组会'),
  );
  if (completedRow instanceof window.HTMLElement) completedRow.click();
  await flush(14);
  check(
    '已完成的待办点击也能编辑',
    completedRow !== undefined &&
      (document.body.textContent ?? '').includes('待办详情') &&
      (document.querySelector('[aria-label="标题"]') as HTMLInputElement | null)?.value === '组会',
    `已完成行=${completedRow === undefined ? '未找到' : '已点击'}；详情=${(document.body.textContent ?? '').includes('待办详情') ? '已开' : '未开'}`,
  );
  if (clickByText(document.body, '取消')) await flush(8);

  check(
    '日程可切换日期与设置假日',
    view.container.querySelector('[aria-label="前一天"]') !== null &&
      view.container.querySelector('[aria-label="查看日期"]') !== null &&
      view.container.querySelector('[aria-label="后一天"]') !== null &&
      view.container.querySelector('summary[aria-label="更多操作"]') !== null &&
      [...view.container.querySelectorAll('[role="menu"][aria-label="更多操作"] [role="menuitem"]')].some((item) =>
        ['设为假日', '设为非假日'].includes((item.textContent ?? '').trim()),
      ),
    '',
  );
  if (clickMenu(view.container, '添加', '课程调整')) await flush(12);
  const adjustText = document.body.textContent ?? '';
  check(
    '课程调整含三种模式',
    adjustText.includes('调课') && adjustText.includes('调休') && adjustText.includes('临时加课'),
    '',
  );
  check('调课可直接选课与课次', document.querySelector('[aria-label="哪门课"]') !== null, '');
  if (clickByText(document.body, '调休')) await flush(8);
  check(
    '调休为指定两天',
    document.querySelector('[aria-label="把哪一天的课表"]') !== null &&
      document.querySelector('[aria-label="调到哪一天上"]') !== null,
    '',
  );
  if (clickByText(document.body, '临时加课')) await flush(8);
  check('临时加课可自定义名称', document.querySelector('[aria-label="或自定义课程名称"]') !== null, '');
  if (clickByText(document.body, '取消')) await flush(6);

  const switchedToSettings = clickByText(view.container, '设置');
  await flush(10);
  const settingsText = view.container.textContent ?? '';
  check(
    '切到设置页',
    switchedToSettings &&
      settingsText.includes('外观') &&
      settingsText.includes('小组件背景') &&
      !settingsText.includes('导出日志'),
    settingsText.slice(0, 60),
  );

  // 「?」说明入口：设置项正文只留短句，补充说明点开可见
  const helpButton = view.container.querySelector<HTMLElement>('[aria-label="说明：周视图天数"]');
  helpButton?.click();
  await flush(10);
  const helpBody = document.querySelector('[data-role="help-body"]');
  check(
    '设置项说明收进「?」，点开可见',
    helpButton !== null && helpBody !== null && (helpBody.textContent ?? '').includes('列宽按屏宽等分'),
    helpBody?.textContent?.trim() ?? '(未打开)',
  );
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(6);

  // —— 预设版本与更新：内置兜底 + 运行时下载缓存 + 失败回退（全程用注入的假 fetch，不联网） ——
  await flush(8);
  const presetVersionLine = (): string =>
    (view.container.querySelector('[data-role="preset-version"]')?.textContent ?? '').trim();
  const presetResultLine = (): string =>
    (view.container.querySelector('[data-role="preset-result"]')?.textContent ?? '').trim();
  const presetButton = view.container.querySelector('button[aria-label="检查预设更新"]');
  check(
    '设置页显示当前预设版本（内置）',
    presetVersionLine().includes('预设版本：') &&
      presetVersionLine().includes(BUILTIN_PRESET_VERSION) &&
      presetVersionLine().includes('（内置）'),
    presetVersionLine(),
  );
  check('设置页提供检查预设更新按钮', presetButton instanceof window.HTMLElement, presetVersionLine());

  const realFetch = globalThis.fetch;
  /** ② 里下载到的版本号；块外（③④ 校验缓存与启动套用）还要用。 */
  let nextVersion = '';
  const stubFetch = (impl: (url: string) => Promise<Response>): void => {
    Object.defineProperty(globalThis, 'fetch', {
      value: (input: unknown) => impl(String(input)),
      configurable: true,
      writable: true,
    });
  };
  try {
    // ① 离线/请求失败：只给可读提示，界面与内置预设都不受影响
    stubFetch(async () => {
      throw new Error('offline');
    });
    if (presetButton instanceof window.HTMLElement) presetButton.click();
    await flush(14);
    check(
      '检查预设更新离线时给出可读提示',
      presetResultLine().includes('检查失败：无法连接预设源'),
      presetResultLine(),
    );

    // ② 有更新：下载 → 校验哈希 → 写入缓存，提示「下次启动生效」，版本行改为已更新
    nextVersion = '1.1.0';
    stubFetch(async (url) => {
      if (url === PRESET_VERSION_URL) {
        return presetJsonResponse({ version: nextVersion, schemaVersion: 1, generatedAt: '2026-02-01T00:00:00.000Z' });
      }
      if (url === PRESET_SNAPSHOT_URL(nextVersion)) return presetJsonResponse(fakePresetSnapshot(nextVersion));
      return presetJsonResponse({}, false, 404);
    });
    if (presetButton instanceof window.HTMLElement) presetButton.click();
    await flush(18);
    check(
      '检查预设更新可下载并缓存新版本（下次启动生效）',
      presetResultLine().includes(`已下载预设 ${nextVersion}`) &&
        presetResultLine().includes('下次启动生效') &&
        presetVersionLine().includes(`${nextVersion}（已更新）`),
      `${presetResultLine()} / ${presetVersionLine()}`,
    );

    // ③ 索引来自快照：预设仓库已取消 presets/index.json，索引就是快照的 index 字段，
    //    所以「拿到一份通过校验的快照」就该能直接取出学校/系统目录，且路径指向 school.json。
    const downloaded = fakePresetSnapshot(nextVersion);
    let indexSchools = -1;
    let indexPathShapeOk = false;
    let indexProblem = '';
    try {
      const index = presetIndexFromSnapshot(downloaded);
      indexSchools = index.schools.length;
      indexPathShapeOk =
        index.schools.every((school) => school.timetablePath.endsWith('/school.json')) &&
        index.systems.every((system) => system.id.length > 0);
    } catch (cause) {
      indexProblem = cause instanceof Error ? cause.message : String(cause);
    }
    check(
      '预设索引取自快照内嵌的 index（不再单独请求 presets/index.json）',
      indexSchools > 0 && indexPathShapeOk,
      indexProblem === '' ? `学校 ${indexSchools} 个` : indexProblem,
    );
  } finally {
    Object.defineProperty(globalThis, 'fetch', { value: realFetch, configurable: true, writable: true });
  }

  /*
    ④ 下载后的快照带正文：下载这一步就该把正文一并校验并缓存（`presets_content_v1`），
    否则「下次启动生效」永远没有正文可用。这里直接读缓存确认它确实落了盘。
  */
  const seedStorage = validatedStorage(await openIndexedDbStorage());
  const cachedBody = await seedStorage.readMeta(PRESET_CONTENT_META_KEY);
  check(
    '下载时把预设正文一并写入缓存',
    cachedBody !== undefined && cachedBody.includes(CACHE_TIMETABLE_NAME) && cachedBody.includes(`${nextVersion}`),
    (cachedBody ?? '(空)').slice(0, 60),
  );

  // ⑤ 启动套用：把缓存正文直接塞进 app_meta 再挂载，验证「启动时套用缓存」这条链路真的通了
  //    先清掉覆盖层（前一步的下载按约定不在运行时生效），保证下面看到的差异来自启动套用
  setPresetOverride(null);
  await seedStorage.writeMeta(PRESET_CONTENT_META_KEY, JSON.stringify(fakePresetContent(nextVersion)));
  const reborn = mount(<App />);
  await flush(20);
  check(
    '启动时若有更高版本缓存则使用缓存预设',
    effectivePresetVersion() === nextVersion &&
      findTimetable(CACHE_TIMETABLE_ID)?.name === CACHE_TIMETABLE_NAME,
    `版本=${effectivePresetVersion()} / 作息=${findTimetable(CACHE_TIMETABLE_ID)?.name ?? '(无)'}`,
  );
  check(
    '启动套用后界面读数仍与缓存一致（周视图照常渲染）',
    (reborn.container.textContent ?? '').includes('高数'),
    (reborn.container.textContent ?? '').slice(0, 60),
  );
  // 收尾：还原成内置，免得后面重挂载的用例看到「被换过的预设」
  setPresetOverride(null);
  await seedStorage.writeMeta(PRESET_CONTENT_META_KEY, '');
  await seedStorage.writeMeta(PRESET_SNAPSHOT_META_KEY, '');
  reborn.root.unmount();

  const switchedToTimeline = clickByText(view.container, '课表');
  await flush(10);
  const searchButton = view.container.querySelector('button[aria-label="搜索"]');
  if (searchButton instanceof HTMLElement) searchButton.click();
  await flush(8);
  check('搜索弹窗渲染', (document.body.textContent ?? '').includes('输入关键词开始搜索'), '');
  check('回到课表', switchedToTimeline, '');

  // 导入是课程管理的子项：导航里没有「导入」，设置页的课程管理卡片里能展开
  clickByText(view.container, '设置');
  await flush(12);
  const settingsActions = view.container.querySelector<HTMLElement>('[data-role="settings-actions"]');
  check(
    '设置页顶部提供四个快捷动作',
    settingsActions !== null &&
      ['导入课表', '导出备份', '恢复快照', '检查更新'].every((label) =>
        (settingsActions.textContent ?? '').includes(label),
      ),
    (settingsActions?.textContent ?? '(无)').trim(),
  );
  if (settingsActions !== null && clickByText(settingsActions, '导入课表')) await flush(12);
  check('快捷动作直接打开导入向导', document.querySelector('[aria-label="导入步骤"]') !== null, '');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(8);
  const courseImport = view.container.querySelector('[data-role="course-import"]');
  const importSummary = view.container.querySelector('[aria-label="导入课表"]');
  if (importSummary instanceof window.HTMLElement) importSummary.click();
  await flush(12);
  const importText = view.container.textContent ?? '';
  check(
    '导入作为课程管理的子项',
    courseImport !== null && importText.includes('导入课表') && importText.includes('网页课表'),
    courseImport === null ? '未找到导入子项' : '导入子项在课程管理里',
  );
  check('已移除程序代登录入口', !importText.includes('正方教务') && !importText.includes('程序代登录'), '');
  check(
    '新增「我的」页面且显示建设中',
    [...view.container.querySelectorAll('button')].some((node) => (node.textContent ?? '').trim() === '我的'),
    '',
  );
  if (clickByText(view.container, '我的')) await flush(10);
  check('「我的」页面为建设中占位', (view.container.textContent ?? '').includes('建设中'), '');
  if (clickByText(view.container, '设置')) await flush(10);

  if (clickByTextStart(view.container, '网页课表')) await flush(10);
  check(
    '网页导入提供书签与粘贴',
    view.container.querySelector('textarea[aria-label="书签小工具代码"]') !== null &&
      view.container.querySelector('textarea[aria-label="粘贴课表页面内容"]') !== null &&
      (view.container.textContent ?? '').includes('识别并预览') &&
      (view.container.textContent ?? '').includes('1. 安装书签'),
    '',
  );

  const schoolInput = view.container.querySelector('input[aria-label="搜索学校"]');
  check('学校检索为可搜索下拉框', schoolInput instanceof window.HTMLInputElement, '');
  check('教务系统为下拉框', view.container.querySelector('[aria-label="教务系统"]') !== null, '');
  if (schoolInput instanceof window.HTMLInputElement) {
    setInputValue(schoolInput, '苏州');
    await flush(12);
    const options = [...view.container.querySelectorAll('[role="option"]')];
    check(
      '下拉候选含苏州的学校',
      options.some((item) => (item.textContent ?? '').includes('苏州科技大学')),
      '',
    );
    const target = options.find((item) => (item.textContent ?? '').includes('苏州科技大学'));
    if (target instanceof window.HTMLElement) target.click();
    await flush(10);
    const entryBox = view.container.querySelector('input[aria-label="入口地址"]');
    check(
      '选中学校后填入教务入口',
      entryBox instanceof window.HTMLInputElement && entryBox.value.includes('jwgl.usts.edu.cn'),
      entryBox instanceof window.HTMLInputElement ? entryBox.value : '',
    );
  }

  // —— 学校选择器（SchoolPicker）：筛选行、省份分组、搜索、985 筛选、适配徽标与请求适配入口 ——
  const picker = view.container.querySelector('[data-role="school-picker"]');
  const schoolRows = (): HTMLElement[] => [
    ...view.container.querySelectorAll<HTMLElement>('[data-role="school-row"]'),
  ];
  const schoolRowTexts = (): string[] => schoolRows().map((row) => (row.textContent ?? '').trim());
  const schoolCountText = (): string =>
    (view.container.querySelector('[data-role="school-count"]')?.textContent ?? '').trim();

  if (schoolInput instanceof window.HTMLInputElement) setInputValue(schoolInput, '');
  await flush(10);
  const provinceGroups = [...view.container.querySelectorAll('[data-role="school-group"]')].map(
    (group) => group.getAttribute('data-province') ?? '',
  );
  check(
    '学校选择器渲染筛选行与省份分组',
    picker !== null &&
      view.container.querySelector('button[aria-label="筛选 985"]') !== null &&
      view.container.querySelector('button[aria-label="筛选 211"]') !== null &&
      view.container.querySelector('button[aria-label="筛选 双一流"]') !== null &&
      view.container.querySelector('[aria-label="地区"]') !== null &&
      view.container.querySelector('[data-role="request-school-form"]') !== null &&
      provinceGroups.length >= 2,
    `分组 ${provinceGroups.length} 个：${provinceGroups.slice(0, 4).join(' / ')}`,
  );

  const searchBox = view.container.querySelector<HTMLInputElement>('input[aria-label="搜索学校"]');
  if (searchBox !== null) setInputValue(searchBox, '清华');
  await flush(12);
  const qinghuaRow = schoolRows().find((row) => (row.textContent ?? '').includes('清华大学'));
  check(
    '学校选择器搜索清华命中清华大学',
    qinghuaRow !== undefined && schoolRowTexts().length > 0 && schoolCountText().includes('共 2 所'),
    `${schoolCountText()} / ${schoolRowTexts()[0] ?? '(空)'}`,
  );
  const requestLink = qinghuaRow?.querySelector<HTMLAnchorElement>('[data-role="request-school"]');
  check(
    '未适配学校显示暂未适配并给出请求适配链接',
    qinghuaRow?.getAttribute('data-adapted') === 'false' &&
      (qinghuaRow?.textContent ?? '').includes('暂未适配') &&
      requestLink instanceof window.HTMLAnchorElement &&
      (requestLink.getAttribute('href') ?? '').includes('template=request-school.yml') &&
      decodeURIComponent(requestLink.getAttribute('href') ?? '').includes('清华大学'),
    requestLink?.getAttribute('href') ?? '(没有链接)',
  );

  // 内置链接：点击不在应用内打开，先弹确认框，确认后交默认浏览器或复制链接
  const openedUrls: string[] = [];
  const originalOpen = window.open;
  Object.defineProperty(window, 'open', {
    configurable: true,
    writable: true,
    value: ((...args: unknown[]) => {
      openedUrls.push(String(args[0] ?? ''));
      return { closed: false } as unknown as Window;
    }) as typeof window.open,
  });
  const linkUrlBox = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('[data-role="external-link-url"]');
  const requestLinkElement = requestLink as unknown as HTMLElement | null;
  requestLinkElement?.click();
  await flush(10);
  check(
    '内置链接点击先弹确认框而不直接打开',
    openedUrls.length === 0 &&
      linkUrlBox() !== null &&
      (document.body.textContent ?? '').includes('用默认浏览器打开') &&
      (document.body.textContent ?? '').includes('复制链接'),
    `已打开 ${openedUrls.length} 次 / 地址框=${linkUrlBox() === null ? '无' : '有'}`,
  );
  check(
    '确认框地址与链接一致',
    (linkUrlBox()?.value ?? '').includes('template=request-school.yml') &&
      decodeURIComponent(linkUrlBox()?.value ?? '').includes('清华大学'),
    linkUrlBox()?.value ?? '(无)',
  );
  let copiedLink = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { copiedLink = text; } },
  });
  document.querySelector<HTMLElement>('[data-role="external-link-copy"]')?.click();
  await flush(12);
  check(
    '复制链接写入剪贴板并关闭确认框',
    copiedLink.includes('template=request-school.yml') &&
      openedUrls.length === 0 &&
      linkUrlBox() === null &&
      (document.body.textContent ?? '').includes('已复制链接'),
    `剪贴板=${copiedLink === '' ? '(空)' : '已写入'} / 已打开 ${openedUrls.length} 次`,
  );
  requestLinkElement?.click();
  await flush(10);
  document.querySelector<HTMLElement>('[data-role="external-link-open"]')?.click();
  await flush(12);
  check(
    '确认后交给浏览器打开并关闭确认框',
    openedUrls.length === 1 &&
      openedUrls[0].includes('template=request-school.yml') &&
      linkUrlBox() === null &&
      (document.body.textContent ?? '').includes('已在默认浏览器打开'),
    `已打开 ${openedUrls.join('、') || '(无)'}`,
  );
  Object.defineProperty(window, 'open', { configurable: true, writable: true, value: originalOpen });

  const qinghuaBadge = (qinghuaRow?.querySelector('[data-role="school-badge"]')?.textContent ?? '').trim();
  const qinghuaLabel = qinghuaRow?.getAttribute('aria-label') ?? '';
  check(
    '未适配徽标为文字态且不含符号',
    qinghuaBadge === '暂未适配' && /^[^\p{Emoji_Presentation}]*$/u.test(qinghuaBadge) && qinghuaLabel.endsWith('，暂未适配'),
    `徽标=${qinghuaBadge} / aria-label=${qinghuaLabel}`,
  );

  if (searchBox !== null) setInputValue(searchBox, '');
  await flush(10);
  view.container.querySelector<HTMLElement>('button[aria-label="筛选 985"]')?.click();
  await flush(10);
  check(
    '985 筛选只保留 985 院校',
    schoolCountText().includes('共 39 所') &&
      schoolRows().some((row) => (row.textContent ?? '').includes('清华大学')) &&
      !schoolRows().some((row) => (row.textContent ?? '').includes('苏州大学')),
    schoolCountText(),
  );

  view.container.querySelector<HTMLElement>('button[aria-label="筛选 全部"]')?.click();
  await flush(8);
  view.container.querySelector<HTMLElement>('[aria-label="地区"]')?.click();
  await flush(10);
  const provinceOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => (item.textContent ?? '').trim() === '江苏省',
  );
  check(
    '地区下拉按 listProvinces 列出省份',
    provinceOption !== undefined && (document.body.textContent ?? '').includes('北京市'),
    provinceOption?.textContent ?? '(没有省份选项)',
  );
  if (provinceOption !== undefined) {
    provinceOption.click();
    await flush(12);
  }
  check(
    '地区筛选生效（江苏省）',
    schoolCountText().includes('共 167 所') && schoolCountText().includes('江苏省'),
    schoolCountText(),
  );

  if (searchBox !== null) setInputValue(searchBox, '苏州');
  await flush(12);
  schoolRows()
    .find((row) => (row.textContent ?? '').includes('苏州科技大学'))
    ?.click();
  await flush(16);
  const pickedRow = schoolRows().find((row) => (row.textContent ?? '').includes('苏州科技大学'));
  const entryBoxAgain = view.container.querySelector<HTMLInputElement>('input[aria-label="入口地址"]');
  check(
    '选中学校后导入入口 URL 反映该校',
    (view.container.querySelector('[data-role="school-picked"]')?.textContent ?? '').includes('苏州科技大学') &&
      entryBoxAgain?.value.includes('jwgl.usts.edu.cn') === true &&
      pickedRow?.getAttribute('data-adapted') === 'true' &&
      pickedRow?.getAttribute('data-picked') === 'true' &&
      (pickedRow?.textContent ?? '').includes('已适配'),
    `${(view.container.querySelector('[data-role="school-picked"]')?.textContent ?? '').trim()} / ${
      entryBoxAgain?.value ?? ''
    }`,
  );

  const pasteBox = view.container.querySelector('textarea[aria-label="粘贴课表页面内容"]');
  if (pasteBox instanceof window.HTMLTextAreaElement) {
    setInputValue(pasteBox, PAGE_SAMPLE);
    await flush(6);
    if (clickByText(view.container, '识别并预览')) await flush(22);
  }
  check('网页识别进入预览', (view.container.textContent ?? '').includes('解析到'), '');

  // 手动校正映射：换成星期表头样例，指定表头行与星期列
  if (clickByText(view.container, '返回')) await flush(10);
  const pasteBoxSecond = view.container.querySelector('textarea[aria-label="粘贴课表页面内容"]');
  if (pasteBoxSecond instanceof window.HTMLTextAreaElement) {
    setInputValue(pasteBoxSecond, PAGE_WEEKDAY_SAMPLE);
    await flush(6);
  }
  const mappingSummary = [...view.container.querySelectorAll('summary')].find((item) =>
    (item.textContent ?? '').includes('手动指定表格'),
  );
  check('提供手动校正映射入口', mappingSummary !== undefined, '');
  if (mappingSummary instanceof HTMLElement) mappingSummary.click();
  await flush(8);
  if (clickByText(view.container, '读取页面表格')) await flush(10);
  check('页面表格预览可读', (view.container.textContent ?? '').includes('星期一'), '');
  if (clickByText(view.container, '按此映射识别')) await flush(22);
  check('按手动映射识别成功', (view.container.textContent ?? '').includes('解析到'), '');

  if (clickByText(document.body, '取消') === false) {
    // 弹窗没有取消按钮时直接继续，不影响后续断言
  }
  await flush(4);

  clickByText(view.container, '设置');
  await flush(10);

  const startInputs = (root: HTMLElement): HTMLInputElement[] =>
    [...root.querySelectorAll('input[aria-label$="节开始时间"]')].filter(
      (item): item is HTMLInputElement => item instanceof window.HTMLInputElement,
    );
  const panelText = view.container.textContent ?? '';
  check(
    '时间表与课程管理渲染',
    panelText.includes('时间表') && panelText.includes('课程管理') && panelText.includes('高数'),
    '',
  );
  check('课程管理提供编辑与删除', hasLabel(view.container, '编辑课程') && hasLabel(view.container, '删除课程'), '');
  if (clickByLabel(view.container, '编辑课程')) await flush(12);
  check(
    '课程表单可点选周次',
    document.querySelector('[aria-label="第 1 周"]') !== null &&
      document.querySelector('[aria-label="周次单周"]') !== null &&
      document.querySelector('[aria-label="周次双周"]') !== null,
    '',
  );
  if (clickByText(document.body, '取消')) await flush(6);
  check(
    '默认关着开发者特性：诊断入口不显示，也没有示例数据按钮',
    !panelText.includes('导出日志') && !panelText.includes('填充示例数据'),
    '',
  );
  check(
    '维护卡带自动检查更新开关',
    view.container.querySelector('[aria-label="自动检查版本更新"]') !== null &&
      view.container.querySelector('[aria-label="自动检查版本更新"]')?.getAttribute('aria-checked') === 'true',
    view.container.querySelector('[aria-label="自动检查版本更新"]')?.getAttribute('aria-checked') ?? '(无开关)',
  );
  // 开发者特性：默认关，打开后诊断入口出现、关掉后又隐藏
  const devSwitch = view.container.querySelector('[aria-label="开发者特性"]');
  check(
    '开发者特性开关默认关闭',
    devSwitch !== null && devSwitch.getAttribute('aria-checked') === 'false',
    devSwitch === null ? '(无开关)' : String(devSwitch.getAttribute('aria-checked')),
  );
  check(
    '关着开发者特性时诊断入口隐藏',
    view.container.querySelector('[aria-label="打开日志文件所在目录"]') === null &&
      !(view.container.textContent ?? '').includes('导出日志'),
    '',
  );
  if (devSwitch instanceof window.HTMLElement) devSwitch.click();
  await flush(12);
  check(
    '打开开发者特性后诊断入口出现',
    (view.container.textContent ?? '').includes('导出日志'),
    '',
  );
  const devSwitchBack = view.container.querySelector('[aria-label="开发者特性"]');
  if (devSwitchBack instanceof window.HTMLElement) devSwitchBack.click();
  await flush(12);
  check(
    '再关掉开发者特性后诊断入口恢复隐藏',
    view.container.querySelector('[aria-label="打开日志文件所在目录"]') === null,
    '',
  );
  // 时区与待办排序都是选择列表
  const zoneTrigger = view.container.querySelector('[aria-label="时区"]');
  if (zoneTrigger instanceof window.HTMLElement) zoneTrigger.click();
  await flush(10);
  const zoneOptions = [...document.querySelectorAll('[role="option"]')].map((item) => (item.textContent ?? '').trim());
  check(
    '时区改为选择列表且默认上海',
    zoneTrigger !== null && zoneOptions.includes('Asia/Shanghai') && zoneOptions.includes('UTC'),
    `候选 ${zoneOptions.length} 项`,
  );
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(6);
  const sortTrigger = view.container.querySelector('[aria-label="待办排序"]');
  if (sortTrigger instanceof window.HTMLElement) sortTrigger.click();
  await flush(10);
  const sortOptions = [...document.querySelectorAll('[role="option"]')].map((item) => (item.textContent ?? '').trim());
  check(
    '待办排序可选按开始时间与按类型',
    sortTrigger !== null &&
      sortOptions.some((item) => item.includes('按开始时间')) &&
      sortOptions.some((item) => item.includes('按类型')),
    sortOptions.join(' / ') || '(无候选)',
  );
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(6);
  // 应用诊断日志：开关 + 级别（dev 默认最详细）
  const logBlock = view.container.querySelector('[data-role="log-settings"]');
  const logLevelTrigger = view.container.querySelector('[aria-label="日志级别"]');
  if (logLevelTrigger instanceof window.HTMLElement) logLevelTrigger.click();
  await flush(10);
  const logLevels = [...document.querySelectorAll('[role="option"]')].map((item) => (item.textContent ?? '').trim());
  check(
    '应用诊断日志：开关、级别五档且 dev 默认 trace',
    logBlock !== null &&
      view.container.querySelector('[aria-label="启用应用诊断日志"]')?.getAttribute('aria-checked') === 'true' &&
      view.container.querySelector('[aria-label="打开日志"]') !== null &&
      logLevels.length === 5 &&
      logLevels.some((item) => item.startsWith('trace')) &&
      (logLevelTrigger?.textContent ?? '').trim() === 'trace',
    `级别候选 ${logLevels.length} 项，当前 ${(logLevelTrigger?.textContent ?? '').trim()}`,
  );
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(6);
  check('课程管理提供复制课程', view.container.querySelector('[aria-label^="复制课程"]') !== null, '');
  // 周视图天数：1–7 天都可选
  const dayTrigger = view.container.querySelector('[aria-label="周视图天数"]');  if (dayTrigger instanceof window.HTMLElement) dayTrigger.click();
  await flush(10);
  const dayOptions = [...document.querySelectorAll('[role="option"]')].map((item) => (item.textContent ?? '').trim());
  const dayOptionSet = new Set(dayOptions.filter((item) => item.endsWith(' 天')));
  check(
    '周视图天数可选 1–7 天',
    dayTrigger !== null &&
      dayOptions.length >= 7 &&
      ['1 天', '4 天', '7 天'].every((label) => dayOptionSet.has(label)),
    dayOptions.join(' / ') || '(无候选)',
  );
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(6);
  // 课表视图开关：今天为第一天（默认开）、始终不显示周末（默认关）
  const switchOf = (label: string): HTMLElement | null =>
    view.container.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
  check(
    '课表视图开关默认：今天为第一天开、不显示周末关',
    switchOf('今天为第一天')?.getAttribute('aria-checked') === 'true' &&
      switchOf('始终不显示周末')?.getAttribute('aria-checked') === 'false',
    `${switchOf('今天为第一天')?.getAttribute('aria-checked')} / ${switchOf('始终不显示周末')?.getAttribute('aria-checked')}`,
  );
  // 打开「始终不显示周末」：列数仍按天数，但列里不再出现周六/周日
  switchOf('始终不显示周末')?.click();
  await flush(16);
  clickByText(view.container, '课表');
  await flush(16);
  const columnDays = [...view.container.querySelectorAll('[data-day]')].map((node) =>
    node.getAttribute('data-day'),
  );
  check(
    '不显示周末后课表列里没有周六日',
    columnDays.length === 7 && !columnDays.includes('6') && !columnDays.includes('7'),
    `列=${columnDays.join(',')}`,
  );
  clickByText(view.container, '设置');
  await flush(16);
  check(
    '回到设置页可见两个视图开关',
    switchOf('始终不显示周末') !== null && switchOf('今天为第一天') !== null,
    `${switchOf('始终不显示周末') === null ? '无周末开关' : '有'} / ${switchOf('今天为第一天') === null ? '无首日开关' : '有'}`,
  );
  switchOf('始终不显示周末')?.click();
  await flush(16);
  check(
    '关掉不显示周末后开关状态回关',
    switchOf('始终不显示周末')?.getAttribute('aria-checked') === 'false',
    `${switchOf('始终不显示周末')?.getAttribute('aria-checked')}`,
  );
  // 关掉「今天为第一天」：窗口从本周周一开头
  switchOf('今天为第一天')?.click();
  await flush(16);
  check(
    '关掉今天为第一天后开关状态回关',
    switchOf('今天为第一天')?.getAttribute('aria-checked') === 'false',
    `${switchOf('今天为第一天')?.getAttribute('aria-checked')}`,
  );
  clickByText(view.container, '课表');
  await flush(16);
  check(
    '关掉今天为第一天后窗口从本周周一开头',
    windowStartOf() === seededMonday,
    `${windowStartOf()} / 本周周一 ${seededMonday}`,
  );
  clickByText(view.container, '设置');
  await flush(16);
  switchOf('今天为第一天')?.click();
  await flush(16);
  clickByText(view.container, '课表');
  await flush(16);
  check(
    '恢复默认后窗口重新从今天开头',
    windowStartOf() === todayText,
    windowStartOf(),
  );
  // 顶部栏只属于课表页；日模式把「第 N 周」换成日期翻页
  check('课表页顶部栏是周次翻页', view.container.querySelector('[data-role="week-nav"]') !== null, '');
  // 课程标签跟在课程名后面：同一个文本容器里既有课名又有「非本周」
  const ghostNameLine = view.container.querySelector('[data-tone="ghost"]')?.firstElementChild ?? null;
  check(
    '课程卡标签紧跟课程名',
    ghostNameLine !== null &&
      ghostNameLine.tagName === 'SPAN' &&
      (ghostNameLine.textContent ?? '').includes('大物') &&
      (ghostNameLine.textContent ?? '').includes('非本周') &&
      ghostNameLine.querySelector('span') !== null &&
      !ghostNameLine.className.includes('justify-between'),
    (ghostNameLine?.textContent ?? '(无)').trim(),
  );
  // 行高按卡片内容一次定高：卡片要带节次数，行高才量得出来
  const lessonCells = [...view.container.querySelectorAll('[data-role="lesson-cell"]')];
  check(
    '课表卡片带节次数供行高换算',
    lessonCells.length > 0 &&
      lessonCells.every((cell) => Number(cell.getAttribute('data-span') ?? '0') >= 1),
    `${lessonCells.length} 张`,
  );
  clickTab(view.container, '日');
  await flush(12);
  const dayDateText = (): string => (view.container.querySelector('[data-role="day-date"]')?.textContent ?? '').trim();
  check(
    '日模式换成日期翻页',
    view.container.querySelector('[data-role="day-nav"]') !== null &&
      view.container.querySelector('[data-role="week-nav"]') === null &&
      dayDateText() === '10/18 周日',
    dayDateText(),
  );
  if (clickByLabel(view.container, '后一天')) await flush(12);
  check('日模式翻到下一天', dayDateText() === '10/19 周一', dayDateText());
  if (clickByLabel(view.container, '前一天')) await flush(12);
  check('日模式翻回前一天', dayDateText() === '10/18 周日', dayDateText());
  check(
    '日视图按查看日期显示课表',
    (view.container.querySelector('[aria-label="日视图"]')?.textContent ?? '').includes('节课'),
    (view.container.querySelector('[aria-label="日视图"]')?.textContent ?? '(无)').slice(0, 40),
  );
  if (clickByLabel(view.container, '回到今天')) await flush(12);
  check('日模式回到今天', dayDateText() === '10/18 周日', dayDateText());
  clickTab(view.container, '周');
  await flush(12);
  check(
    '切回周模式恢复周次翻页',
    view.container.querySelector('[data-role="week-nav"]') !== null &&
      view.container.querySelector('[data-role="day-nav"]') === null,
    '',
  );
  clickByText(view.container, '日程');
  await flush(12);
  check('日程页不显示课表顶部栏', view.container.querySelector('[data-role="window-nav"]') === null, '');
  clickByText(view.container, '设置');
  await flush(12);
  check('设置页不显示课表顶部栏', view.container.querySelector('[data-role="window-nav"]') === null, '');
  clickByText(view.container, '课表');
  await flush(12);
  clickByText(view.container, '设置');
  await flush(16);
  check(
    '课次时间可逐节编辑',
    view.container.querySelector('input[aria-label="第 1 节开始时间"]') !== null &&
      view.container.querySelector('input[aria-label="第 1 节结束时间"]') !== null,
    '',
  );
  // 每节时长 / 课间 恢复为可见设置：它们是「从这一节起顺延重排」用的时长与课间
  const timetableHeader = view.container.querySelector('button[aria-label^="时间表"]');
  const timetableCard: Element = timetableHeader?.parentElement ?? view.container;
  const durationInput = view.container.querySelector<HTMLInputElement>('input[aria-label="每节时长（分钟）"]');
  const breakInput = view.container.querySelector<HTMLInputElement>('input[aria-label="课间（分钟）"]');
  check(
    '时间表恢复每节时长与课间输入',
    durationInput !== null &&
      breakInput !== null &&
      durationInput.value === '45' &&
      breakInput.value === '10' &&
      durationInput.min === '10' &&
      durationInput.max === '240' &&
      breakInput.min === '0' &&
      breakInput.max === '120' &&
      timetableCard.contains(durationInput) &&
      timetableCard.contains(breakInput) &&
      (timetableCard.textContent ?? '').includes('课间'),
    `时长=${durationInput?.value}（${durationInput?.min}-${durationInput?.max}）课间=${breakInput?.value}（${breakInput?.min}-${breakInput?.max}）`,
  );

  // 作息预设：默认选中内置默认作息，下拉是可搜索的列表（输入即筛选）
  const defaultPreset = findTimetable(DEFAULT_TIMETABLE_ID);
  const presetInput = view.container.querySelector<HTMLInputElement>('input[aria-label="作息预设"]');
  check(
    '作息预设默认选中内置默认作息',
    defaultPreset !== undefined &&
      defaultPreset.periods.length > 0 &&
      presetInput !== null &&
      presetInput.placeholder === defaultPreset.name &&
      BUILTIN_TIMETABLES.length >= 1 &&
      BUILTIN_TIMETABLES.some((preset) => preset.periods.length >= 10),
    `占位=${presetInput?.placeholder ?? '(无)'} / 内置 ${BUILTIN_TIMETABLES.length} 套`,
  );

  // 套用苏科大作息：时间表照抄预设课次，时长/课间同步成预设里最常见的 45 / 10
  const periodClock = (period: number, field: '开始' | '结束'): string =>
    view.container.querySelector<HTMLInputElement>(`input[aria-label="第 ${period} 节${field}时间"]`)?.value ?? '';
  // 先把两个输入改成别的值，才能证明套用预设时确实把它们同步了回来
  if (durationInput !== null) setInputValue(durationInput, '50');
  if (breakInput !== null) setInputValue(breakInput, '5');
  await flush(8);
  const presetOptionTexts = (): string[] =>
    [...document.querySelectorAll('[role="option"]')].map((item) => (item.textContent ?? '').trim());
  let presetPicked = false;
  if (presetInput !== null) {
    // 搜索框聚焦即展开候选；先按关键词收敛，再点中那一行
    presetInput.focus();
    setInputValue(presetInput, '苏州');
    await flush(8);
    const filtered = presetOptionTexts();
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
      (item.textContent ?? '').includes('苏州科技大学'),
    );
    check(
      '作息预设可按关键词搜索',
      filtered.length > 0 && filtered.every((item) => item.includes('苏州')) && option !== undefined,
      filtered.join(' / ') || '(无候选)',
    );
    if (option !== undefined) {
      option.click();
      presetPicked = true;
    }
    await flush(8);
  }
  const presetApplied = clickByText(view.container, '套用此作息');
  await flush(24);
  const presetSummary = (view.container.querySelector('[data-role="preset-summary"]')?.textContent ?? '').trim();
  check(
    '作息预设可套用为苏州科技大学 14 节',
    presetPicked &&
      presetApplied &&
      startInputs(view.container).length === 14 &&
      periodClock(3, '开始') === '09:55' &&
      periodClock(3, '结束') === '10:40' &&
      durationInput?.value === '45' &&
      breakInput?.value === '10' &&
      presetSummary.includes('预设：') &&
      presetSummary.includes('（14 节）'),
    `第 3 节 ${periodClock(3, '开始')}–${periodClock(3, '结束')}，共 ${startInputs(view.container).length} 节，${presetSummary}`,
  );

  const hadAppearance = (view.container.textContent ?? '').includes('主题风格');
  if (clickByAriaPrefix(view.container, '外观')) await flush(8);
  const collapsedAppearance = !(view.container.textContent ?? '').includes('主题风格');
  check('设置项可收起', hadAppearance && collapsedAppearance, '');
  if (clickByAriaPrefix(view.container, '外观')) await flush(8);
  check('设置项可再展开', (view.container.textContent ?? '').includes('主题风格'), '');
  check(
    '非本周课程开关存在',
    view.container.querySelector('[aria-label="周视图显示非本周课程"]') !== null,
    '',
  );
  check(
    '课前提醒默认提前 20 分钟',
    view.container.querySelector('[aria-label="课前提醒"]') !== null &&
      view.container.querySelector('[aria-label="提前 20 分钟"]') !== null,
    '',
  );
  check(
    '倒计时可开关',
    view.container.querySelector('[aria-label="开学倒计时"]') !== null &&
      view.container.querySelector('[aria-label="假期倒计时"]') !== null,
    '',
  );
  check('悬浮窗样式可选四种', view.container.querySelector('[aria-label="悬浮窗样式"]') !== null, '');
  check(
    '手机端小组件清单与引导只在 Android 出现',
    MOBILE_WIDGETS.length === 4 &&
      MOBILE_WIDGETS.every((item) => item.size.length > 0 && item.description.length > 0) &&
      WIDGET_PIN_STEPS.length === 3 &&
      hasMobileWidgets() === false &&
      view.container.querySelector('[data-role="mobile-widget-guide"]') === null &&
      view.container.querySelector('[aria-label="悬浮窗样式"]') !== null,
    `组件 ${MOBILE_WIDGETS.map((item) => item.size).join(' / ')}；Web 平台=${hasMobileWidgets() ? '手机' : '桌面/浏览器'}`,
  );
  const desktopPin = await pinWidget('next');
  check(
    '非安卓平台请求小组件按不支持处理',
    desktopPin.status === 'unsupported',
    desktopPin.status,
  );
  // 卡片布局入口固定在设置页顶部，面板在对话框里：隐藏卡片后仍能改回来
  const layoutOpened = clickByLabel(view.container, '卡片布局');
  await flush(12);
  const layoutTitles = [
    ...document.querySelectorAll('[data-role="dialog-body"] span'),
  ].map((item) => (item.textContent ?? '').trim());
  check(
    '卡片布局独立成对话框，可显隐排序并一键全部显示',
    layoutOpened &&
      document.querySelector('[aria-label="显示卡片：日程时间线"]') !== null &&
      document.querySelector('[aria-label="上移卡片：倒计时"]') !== null &&
      document.querySelector('[aria-label="卡片区域：日程时间线：主列"]') !== null &&
      document.querySelector('[aria-label="恢复默认布局"]') !== null &&
      document.querySelector('[aria-label="全部显示卡片"]') !== null &&
      layoutTitles.filter((title) => title.includes('倒计时')).length === 1 &&
      !layoutTitles.includes('日期与倒计时'),
    `倒计时相关卡片 ${layoutTitles.filter((title) => title.includes('倒计时')).length} 张`,
  );
  if (clickByLabel(document.body, '关闭卡片布局')) await flush(8);
  // 更新与维护卡片：检查更新、发布页、预设版本与仓库、运行权限在同一张卡片里
  const presetRepoLink = view.container.querySelector('[data-role="preset-repo-link"]');
  const presetRepoHref = presetRepoLink instanceof window.HTMLAnchorElement ? presetRepoLink.href : '';
  const presetRepoOpensOutside =
    presetRepoLink instanceof window.HTMLAnchorElement &&
    presetRepoLink.target === '_blank' &&
    /\bnoopener\b/.test(presetRepoLink.rel);
  const releaseLink = view.container.querySelector('[data-role="release-page-link"]');
  check(
    '更新与维护卡片：预设仓库外部链接与预设版本并列',
    presetRepoHref.includes('muyangplus/dawn-tick-presets') &&
      presetRepoOpensOutside &&
      presetRepoLink.parentElement?.querySelector('[data-role="preset-version"]') !== null,
    `${presetRepoHref} target=${presetRepoLink?.getAttribute('target') ?? '(无)'} rel=${presetRepoLink?.getAttribute('rel') ?? '(无)'}`,
  );
  check(
    '更新与维护卡片：检查更新与发布页入口',
    view.container.querySelector('button[aria-label="检查更新"]') !== null &&
      releaseLink instanceof window.HTMLAnchorElement &&
      releaseLink.href.includes('muyangplus/dawn-tick/releases'),
    releaseLink?.getAttribute('href') ?? '(无)',
  );

  // 关于卡片：帮助与反馈（置顶）、应用与版本、致谢与第三方声明
  const helpBlock = view.container.querySelector('[data-role="about-help"]');
  const appBlock = view.container.querySelector('[data-role="about-app"]');
  const creditsBlock = view.container.querySelector('[data-role="about-credits"]');
  check(
    '关于卡片：帮助与反馈置顶并给出仓库入口',
    helpBlock !== null &&
      (helpBlock.textContent ?? '').includes('帮助与反馈') &&
      (helpBlock.textContent ?? '').includes('快捷键') &&
      view.container.querySelector('[data-role="issues-link"]') !== null &&
      (view.container.querySelector('[data-role="readme-link"]')?.getAttribute('href') ?? '').includes('#readme') &&
      (appBlock === null ||
        (helpBlock.compareDocumentPosition(appBlock) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    (helpBlock?.textContent ?? '').slice(0, 60),
  );
  const creditItems = [...(creditsBlock?.querySelectorAll('li') ?? [])].map((item) => item.textContent ?? '');
  check(
    '关于卡片：应用与版本 + 致谢与第三方声明',
    appBlock !== null &&
      (appBlock.textContent ?? '').includes('版本') &&
      (appBlock.textContent ?? '').includes('Apache-2.0') &&
      creditsBlock !== null &&
      creditItems.length >= 10 &&
      creditItems.some((item) => /react/i.test(item) && item.includes('MIT')) &&
      creditItems.some((item) => item.includes('tauri')) &&
      (creditsBlock.querySelector('summary')?.textContent ?? '').includes('展开依赖与许可证'),
    `依赖 ${creditItems.length} 项：${creditItems.slice(0, 3).join(' / ')}`,
  );

  check(
    '浏览器端不显示存储位置与日志模式开关',
    view.container.querySelector('[data-role="storage-location"]') === null &&
      view.container.querySelector('[data-role="wal-setting"]') === null &&
      (view.container.textContent ?? '').includes('本地存储：'),
    '',
  );
  check(
    '数据页有自动备份开关、保留份数与快照列表',
    view.container.querySelector('[data-role="backup-settings"]') !== null &&
      view.container.querySelector('[role="switch"][aria-label="自动备份"]') !== null &&
      view.container.querySelector('[role="switch"][aria-label="启动时备份"]') !== null &&
      view.container.querySelector('[data-role="backup-keep"]') !== null &&
      view.container.querySelector('[data-role="backup-kind"]')?.textContent?.includes('JSON 快照') === true &&
      view.container.querySelector('[data-role="snapshot-list"], [data-role="snapshot-empty"]') !== null,
    (view.container.querySelector('[data-role="backup-settings"]')?.textContent ?? '').slice(0, 80),
  );

  check(
    '数据页有 WebDAV 地址、账号密码与上传下载入口',
    view.container.querySelector('[data-role="webdav-settings"]') !== null &&
      view.container.querySelector('[data-role="webdav-url"]') !== null &&
      view.container.querySelector('[data-role="webdav-user"]') !== null &&
      view.container.querySelector('[data-role="webdav-password"]')?.getAttribute('type') === 'password' &&
      view.container.querySelector('button[aria-label="测试 WebDAV 连接"]')?.hasAttribute('disabled') === true &&
      view.container.querySelector('button[aria-label="上传到 WebDAV"]') !== null &&
      view.container.querySelector('button[aria-label="从 WebDAV 下载"]') !== null,
    '',
  );

  check(
    '主区底部留白按底部栏与悬浮按钮高度计算',
    (view.container.querySelector('[data-role="app-main"]')?.className ?? '').includes('--dt-bottom-nav') &&
      (view.container.querySelector('[data-role="app-main"]')?.className ?? '').includes('--dt-bottom-fab'),
    '',
  );

  if (clickByText(view.container, '导出配置')) await flush(10);
  check(
    '导出可选模块',
    document.body.textContent?.includes('学期与节次') === true &&
      document.querySelector('input[aria-label="导出 课程与排课"]') !== null &&
      document.querySelector('input[aria-label="导出 提醒"]') !== null,
    '',
  );
  // 整包 zip：可选把预设快照与日志一起打包，导出格式仍是三选一
  if (clickByLabel(document.body, '导出为整包 zip')) await flush(6);
  check(
    '整包 zip 可选打包预设与日志',
    document.querySelector('input[aria-label="整包包含预设快照"]') !== null &&
      document.querySelector('input[aria-label="整包包含日志文件"]') !== null,
    '',
  );
  // Base64 导出：切到 Base64 文本后生成文本框，内容可解析回备份
  if (clickByLabel(document.body, '导出为 Base64 文本')) await flush(10);
  if (clickByText(document.body, '生成文本')) await flush(14);
  const base64Box = document.querySelector<HTMLTextAreaElement>('[data-role="export-base64"]');
  const base64Text = (base64Box?.value ?? '').trim();
  let base64Ok = false;
  try {
    const parsed = JSON.parse(fromBase64Utf8(base64Text)) as { format?: string };
    base64Ok = parsed.format === 'dawn-tick-backup';
  } catch {
    base64Ok = false;
  }
  check(
    '导出可选 Base64 文本并能在文本框里复制',
    base64Box !== null &&
      base64Text.length > 0 &&
      base64Ok &&
      document.body.textContent?.includes('复制文本') === true,
    `长度 ${base64Text.length}，解析=${base64Ok ? '成功' : '失败'}`,
  );
  if (clickByText(document.body, '取消')) await flush(6);
  // 导入配置：一个入口里既可选文件，也可粘贴文本；把刚生成的 Base64 贴回去应能识别模块
  if (clickByLabel(view.container, '导入配置')) await flush(10);
  check(
    '导入配置合并文件与粘贴两种方式',
    document.querySelector('[data-role="import-text"]') !== null &&
      document.body.textContent?.includes('选择备份文件') === true,
    '',
  );
  const importTextBox = document.querySelector<HTMLTextAreaElement>('[data-role="import-text"]');
  if (importTextBox !== null) setInputValue(importTextBox, base64Text);
  await flush(6);
  const pasteParsed = clickByText(document.body, '从文本导入');
  await flush(14);
  check(
    '粘贴 Base64 文本可导入配置',
    pasteParsed &&
      document.body.textContent?.includes('按修改时间合并') === true &&
      document.querySelector('input[aria-label="导入 课程与排课"]') !== null,
    (document.body.textContent ?? '').slice(-60),
  );
  if (clickByText(document.body, '取消')) await flush(6);

  const beforePeriods = startInputs(view.container).length;
  if (clickByText(view.container, '自动生成课次')) await flush(26);
  const generated = startInputs(view.container);
  check(
    '自动生成课次按固定时长重算',
    generated.length >= 10 && generated[2]?.value === '09:50',
    `生成后 ${generated.length} 节，第三节课 ${generated[2]?.value ?? '?'} 起`,
  );

  if (clickByText(view.container, '追加一节')) await flush(22);
  const appended = startInputs(view.container).length;
  check('追加一节生效', appended === generated.length + 1, `${generated.length} → ${appended}（原 ${beforePeriods}）`);

  // —— 「调整范围」对话框：输入过程中不弹，失焦或回车才弹 ——
  // 锚点：时间表卡片里第 1/2 节的开始、结束时间输入框
  const scopeDialog = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-role="scope-dialog"]');
  const scopeDialogCount = (): number => document.querySelectorAll('[data-role="scope-dialog"]').length;
  const scopeText = (): string => (scopeDialog()?.textContent ?? '').trim();
  const clockInput = (period: number, field: '开始' | '结束'): HTMLInputElement | null => {
    const found = view.container.querySelector(`input[aria-label="第 ${period} 节${field}时间"]`);
    return found instanceof window.HTMLInputElement ? found : null;
  };

  // 场景一：改第 1 节开始时间 → 输入过程中只有落库，没有对话框；失焦才弹一个
  const firstStart = clockInput(1, '开始');
  const firstStartBefore = firstStart?.value ?? '';
  if (firstStart !== null) setInputValue(firstStart, '08:10');
  await flush(10);
  check(
    '输入过程中不弹出调整范围对话框',
    scopeDialog() === null && firstStart?.value === '08:10',
    `对话框=${scopeDialog() === null ? '未弹出' : '已弹出'}，输入框=${firstStart?.value ?? '?'}（原 ${firstStartBefore}）`,
  );

  if (firstStart !== null) blurInput(firstStart);
  await flush(10);
  check(
    '失焦后弹出调整范围对话框',
    scopeDialogCount() === 1 && scopeText().includes('这次改动要应用到哪些课次'),
    `对话框 ${scopeDialogCount()} 个：${scopeText().slice(0, 30)}`,
  );
  check(
    '调整范围对话框给出顺延重排与取消',
    ['只改这一节', '从这一节起顺延重排', '取消'].every((label) => scopeText().includes(label)),
    scopeText().slice(-60),
  );

  if (clickByText(document.body, '只改这一节')) await flush(8);
  check(
    '只改这一节关掉对话框且单节改动保留',
    scopeDialog() === null && firstStart?.value === '08:10',
    `对话框=${scopeDialog() === null ? '已关闭' : '仍在'}，输入框=${firstStart?.value ?? '?'}`,
  );

  // 同一次编辑只问一次：失焦/回车已经消费掉这次编辑，再失焦不会重新弹
  if (firstStart !== null) blurInput(firstStart);
  await flush(8);
  check('同一次编辑不再重复弹窗', scopeDialogCount() === 0, `对话框 ${scopeDialogCount()} 个`);

  // 没有编辑过的字段失焦也不该弹窗
  const secondEnd = clockInput(2, '结束');
  if (secondEnd !== null) blurInput(secondEnd);
  await flush(8);
  check('未改动字段失焦不弹窗', scopeDialogCount() === 0, `对话框 ${scopeDialogCount()} 个`);

  // 场景二：半成品时间（HH:MM 不完整）失焦不弹窗
  const secondStart = clockInput(2, '开始');
  const secondStartBefore = secondStart?.value ?? '';
  if (secondStart !== null) setInputValue(secondStart, '9:9');
  await flush(6);
  if (secondStart !== null) blurInput(secondStart);
  await flush(8);
  check(
    '时间半成品失焦不弹出调整范围对话框',
    scopeDialog() === null,
    `对话框=${scopeDialog() === null ? '未弹出' : '已弹出'}，值=${secondStart?.value ?? '?'}（原 ${secondStartBefore}）`,
  );

  // 场景三：改第 1 节的结束时间 → 输入过程中不弹，按回车才弹，且对话框讲明时长与课间
  const firstEnd = clockInput(1, '结束');
  const firstEndBefore = firstEnd?.value ?? '';
  if (firstEnd !== null) setInputValue(firstEnd, '09:05');
  await flush(10);
  check(
    '改结束时间输入过程中不弹窗且已落库',
    scopeDialog() === null && firstEnd?.value === '09:05',
    `对话框=${scopeDialog() === null ? '未弹出' : '已弹出'}，结束时间=${firstEnd?.value ?? '?'}（原 ${firstEndBefore}）`,
  );

  if (firstEnd !== null) pressEnter(firstEnd);
  await flush(10);
  check(
    '回车只弹一个调整范围对话框并给出顺延时长与课间',
    scopeDialogCount() === 1 &&
      scopeText().includes('顺延按每节 55 分钟、课间 10 分钟'),
    scopeText().slice(-60),
  );
  if (clickByText(document.body, '取消')) await flush(8);
  check('取消关掉对话框', scopeDialogCount() === 0, `对话框 ${scopeDialogCount()} 个`);

  // 场景四：对话框底部的会话级勾选框。这里只确认它存在且默认未勾选（不点击），
  // 所以不会影响后面「锚点顺延」等既有断言；勾选后的行为放在所有调整范围断言之后验证。
  const optOutBox = (): HTMLInputElement | null => {
    const found = scopeDialog()?.querySelector('input[aria-label="本次启动期间不再询问"]');
    return found instanceof window.HTMLInputElement ? found : null;
  };
  {
    // 再改一次第 1 节开始时间，只为把对话框重新打开
    const optInDialogStart = clockInput(1, '开始');
    if (optInDialogStart !== null) setInputValue(optInDialogStart, '08:20');
    await flush(10);
    if (optInDialogStart !== null) blurInput(optInDialogStart);
    await flush(10);
    const box = optOutBox();
    check(
      '调整范围对话框有本次启动不再询问勾选框',
      box !== null && box.type === 'checkbox' && box.checked === false,
      box === null
        ? '未找到 input[aria-label="本次启动期间不再询问"]'
        : `type=${box.type}，勾选=${String(box.checked)}`,
    );
    if (clickByText(document.body, '只改这一节')) await flush(8);
  }

  // —— 锚点顺延：把第 3 节开始时间改成 09:55 → 从这一节起按每节 45 分钟、课间 10 分钟顺延 ——
  if (durationInput !== null) setInputValue(durationInput, '45');
  if (breakInput !== null) setInputValue(breakInput, '10');
  await flush(8);
  const anchorStart = clockInput(3, '开始');
  const anchorBefore = anchorStart?.value ?? '';
  if (anchorStart !== null) setInputValue(anchorStart, '09:55');
  await flush(8);
  if (anchorStart !== null) blurInput(anchorStart);
  await flush(10);
  const anchorDialogText = scopeText();
  const anchorReordered = clickByText(document.body, '从这一节起顺延重排');
  await flush(24);
  const thirdStart = clockInput(3, '开始')?.value ?? '';
  const thirdEnd = clockInput(3, '结束')?.value ?? '';
  const fourthStart = clockInput(4, '开始')?.value ?? '';
  const fourthEnd = clockInput(4, '结束')?.value ?? '';
  check(
    '锚点顺延重排后第 4 节顺延到 10:50–11:35',
    anchorReordered &&
      anchorDialogText.includes('顺延按每节 45 分钟、课间 10 分钟') &&
      thirdStart === '09:55' &&
      thirdEnd === '10:40' &&
      fourthStart === '10:50' &&
      fourthEnd === '11:35',
    `锚点第 3 节 ${anchorBefore} → ${thirdStart}–${thirdEnd}，第 4 节 ${fourthStart}–${fourthEnd}`,
  );

  // —— 场景五：勾选「本次启动期间不再询问」之后，本次会话内不再弹「调整范围」 ——
  // 放在所有既有「调整范围」断言之后：勾选是会话级（模块级变量）的，会影响后续改动，
  // 所以先把既有断言全部跑完再验证；此刻仍在设置页，用的就是前面那张时间表卡片。
  // 顺序上放在「删除学期」之前——学期被删掉后设置页就卸载了，时间表输入框也不在了。
  const optInEnd = clockInput(2, '结束');
  if (optInEnd !== null) setInputValue(optInEnd, '10:45');
  await flush(10);
  if (optInEnd !== null) blurInput(optInEnd);
  await flush(10);
  const optInBox = optOutBox();
  let optInClicked = false;
  if (optInBox !== null) {
    optInBox.click();
    optInClicked = optInBox.checked;
  }
  await flush(8);
  check(
    '勾选本次启动不再询问后给出提示并保持单节改动',
    optInBox !== null &&
      optInClicked &&
      (document.body.textContent ?? '').includes('本次启动期间不再询问调整范围') &&
      clockInput(2, '结束')?.value === '10:45',
    `勾选=${String(optInBox?.checked)}，结束时间=${clockInput(2, '结束')?.value ?? '?'}（原 10:40）`,
  );

  if (clickByText(document.body, '只改这一节')) await flush(8);
  const quietEnd = clockInput(2, '结束');
  if (quietEnd !== null) setInputValue(quietEnd, '10:50');
  await flush(10);
  if (quietEnd !== null) blurInput(quietEnd);
  await flush(10);
  check(
    '勾选后本次会话不再弹出调整范围对话框',
    scopeDialogCount() === 0 && clockInput(2, '结束')?.value === '10:50',
    `对话框 ${scopeDialogCount()} 个，结束时间=${clockInput(2, '结束')?.value ?? '?'}（原 10:45）`,
  );
  check(
    '勾选状态不写入本地存储',
    (globalThis.localStorage?.length ?? 0) > 0 &&
      [...Array(globalThis.localStorage?.length ?? 0).keys()].every((index) => {
        const key = globalThis.localStorage?.key(index) ?? '';
        return !key.includes('scope') && !key.includes('不再询问');
      }),
    [...Array(globalThis.localStorage?.length ?? 0).keys()]
      .map((index) => globalThis.localStorage?.key(index) ?? '')
      .join(' / '),
  );

  // 会话级：重新挂载（相当于切页面再回来）后仍然是「不再询问」。
  // 注意：从这里起 view 已卸载，后续一律以 remounted 为锚点。
  view.root.unmount();
  const remounted = mount(<App />);
  await flush(20);
  if (clickByText(remounted.container, '设置')) await flush(14);
  const remountEnd = document.querySelector<HTMLInputElement>('input[aria-label="第 2 节结束时间"]');
  if (remountEnd !== null) setInputValue(remountEnd, '10:55');
  await flush(10);
  if (remountEnd !== null) blurInput(remountEnd);
  await flush(10);
  check(
    '重新挂载后本次会话仍不弹出调整范围对话框',
    startInputs(remounted.container).length > 0 &&
      scopeDialogCount() === 0 &&
      remountEnd?.value === '10:55',
    `对话框 ${scopeDialogCount()} 个，结束时间=${remountEnd?.value ?? '?'}（原 10:50）`,
  );

  // —— 按学校套用作息：与导入流程共用 SchoolPicker，专属作息优先、否则通用作息 ——
  const applySchoolButton = (): HTMLElement | null =>
    remounted.container.querySelector<HTMLElement>('button[aria-label="按学校套用作息"]');
  const schoolTimetableStatus = (): string =>
    (remounted.container.querySelector('[data-role="school-timetable-status"]')?.textContent ?? '').trim();
  const schoolTimetableMessage = (): string =>
    (remounted.container.querySelector('[data-role="school-timetable-message"]')?.textContent ?? '').trim();
  /** 在弹出的作息选校对话框里搜关键词并点中某一行；返回那一行（没找到时为 null）。 */
  const pickSchoolInDialog = async (keyword: string, name: string): Promise<HTMLElement | null> => {
    applySchoolButton()?.click();
    await flush(16);
    const box = document.querySelector<HTMLInputElement>('input[aria-label="搜索学校"]');
    if (box !== null) setInputValue(box, keyword);
    await flush(14);
    const row = [...document.querySelectorAll<HTMLElement>('[data-role="school-row"]')].find((item) =>
      (item.textContent ?? '').includes(name),
    );
    row?.click();
    await flush(24);
    return row ?? null;
  };

  check('作息设置提供按学校套用作息入口', applySchoolButton() !== null, '');
  applySchoolButton()?.click();
  await flush(16);
  check(
    '作息设置可打开学校选择器',
    document.querySelector('[data-role="school-picker"]') !== null &&
      document.querySelector('input[aria-label="搜索学校"]') !== null,
    '',
  );
  // 关掉这次打开的对话框，下面用统一入口重开
  if (clickByText(document.body, '取消')) await flush(10);

  const genericPicked = await pickSchoolInDialog('清华', '清华大学');
  check(
    '该校暂无专属作息时套用通用作息并提示',
    genericPicked?.getAttribute('data-adapted') === 'false' &&
      schoolTimetableMessage().includes('该校暂无专属作息，已套用通用作息') &&
      schoolTimetableStatus().includes('当前 12 节课次'),
    `${schoolTimetableMessage()} / ${schoolTimetableStatus()}`,
  );

  const exclusivePicked = await pickSchoolInDialog('苏州', '苏州科技大学');
  check(
    '已适配学校套用该校专属作息',
    exclusivePicked?.getAttribute('data-adapted') === 'true' &&
      schoolTimetableMessage().includes('已套用 苏州科技大学 的作息（14 节）') &&
      schoolTimetableStatus().includes('当前 14 节课次'),
    `${schoolTimetableMessage()} / ${schoolTimetableStatus()}`,
  );

  // 上次选的学校：卡片上给一键套用入口，选择器里置顶成「最近使用」一组
  const recentApply = remounted.container.querySelector<HTMLElement>('[data-role="recent-school-apply"]');
  check(
    '作息设置记住上次选的学校并可一键套用',
    recentApply !== null && (recentApply.textContent ?? '').includes('苏州科技大学'),
    recentApply?.textContent?.trim() ?? '(无)',
  );
  applySchoolButton()?.click();
  await flush(16);
  const pinnedGroup = [...document.querySelectorAll('[data-role="school-group"]')].find(
    (group) => group.getAttribute('data-province') === '最近使用',
  );
  check(
    '学校选择器把上次选的学校置顶',
    pinnedGroup !== undefined && (pinnedGroup.textContent ?? '').includes('苏州科技大学'),
    pinnedGroup?.textContent?.trim().slice(0, 40) ?? '(无)',
  );
  if (clickByText(document.body, '取消')) await flush(10);

  check('学期设置显示编辑与删除入口', clickByLabel(remounted.container, '编辑学期'), '');
  await flush(6);
  const editDialogText = document.body.textContent ?? '';
  check('打开学期编辑弹窗', editDialogText.includes('开学日期') && editDialogText.includes('总周数'), '');

  const nameInput = [...document.querySelectorAll('input')].find(
    (item) => item.value === '2026-2027 第一学期',
  );
  if (nameInput !== undefined) setInputValue(nameInput, '改名后的学期');
  await flush(6);
  if (clickByText(document.body, '保存')) {
    await flush(20);
  }
  check('保存后学期名更新', (remounted.container.textContent ?? '').includes('改名后的学期'), '');

  clickByLabel(remounted.container, '删除学期');
  await flush(8);
  const deleteDialogText = document.body.textContent ?? '';
  check('删除确认说明后果', deleteDialogText.includes('不可撤销'), deleteDialogText.slice(-40));
  if (clickByText(document.body, '确认删除')) {
    await flush(24);
  }
  check('删除后回到引导页', (remounted.container.textContent ?? '').includes('欢迎使用晓刻 DawnTick'), '');

  // 引导页可跳过：用默认值直接建学期进应用
  check(
    '引导页提供跳过入口',
    remounted.container.querySelector('button[aria-label="跳过引导"]') !== null,
    '',
  );
  if (clickByLabel(remounted.container, '跳过引导')) await flush(26);
  check(
    '跳过引导会建默认学期并进入应用',
    (remounted.container.textContent ?? '').includes('我的学期') &&
      !(remounted.container.textContent ?? '').includes('欢迎使用晓刻 DawnTick'),
    (remounted.container.textContent ?? '').slice(0, 60),
  );
  check(
    '课表空态提供导入课表按钮',
    remounted.container.querySelector('button[aria-label="导入课表"]') !== null &&
      (remounted.container.textContent ?? '').includes('或在设置里导入课表') &&
      !(remounted.container.textContent ?? '').includes('导入页'),
    '',
  );
  // 删掉这个默认学期，后面的「选校建学期」用例仍从引导页开始
  if (clickByText(remounted.container, '设置')) await flush(16);
  clickByLabel(remounted.container, '删除学期');
  await flush(10);
  if (clickByText(document.body, '确认删除')) await flush(24);
  check(
    '删掉默认学期后回到引导页',
    (remounted.container.textContent ?? '').includes('欢迎使用晓刻 DawnTick'),
    '',
  );

  // 外部链接确认弹窗在引导页也要能弹出（曾经没挂，点了没反应）
  // —— 首次引导：先选学校，创建学期时即按该校作息排好课次 ——
  const onboardScroll = remounted.container.querySelector<HTMLElement>('[data-role="onboarding-scroll"]');
  const onboardAdvanced = remounted.container.querySelector<HTMLDetailsElement>('[data-role="onboarding-advanced"]');
  check(
    '引导页自身可滚动，学校选择收进默认收起的高级设置',
    onboardScroll !== null &&
      (onboardScroll.className ?? '').includes('overflow-y-auto') &&
      onboardAdvanced !== null &&
      onboardAdvanced.open === false &&
      (onboardAdvanced.querySelector('summary')?.textContent ?? '').includes('高级设置'),
    `scroll=${(onboardScroll?.className ?? '?').slice(0, 40)} open=${onboardAdvanced?.open ?? '?'}`,
  );
  // 选校改成弹窗：点「选择学校」后列表在弹窗里，选中即关闭
  const schoolOpened = clickByLabel(remounted.container, '选择学校');
  await flush(12);
  const onboardSearch = document.querySelector<HTMLInputElement>('input[aria-label="搜索学校"]');
  check(
    '引导页用弹窗选校',
    schoolOpened && onboardSearch !== null && onboardAdvanced !== null,
    '',
  );
  if (onboardSearch !== null) setInputValue(onboardSearch, '苏州');
  await flush(26);
  const onboardRows = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('[data-role="school-row"]'),
  ];
  // 选校弹窗里的「请求适配」是外部链接（<a data-role="request-school">）：引导页也挂了确认弹窗
  const onboardRequestLink = [...document.querySelectorAll<HTMLElement>('[data-role="request-school"]')].find(
    (item) => (item.getAttribute('aria-label') ?? '').includes('苏州科技大学'),
  );
  onboardRequestLink?.click();
  await flush(12);
  const externalUrl = document.querySelector<HTMLInputElement>('[data-role="external-link-url"]');
  check(
    '引导页的外部链接确认弹窗能弹出',
    onboardRequestLink !== undefined && externalUrl !== null,
    `学校行 ${onboardRows().length} 条；确认框=${externalUrl === null ? '无' : '有'}`,
  );
  // 关掉确认框时只点它自己的「取消」：选校弹窗里也有一个「取消」，按文本取会点错
  const confirmBody = externalUrl?.closest('[data-role="dialog-body"]');
  const confirmCancel = [...(confirmBody?.querySelectorAll('button') ?? [])].find(
    (item) => (item.textContent ?? '').trim() === '取消',
  );
  confirmCancel?.click();
  await flush(10);
  const onboardRow = onboardRows().find((item) => (item.textContent ?? '').includes('苏州科技大学'));
  onboardRow?.click();
  await flush(12);
  check(
    '引导页选校后给出已选提示',
    (remounted.container.querySelector('[data-role="onboarding-school-picked"]')?.textContent ?? '').includes(
      '苏州科技大学',
    ),
    remounted.container.querySelector('[data-role="onboarding-school-picked"]')?.textContent?.trim() ?? '(无)',
  );
  if (clickByText(remounted.container, '创建并开始')) await flush(30);
  if (clickByText(remounted.container, '设置')) await flush(16);
  const onboardClock = (period: number, field: '开始' | '结束'): string =>
    remounted.container.querySelector<HTMLInputElement>(`input[aria-label="第 ${period} 节${field}时间"]`)?.value ?? '';
  check(
    '引导页所选学校在创建学期时套用为该校作息',
    startInputs(remounted.container).length === 14 &&
      onboardClock(3, '开始') === '09:55' &&
      onboardClock(3, '结束') === '10:40',
    `共 ${startInputs(remounted.container).length} 节，第 3 节 ${onboardClock(3, '开始') || '?'}–${onboardClock(3, '结束') || '?'}`,
  );

  remounted.root.unmount();

  // —— 悬浮窗外壳：整窗作为拖动区（deep），关闭按钮自身仍是可点元素 ——
  let hidden = 0;
  const mini = mount(
    <MiniShell variant="bar" onHide={() => { hidden += 1; }}>
      <div className="mini-title">高等数学</div>
      <div className="mini-row">
        <span className="mini-count">09:55</span>
      </div>
    </MiniShell>,
  );
  await flush(4);
  const miniRoot = mini.container.querySelector('main.mini');
  check(
    '悬浮窗整窗为拖动区',
    miniRoot?.getAttribute('data-tauri-drag-region') === 'deep' &&
      mini.container.querySelector('.mini-title')?.getAttribute('data-tauri-drag-region') === null,
    `拖动区=${miniRoot?.getAttribute('data-tauri-drag-region') ?? '(无)'}`,
  );
  const miniClose = mini.container.querySelector<HTMLElement>('button.mini-close');
  check(
    '悬浮窗关闭按钮仍是可点击元素',
    miniClose !== null && miniClose.tagName === 'BUTTON' && miniClose.getAttribute('data-tauri-drag-region') === null,
    miniClose?.tagName ?? '(无按钮)',
  );
  miniClose?.click();
  await flush(4);
  check('悬浮窗关闭按钮触发隐藏', hidden === 1, `隐藏 ${hidden} 次`);
  mini.root.unmount();

  // —— 日志时间戳：与原生 startup.log 同一口径（本地时间 + 偏移，毫秒） ——
  const sampleTime = formatLogTimestamp(Date.UTC(2026, 9, 13, 10, 1, 34, 123));
  check(
    '日志时间戳带本地时间与偏移',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}$/.test(sampleTime),
    sampleTime,
  );

  // —— 悬浮窗：明日课程预告（复用「空日程提示明日预告」设置） ——
  const nowMs = Date.now();
  check(
    '悬浮窗当天没课时切到明日课程预告',
    shouldShowTomorrow({ enabled: true, todayEnds: [], tomorrowCount: 2, now: nowMs }) === true &&
      shouldShowTomorrow({ enabled: true, todayEnds: [nowMs - 60_000], tomorrowCount: 2, now: nowMs }) === true &&
      shouldShowTomorrow({ enabled: false, todayEnds: [], tomorrowCount: 2, now: nowMs }) === false &&
      shouldShowTomorrow({ enabled: true, todayEnds: [nowMs + 60_000], tomorrowCount: 2, now: nowMs }) === false &&
      shouldShowTomorrow({ enabled: true, todayEnds: [], tomorrowCount: 0, now: nowMs }) === false,
    '没课/课上完且开启→预告；关闭或还有课或明天没课→不预告',
  );
  check(
    '明日预告最多列四节',
    tomorrowPreviewLessons([1, 2, 3, 4, 5, 6]).length === 4,
    `共 ${tomorrowPreviewLessons([1, 2, 3, 4, 5, 6]).length} 节`,
  );

  // P0-05：独立挂一个 App，完整走一遍导入，验证步骤标签与「完成」收起导入区
  {
    const importApp = mount(<App />);
    await flush(12);
    clickByText(importApp.container, '设置');
    await flush(12);
    const importSummary = importApp.container.querySelector<HTMLElement>('[aria-label="导入课表"]');
    importSummary?.click();
    await flush(10);
    const importStepText = importApp.container.querySelector('[aria-label="导入步骤"]')?.textContent ?? '';
    check(
      '导入步骤第 4 步叫完成',
      importStepText.includes('选择方式') &&
        importStepText.includes('登录或上传') &&
        importStepText.includes('预览') &&
        importStepText.includes('完成') &&
        !importStepText.includes('确认'),
      importStepText,
    );
    if (clickByTextStart(importApp.container, '网页课表')) await flush(10);
    const importPaste = importApp.container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="粘贴课表页面内容"]',
    );
    if (importPaste instanceof window.HTMLTextAreaElement) {
      setInputValue(importPaste, PAGE_SAMPLE);
      await flush(6);
      if (clickByText(importApp.container, '识别并预览')) await flush(22);
    }
    if (clickByText(importApp.container, '确认导入')) await flush(30);
    const importFinished = (importApp.container.textContent ?? '').includes('导入完成');
    if (clickByText(importApp.container, '完成')) await flush(12);
    const importDetails = importApp.container.querySelector<HTMLDetailsElement>('[data-role="course-import"]');
    check(
      '点完成后导入区收起',
      importFinished && importDetails !== null && importDetails.open === false,
      `完成页=${importFinished} / open=${importDetails?.open ?? '(无)'}`,
    );
    importApp.root.unmount();
  }

  // P0-01：条目删除入口（详情页删除 → 确认 → 时间线消失）
  {
    // 前面的用例删过学期，这里先补一条今天的待办供删除使用
    const todoStorage = validatedStorage(await openIndexedDbStorage());
    const semesterRows = await todoStorage.collection<Record<string, unknown>>('semesters').getAll();
    const smokeUserId = String(semesterRows[0]?.['user_id'] ?? 'u1');
    const activeSemesterRow = (await activeSemester(todoStorage, smokeUserId)) ?? semesterRows[0];
    if (activeSemesterRow !== undefined) {
      await createEvent(todoStorage, {
        userId: String(activeSemesterRow['user_id']),
        semesterId: String(activeSemesterRow['id']),
        type: 'todo',
        title: '删除入口验证',
        onDate: new Date().toISOString().slice(0, 10),
      });
    }
    const todoApp = mount(<App />);
    await flush(12);
    const scheduleTab = [...todoApp.container.querySelectorAll<HTMLElement>('[data-role="bottom-nav"] button')]
      .find((node) => (node.textContent ?? '').trim() === '日程');
    scheduleTab?.click();
    await flush(12);
    let firstEvent = todoApp.container.querySelector<HTMLElement>('[data-role="timeline-event"]');
    for (let step = 0; step < 4 && firstEvent === null; step += 1) {
      todoApp.container.querySelector<HTMLElement>('[aria-label="后一天"]')?.click();
      await flush(10);
      firstEvent = todoApp.container.querySelector<HTMLElement>('[data-role="timeline-event"]');
    }
    for (let step = 0; step < 6 && firstEvent === null; step += 1) {
      todoApp.container.querySelector<HTMLElement>('[aria-label="前一天"]')?.click();
      await flush(10);
      firstEvent = todoApp.container.querySelector<HTMLElement>('[data-role="timeline-event"]');
    }
    const eventLabel = firstEvent?.getAttribute('aria-label') ?? '';
    const eventTitle = eventLabel.replace('编辑日程：', '');
    check(
      '时间线行可进入条目详情',
      firstEvent !== null && eventTitle.length > 0,
      eventLabel,
    );
    firstEvent?.click();
    await flush(8);
    const deleteEntry = document.querySelector<HTMLElement>('[aria-label^="删除条目 "]');
    check(
      '条目详情提供删除入口',
      deleteEntry !== null,
      deleteEntry?.getAttribute('aria-label') ?? '(无)',
    );
    deleteEntry?.click();
    await flush(8);
    check('删除条目前先弹确认', (document.body.textContent ?? '').includes('将删除'), '');
    if (clickByText(document.body, '取消')) await flush(8);
    check(
      '取消删除后条目仍在',
      [...todoApp.container.querySelectorAll('[data-role="timeline-event"]')].some((node) =>
        (node.getAttribute('aria-label') ?? '').includes(eventTitle),
      ),
      '',
    );
    firstEvent?.click();
    await flush(8);
    const deleteAgain = document.querySelector<HTMLElement>('[aria-label^="删除条目 "]');
    deleteAgain?.click();
    await flush(8);
    if (clickByText(document.body, '确认删除')) await flush(20);
    check(
      '确认删除后条目从时间线消失',
      ![...(todoApp.container.querySelectorAll('[data-role="timeline-event"]'))].some((node) =>
        (node.getAttribute('aria-label') ?? '').includes(eventTitle),
      ),
      '',
    );
    todoApp.root.unmount();
  }

  return results;
}
