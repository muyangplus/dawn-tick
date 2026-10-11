import * as fakeIndexedDb from 'fake-indexeddb';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createCourse,
  createEvent,
  createSchedule,
  createSemester,
  validatedStorage,
  writeSettings,
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
  // 周视图铺满 7 天，才能验证「高亮当天列」
  await writeSettings(storage, { viewDays: 7 });
  // 第 5 周周一放假，用来验证放假日灰显
  await createEvent(storage, {
    userId: USER_ID,
    semesterId: String(semester['id']),
    type: 'holiday',
    title: '国庆调休放假',
    onDate: '2026-10-05',
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

function setInputValue(element: HTMLElement, value: string): void {
  const prototype =
    element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

const PAGE_SAMPLE = `<table id="kbtable"><tr>
  <td id="1-1"><div><span class="title">网页导入课程</span><p>张老师</p><p>教三-401</p><p>1-16周</p></div></td>
  <td id="2-1"><div><span class="title">网页导入课程二</span><p>李老师</p><p>理科楼-201</p><p>2-16周(双)</p></div></td>
</tr></table>`;

const PAGE_WEEKDAY_SAMPLE = `<table><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td></tr>
  <tr><td>第1节</td><td>手动映射课程<br>1-16周</td><td></td><td></td></tr>
  <tr><td>第2节</td><td></td><td>手动映射课程二<br>2-16周</td><td></td></tr>
</table>`;

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

  const switchedToSchedule = clickByText(view.container, '日程');
  await flush(10);
  const scheduleText = view.container.textContent ?? '';
  check(
    '日程页合并为一条时间线',
    scheduleText.includes('日程') && scheduleText.includes('考试倒计时') && scheduleText.includes('加日程'),
    '',
  );
  check('切到日程页', switchedToSchedule && scheduleText.includes('考试倒计时'), scheduleText.slice(0, 60));
  if (clickByText(view.container, '加考试')) await flush(12);
  check(
    '加考试入口打开考试表单',
    document.body.textContent?.includes('考试倒计时') === true &&
      document.querySelector('[aria-label="开考时间"]') !== null,
    '',
  );
  if (clickByText(document.body, '取消')) await flush(6);

  if (clickByText(view.container, '加日程')) await flush(12);
  check(
    '加日程可关联课程并带提醒',
    document.querySelector('[aria-label="关联课程"]') !== null &&
      document.querySelector('[aria-label="日程提前提醒"]') !== null,
    '',
  );
  if (clickByText(document.body, '取消')) await flush(6);
  check('日程与作业合并为一个入口', !scheduleText.includes('加作业/汇报'), '');

  check('日程页提供课程调整入口', scheduleText.includes('课程调整'), '');
  check(
    '日程可切换日期与设置假日',
    view.container.querySelector('[aria-label="前一天"]') !== null &&
      view.container.querySelector('[aria-label="查看日期"]') !== null &&
      view.container.querySelector('[aria-label="后一天"]') !== null &&
      (view.container.querySelector('[aria-label="设为假日"]') !== null ||
        view.container.querySelector('[aria-label="设为非假日"]') !== null),
    '',
  );
  if (clickByText(view.container, '课程调整')) await flush(12);
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
