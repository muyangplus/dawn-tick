import * as fakeIndexedDb from 'fake-indexeddb';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createCourse,
  createSchedule,
  createSemester,
  validatedStorage,
} from '@dawn-tick/core';
import { App } from '../src/App.tsx';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';

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

async function seed(): Promise<void> {
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
}

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

function clickByLabel(container: HTMLElement, prefix: string): boolean {
  const button = container.querySelector(`button[aria-label^="${prefix}"]`);
  if (!(button instanceof HTMLElement)) return false;
  button.click();
  return true;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
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

  await seed();
  const view = mount(<App />);
  await flush(20);
  const text = view.container.textContent ?? '';
  check('课表渲染课程', text.includes('高数'), text.slice(0, 80));
  check('工具栏渲染周次', /第\s*\d+\s*周/.test(text), '');
  check('渲染当前时间指示线', view.container.querySelector('[aria-hidden="true"]') !== null, '');

  const switchedToSchedule = clickByText(view.container, '日程');
  await flush(10);
  const scheduleText = view.container.textContent ?? '';
  check('切到日程页', switchedToSchedule && scheduleText.includes('考试倒计时'), scheduleText.slice(0, 60));

  const switchedToSettings = clickByText(view.container, '设置');
  await flush(10);
  const settingsText = view.container.textContent ?? '';
  check(
    '切到设置页',
    switchedToSettings && settingsText.includes('外观') && settingsText.includes('小组件背景'),
    settingsText.slice(0, 60),
  );

  const switchedToTimeline = clickByText(view.container, '课表');
  await flush(10);
  const searchButton = view.container.querySelector('button[aria-label="搜索"]');
  if (searchButton instanceof HTMLElement) searchButton.click();
  await flush(8);
  check('搜索弹窗渲染', (document.body.textContent ?? '').includes('输入关键词开始搜索'), '');
  check('回到课表', switchedToTimeline, '');
  if (clickByText(document.body, '取消') === false) {
    // 弹窗没有取消按钮时直接继续，不影响后续断言
  }
  await flush(4);

  clickByText(view.container, '设置');
  await flush(10);
  check('学期设置显示编辑与删除入口', clickByLabel(view.container, '编辑学期'), '');
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
  check('保存后学期名更新', (view.container.textContent ?? '').includes('改名后的学期'), '');

  clickByLabel(view.container, '删除学期');
  await flush(8);
  const deleteDialogText = document.body.textContent ?? '';
  check('删除确认说明后果', deleteDialogText.includes('不可撤销'), deleteDialogText.slice(-40));
  if (clickByText(document.body, '确认删除')) {
    await flush(24);
  }
  check('删除后回到引导页', (view.container.textContent ?? '').includes('欢迎使用晓刻 DawnTick'), '');

  view.root.unmount();
  return results;
}
