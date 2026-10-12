import * as fakeIndexedDb from 'fake-indexeddb';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  addDays,
  BUILTIN_PRESET_VERSION,
  BUILTIN_TIMETABLES,
  builtinHolidays,
  createCourse,
  createEvent,
  createSchedule,
  createSemester,
  DEFAULT_TIMETABLE_ID,
  findTimetable,
  validatedStorage,
  writeSettings,
} from '@dawn-tick/core';
import { App } from '../src/App.tsx';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import {
  PRESET_SNAPSHOT_URL,
  PRESET_VERSION_URL,
  canonicalPresetJson,
  sha256HexSync,
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
}

/** 造一份固定数据；返回当前周的周一日期，供后续断言推算有课的日期。 */
async function seed(): Promise<SmokeSeed> {
  const storage = validatedStorage(await openIndexedDbStorage());
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
    dayOfWeek: 1,
    periodStart: 5,
    periodEnd: 6,
    weeks: [1, 2],
  });
  // 周视图铺满 7 天，才能验证「高亮当天列」
  await writeSettings(storage, { viewDays: 7 });
  // 当前周的周一放假，用来验证放假日灰显（跟随当天日期，避免跨周后失效）
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
  const mondayText = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'holiday',
    title: '国庆节',
    onDate: mondayText,
  });
  // 把假期前一天设为工作日：保证周一是这段假期的第一天（不受内置节假日表影响）
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'workday',
    title: '非假日',
    onDate: addDays(mondayText, -1),
  });
  // 周二也放假：形成一段两天假期，用来验证第二天起只显示「放假」
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'holiday',
    title: '国庆节',
    onDate: addDays(mondayText, 1),
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
    onDate: mondayText,
    dueAt: Date.now() - 3_600_000,
  });
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'todo',
    title: '无时间待办',
    onDate: addDays(mondayText, -1),
  });
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'exam',
    title: '期末模拟考',
    onDate: mondayText,
  });
  return { monday: mondayText, overdueTodoId: String(overdue['id']) };
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

/** 造一份哈希自洽的快照（hash 用模块自身的规范化口径算，等价于预设仓库的生成器）。 */
function fakePresetSnapshot(version: string): Record<string, unknown> {
  const unsigned = {
    version,
    schemaVersion: 1,
    generatedAt: '2026-02-01T00:00:00.000Z',
    sources: {
      timetables: [{ id: 'default', path: 'presets/timetables/default.json', sha256: 'sha256:0' }],
      systems: [{ id: 'jwglxt', path: 'presets/systems/jwglxt.json', sha256: 'sha256:0' }],
      adapters: {},
    },
  };
  return { ...unsigned, hash: `sha256:${sha256HexSync(canonicalPresetJson(unsigned))}` };
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
  const view = mount(<App />);
  await flush(20);
  const text = view.container.textContent ?? '';
  check('课表渲染课程', text.includes('高数'), text.slice(0, 80));
  check('工具栏渲染周次', /第\s*\d+\s*周/.test(text), '');
  check('渲染当前时间指示线', view.container.querySelector('[aria-hidden="true"]') !== null, '');
  check('高亮当天列', view.container.querySelector('[data-today="true"]') !== null, '');
  check(
    '非本周课程用虚线框显示',
    text.includes('大物') && view.container.querySelector('[data-dashed="true"]') !== null,
    '',
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
  check(
    '放假日课程灰显',
    text.includes('放假') && view.container.querySelector('[data-tone="holiday"]') !== null,
    '',
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
  const holidayLabelOf = (name: string): string | undefined =>
    [...view.container.querySelectorAll('[data-tone="holiday"]')]
      .find((item) => (item.textContent ?? '').includes(name))
      ?.querySelector('[data-role="holiday-label"]')
      ?.textContent?.trim();
  const firstDayLabel = holidayLabelOf('高数');
  const laterDayLabel = holidayLabelOf('线代');
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
    tailClick && document.querySelector('[aria-label="课前提醒"]') === null,
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
      document.querySelector('[aria-label="课前提醒"]') !== null &&
      detailText.includes('删除整门课'),
    detailText.slice(-60),
  );
  // 关掉详情面板，避免影响后续断言
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(8);

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
  const switchedToSchedule = clickByText(view.container, '日程');
  await flush(10);
  const scheduleText = view.container.textContent ?? '';
  check('切到日程页', switchedToSchedule && scheduleText.includes('考试倒计时'), scheduleText.slice(0, 60));
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
  seededHolidays.delete(addDays(seededMonday, -1));
  seededHolidays.add(seededMonday);
  seededHolidays.add(addDays(seededMonday, 1));
  const timelinePicks = [
    { date: addDays(seededMonday, 7), range: '08:00–09:40', course: '高等数学' },
    { date: addDays(seededMonday, 8), range: '14:00–15:40', course: '线性代数' },
    { date: addDays(seededMonday, 10), range: '16:00–17:40', course: '线性代数' },
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

  // ③ 回到本周一：过期的待办自动完成，但没有回写数据库；顺带核对四种性质标签
  await setViewDate(seededMonday);
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
  const adjustNature = natureOf(view.container.querySelector('[data-kind="adjust"]'));
  const examNature = natureOf(rowIn('timeline-main', '期末模拟考'));
  check(
    '日程时间线：显示条目性质标签（课程/调整/其他/考试）',
    courseNature === '课程' && adjustNature === '调整' && otherNature === '其他' && examNature === '考试',
    `课程=${courseNature} 调整=${adjustNature} 其他=${otherNature} 考试=${examNature}`,
  );

  if (clickMenu(view.container, '添加', '加考试')) await flush(12);
  check(
    '加考试入口打开考试表单',
    document.body.textContent?.includes('考试倒计时') === true &&
      document.querySelector('[aria-label="开考时间"]') !== null,
    '',
  );
  if (clickByText(document.body, '取消')) await flush(6);

  if (clickMenu(view.container, '添加', '加日程')) await flush(12);
  check(
    '加日程可关联课程并带提醒',
    document.querySelector('[aria-label="关联课程"]') !== null &&
      document.querySelector('[aria-label="日程提前提醒"]') !== null,
    '',
  );
  if (clickByText(document.body, '取消')) await flush(6);
  check('日程与作业合并为一个入口', !scheduleText.includes('加作业/汇报'), '');

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
      settingsText.includes('导出日志'),
    settingsText.slice(0, 60),
  );

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
    const nextVersion = '1.1.0';
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
  } finally {
    Object.defineProperty(globalThis, 'fetch', { value: realFetch, configurable: true, writable: true });
  }

  const switchedToTimeline = clickByText(view.container, '课表');
  await flush(10);
  const searchButton = view.container.querySelector('button[aria-label="搜索"]');
  if (searchButton instanceof HTMLElement) searchButton.click();
  await flush(8);
  check('搜索弹窗渲染', (document.body.textContent ?? '').includes('输入关键词开始搜索'), '');
  check('回到课表', switchedToTimeline, '');

  clickByText(view.container, '导入');
  await flush(10);
  const importText = view.container.textContent ?? '';
  check('导入页提供网页课表方式', importText.includes('网页课表') && importText.includes('自己登录后粘贴'), '');
  check(
    '已移除程序代登录入口',
    !importText.includes('正方教务') && !importText.includes('程序代登录') && !importText.includes('学号'),
    '',
  );

  if (clickByTextStart(view.container, '网页课表')) await flush(10);
  check(
    '网页导入提供书签与粘贴',
    view.container.querySelector('textarea[aria-label="书签小工具代码"]') !== null &&
      view.container.querySelector('textarea[aria-label="粘贴课表页面内容"]') !== null &&
      (view.container.textContent ?? '').includes('识别并预览'),
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
    '开发版独占入口可见',
    panelText.includes('填充示例数据') && panelText.includes('导出日志') && panelText.includes('开发版'),
    '',
  );
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

  // 作息预设：默认选中内置默认作息，下拉里列的是 BUILTIN_TIMETABLES
  const defaultPreset = findTimetable(DEFAULT_TIMETABLE_ID);
  check(
    '作息预设默认选中内置默认作息',
    defaultPreset !== undefined &&
      defaultPreset.periods.length > 0 &&
      triggerText('作息预设') === defaultPreset.name &&
      BUILTIN_TIMETABLES.length >= 1 &&
      BUILTIN_TIMETABLES.some((preset) => preset.periods.length >= 10),
    `选中=${triggerText('作息预设')} / 内置 ${BUILTIN_TIMETABLES.length} 套`,
  );

  // 套用苏科大作息：时间表照抄预设课次，时长/课间同步成预设里最常见的 45 / 10
  const periodClock = (period: number, field: '开始' | '结束'): string =>
    view.container.querySelector<HTMLInputElement>(`input[aria-label="第 ${period} 节${field}时间"]`)?.value ?? '';
  // 先把两个输入改成别的值，才能证明套用预设时确实把它们同步了回来
  if (durationInput !== null) setInputValue(durationInput, '50');
  if (breakInput !== null) setInputValue(breakInput, '5');
  await flush(8);
  const presetTrigger = view.container.querySelector('[aria-label="作息预设"]');
  let presetPicked = false;
  if (presetTrigger instanceof window.HTMLElement) {
    presetTrigger.click();
    await flush(8);
    const option = [...document.querySelectorAll('[role="option"]')].find((item) =>
      (item.textContent ?? '').includes('苏州科技大学'),
    );
    if (option instanceof window.HTMLElement) {
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
    '日程卡片可显隐排序',
    view.container.querySelector('[aria-label="显示卡片：日程时间线"]') !== null &&
      view.container.querySelector('[aria-label="上移卡片：考试倒计时"]') !== null &&
      view.container.querySelector('[aria-label="卡片区域：日程时间线：主列"]') !== null &&
      view.container.querySelector('[aria-label="恢复默认布局"]') !== null,
    '',
  );
  // 关于卡片默认收起，更新入口的文案由 update 单元测试覆盖，这里不重复断言

  if (clickByText(view.container, '导出备份')) await flush(10);
  check(
    '导出可选模块',
    document.body.textContent?.includes('学期与节次') === true &&
      document.querySelector('input[aria-label="导出 课程与排课"]') !== null &&
      document.querySelector('input[aria-label="导出 提醒"]') !== null,
    '',
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
      scopeText().includes('的改动已生效；将按每节 55 分钟、课间 10 分钟从这一节起顺延重排'),
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
      anchorDialogText.includes('将按每节 45 分钟、课间 10 分钟从这一节起顺延重排') &&
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

  remounted.root.unmount();
  return results;
}
