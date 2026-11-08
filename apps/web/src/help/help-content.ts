/**
 * 帮助模块的静态内容：分类、条目、引导式步骤与「去设置」目标。
 *
 * 只放纯数据与过滤函数，图标在 `help-view.tsx` 里按 `icon` 映射，
 * 这样单测可以在 Node 下直接导入本文件，不必加载 React 组件。
 *
 * 内容口径：全部中文，并且只描述当前版本真实存在的功能与入口。
 */

export type HelpIconId = 'update' | 'lan' | 'backup' | 'import' | 'widget' | 'notify' | 'storage' | 'about';

/** 「去设置」目标：pages 与 App 的 NavId 对齐，group 与分组导航的 data-group 对齐。 */
export interface HelpTarget {
  page: 'settings' | 'devices';
  group: string;
  /** 按钮文案里的目标分组名，例如「更新」「局域网同步」 */
  label: string;
}

export interface HelpEntry {
  id: string;
  title: string;
  /** 一句话说明：列表里直接可见 */
  summary: string;
  /** 搜索关键词：覆盖同义说法与常见报错 */
  keywords: readonly string[];
  /** 有序步骤：展开后按 1/2/3 显示 */
  steps: readonly string[];
  /** 可选的「去设置」目标 */
  goTo?: HelpTarget;
}

export interface HelpCategory {
  id: string;
  title: string;
  description: string;
  icon: HelpIconId;
  entries: readonly HelpEntry[];
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    id: 'update',
    title: '更新与下载源',
    description: '发现新版本后怎么更新、下载源怎么选、测试版与回滚。',
    icon: 'update',
    entries: [
      {
        id: 'update-one-click',
        title: '一键更新（立即更新）',
        summary: '点一次「立即更新」，应用会自动下载、校验并进入安装。',
        keywords: ['更新', '立即更新', '一键', '下载', '校验', '安装', '便携版', '后台下载'],
        steps: [
          '发现新版本时打开更新提示，点「立即更新」。',
          '应用自动下载并校验安装包；校验通过后自动开始安装，不用再点第二次。',
          'Windows 安装版会直接启动安装程序；便携版会准备替换并退出应用，随后自动重启。',
          '想稍后再装可点「更多 → 后台下载并关闭」，之后在「设备与同步 → 更新」里继续。',
        ],
        goTo: { page: 'devices', group: 'update', label: '更新' },
      },
      {
        id: 'update-source',
        title: '下载源与自动检测',
        summary: '默认自动检测 Gitee 与 GitHub，选完成更快的源。',
        keywords: ['下载源', '自动检测', 'Gitee', 'GitHub', '回退', '版本', '源'],
        steps: [
          '进入「设备与同步 → 更新」，找到「下载源」。',
          '默认「自动检测」会同时探测 Gitee 与 GitHub 的 version.json，选完成快的源。',
          '某个源不可用或还没有发布时，会自动回退到另一个源；也可以手动固定 Gitee 或 GitHub。',
          '自动更新失败时，可用「更多 → 复制下载链接」或「打开发布页」手动下载。',
        ],
        goTo: { page: 'devices', group: 'update', label: '更新' },
      },
      {
        id: 'update-channel',
        title: '版本渠道与测试版',
        summary: '开发版、测试版、正式版的区别，以及怎么回滚。',
        keywords: ['渠道', '测试版', 'beta', '正式版', '开发版', '回滚', '接收测试版'],
        steps: [
          '「关于」页与应用信息里会显示当前版本与发布渠道（开发版 / 测试版 / 正式版）。',
          '在「更新」分组打开「接收测试版更新」后，会同时收到测试版。',
          '测试版可能不稳定；出问题时可在「诊断与维护」导出诊断日志反馈。',
          '桌面端可在「更新」分组点「回滚到正式版」。',
        ],
        goTo: { page: 'devices', group: 'update', label: '更新' },
      },
    ],
  },
  {
    id: 'lan',
    title: '局域网配对与扫码',
    description: '两台设备在同一局域网直传课表、待办与设置。',
    icon: 'lan',
    entries: [
      {
        id: 'lan-pair',
        title: '扫码配对两台设备',
        summary: '一台显示配对二维码，另一台用「扫一扫」即可填入并配对。',
        keywords: ['局域网', '配对', '扫码', '二维码', '扫一扫', '地址', '配对码', 'ping', '推送', '拉取'],
        steps: [
          '确保两台设备在同一局域网，并打开「设备与同步 → 局域网同步」。',
          '一台设备点「开启配对」，页面会显示配对二维码；Android 端也可用顶部工具区的「扫一扫」扫描。',
          '扫到配对信息后会自动填入对方地址与配对码，并先预检 /ping。',
          '配对成功后可在设备列表里选择推送或拉取，并勾选要同步的课表、待办或设置。',
        ],
        goTo: { page: 'devices', group: 'lan', label: '局域网同步' },
      },
      {
        id: 'lan-web',
        title: '浏览器端作为发起方',
        summary: '浏览器端只能主动连接对方，不能开启被配对。',
        keywords: ['浏览器', 'Web', '发起方', '配对', '快照', '推送'],
        steps: [
          '浏览器端只作为局域网同步的发起方，不显示「开启配对」。',
          '在「设备与同步 → 局域网同步」填写对方地址与配对码。',
          '推送会覆盖对方所选内容；下载前应用会先建一次快照，便于回退。',
        ],
        goTo: { page: 'devices', group: 'lan', label: '局域网同步' },
      },
    ],
  },
  {
    id: 'backup',
    title: '备份与恢复 / 数据库修复',
    description: '快照、导出导入、口令加密与数据库损坏后的恢复。',
    icon: 'backup',
    entries: [
      {
        id: 'backup-snapshot',
        title: '快照与恢复',
        summary: '自动快照 + 手动新建快照，出问题时从最近快照恢复。',
        keywords: ['快照', '备份', '恢复', '恢复快照', '自动快照', '保留份数', '加密'],
        steps: [
          '进入「设备与同步 → 备份与恢复」，开启自动快照并设置保留份数。',
          '点「新建快照」立即生成一份（Windows 端是整库文件快照，Web 与 Android 是库内 JSON 快照）。',
          '在快照列表点「恢复」；文件快照会排队到下次启动生效。',
          '恢复前应用会再建一份安全快照；快照本身不加密，口令加密只覆盖导出的文件。',
        ],
        goTo: { page: 'devices', group: 'backup', label: '备份与恢复' },
      },
      {
        id: 'backup-transfer',
        title: '导出 / 导入备份',
        summary: '可选模块、JSON / Base64 / 整包 zip，还可用口令加密。',
        keywords: ['导出', '导入', '备份', 'JSON', 'Base64', 'zip', '加密', '迁移'],
        steps: [
          '进入「设备与同步 → 本地存储」，找到「导出与导入」。',
          '「导出备份」可选模块与格式（JSON 文件、Base64 文本、整包 zip），并可勾选口令加密。',
          '「导入备份」支持选择文件或粘贴 Base64 文本，确认模块后合并。',
          '跨设备迁移前建议先导出整包备份。',
        ],
        goTo: { page: 'devices', group: 'storage', label: '本地存储' },
      },
      {
        id: 'db-corrupt',
        title: '数据库损坏与修复',
        summary: '损坏时停止写入，优先从最近快照恢复。',
        keywords: ['数据库', '损坏', '修复', '恢复', '快照', '诊断日志', '数据目录'],
        steps: [
          '启动或运行中数据库损坏时，应用会停止写入并弹出恢复对话框。',
          '优先点「立即恢复并重启」从最近快照恢复；失败可「打开数据目录」手动处理。',
          '启动错误页也可点「从备份文件恢复」或「打开备份目录」。',
          '恢复后仍异常时，进入「诊断与维护」导出诊断日志反馈。',
        ],
        goTo: { page: 'devices', group: 'maintenance', label: '诊断与维护' },
      },
    ],
  },
  {
    id: 'import',
    title: '教务导入',
    description: '从网页课表、教务窗口、ICS、CSV、Excel 导入课程与排课。',
    icon: 'import',
    entries: [
      {
        id: 'import-timetable',
        title: '导入教务课表',
        summary: '设置页「导入课表」按向导选择渠道、预览并合并。',
        keywords: ['导入', '教务', '课表', '网页', 'ICS', 'CSV', 'Excel', '预览', '合并', '学校'],
        steps: [
          '进入「设置」，点页面顶部的「导入课表」。',
          '选择网页课表、教务系统内嵌窗口、ICS、CSV 或 Excel 等渠道。',
          '按向导选择学校 / 学期并预览识别结果，确认后合并进当前课表。',
          '导入前建议先建一份快照；失败时向导会给出可读原因。',
        ],
        goTo: { page: 'settings', group: 'semesters', label: '学期设置' },
      },
      {
        id: 'import-course',
        title: '导入后的课程管理',
        summary: '导入的课程与排课可在学期设置里继续调整。',
        keywords: ['课程', '管理', '学期', '排课', '周次', '开学日期'],
        steps: [
          '进入「设置 → 学期设置」，展开课程管理。',
          '可新增 / 编辑课程与排课，导入的课程也会出现在这里。',
          '学期开始日期与总周数决定周次计算，导入后核对一下。',
        ],
        goTo: { page: 'settings', group: 'semesters', label: '学期设置' },
      },
    ],
  },
  {
    id: 'widget',
    title: '小组件与悬浮窗',
    description: '悬浮窗样式、桌面小组件，以及加载失败时回到主窗口。',
    icon: 'widget',
    entries: [
      {
        id: 'widget',
        title: '悬浮窗与桌面小组件',
        summary: '在设置里选样式与颜色，失败时点小组件会打开主窗口。',
        keywords: ['悬浮窗', '小组件', '桌面', '固定', '错误', '主窗口', '权限'],
        steps: [
          '进入「设置 → 悬浮窗与小组件」，选择样式与颜色。',
          '桌面端可固定悬浮窗；Android 可把小组件添加到桌面。',
          '悬浮窗或小组件加载失败时，点它会打开主窗口继续操作。',
          '需要通知权限时按提示授权，否则提醒不会弹出。',
        ],
        goTo: { page: 'settings', group: 'widget', label: '悬浮窗与小组件' },
      },
    ],
  },
  {
    id: 'notify',
    title: '通知与权限',
    description: '课前提醒不弹时，先检查通知权限与免打扰。',
    icon: 'notify',
    entries: [
      {
        id: 'notify-permission',
        title: '通知权限',
        summary: '未授权时按提示申请；Android 可直达系统通知设置。',
        keywords: ['通知', '权限', '提醒', '课前', '免打扰', '静音', 'Android'],
        steps: [
          '进入「设置 → 提醒设置」，查看通知状态。',
          '未授权时按提示申请；Android 还会跳到系统通知设置。',
          '允许通知后，课前提醒按提前分钟数弹出。',
          '若开启了系统免打扰或渠道静音，提醒同样不会出现。',
        ],
        goTo: { page: 'settings', group: 'reminders', label: '提醒设置' },
      },
      {
        id: 'notify-miss',
        title: '提醒没有弹出',
        summary: '权限、免打扰、提醒开关与测试提醒逐项排查。',
        keywords: ['提醒', '没弹', '测试', '免打扰', '日志'],
        steps: [
          '检查通知权限与系统免打扰。',
          '确认课程 / 日程的提醒开关与提前时间。',
          '确认系统没有限制应用后台运行或通知渠道被静音。',
          '仍不弹时，到「诊断与维护」导出诊断日志反馈。',
        ],
        goTo: { page: 'settings', group: 'reminders', label: '提醒设置' },
      },
    ],
  },
  {
    id: 'storage',
    title: '数据目录与 WebDAV',
    description: '数据库位置、自定义存储目录与 WebDAV 云同步。',
    icon: 'storage',
    entries: [
      {
        id: 'storage-dir',
        title: '数据目录与存储位置',
        summary: '桌面端可自定义存储位置，改完需重启生效。',
        keywords: ['数据目录', '存储位置', '数据库', '文件', '便携版', '安装版', '重启'],
        steps: [
          '进入「设备与同步 → 本地存储」，查看数据库文件与大小。',
          '桌面端可自定义存储位置；留空用默认，改完需重启生效。',
          '「打开数据目录」可定位数据库与日志文件。',
          '便携版与安装版默认目录不同，迁移前先确认。',
        ],
        goTo: { page: 'devices', group: 'storage', label: '本地存储' },
      },
      {
        id: 'webdav',
        title: 'WebDAV 同步',
        summary: '填完整目录地址与账号密码，密码加密保存在本机。',
        keywords: ['WebDAV', '地址', '账号', '密码', '加密', '上传', '下载', '快照', '测试连接'],
        steps: [
          '进入「设备与同步 → WebDAV 同步」，填写完整目录地址、账号与密码。',
          '密码加密保存在本机，界面不回显。',
          '上传前可先建快照；下载前应用会自动建一次快照。',
          '连接失败时先点「测试连接」，确认地址与网络。',
        ],
        goTo: { page: 'devices', group: 'webdav', label: 'WebDAV 同步' },
      },
    ],
  },
  {
    id: 'about',
    title: '版本渠道说明',
    description: '当前渠道、近期更新与反馈时该带哪些信息。',
    icon: 'about',
    entries: [
      {
        id: 'channel',
        title: '开发版 / 测试版 / 正式版',
        summary: '不同渠道收到的更新不同；正式版可自行决定是否接收测试版。',
        keywords: ['开发版', '测试版', '正式版', '渠道', '更新', '回滚'],
        steps: [
          '侧栏底部与「关于」里可看到当前渠道。',
          '开发版只接收开发构建；测试版默认接收测试版更新。',
          '正式版默认只收正式版，可在「更新」分组打开「接收测试版更新」。',
          '收到不合适的测试版时，可关闭开关或回滚到正式版。',
        ],
        goTo: { page: 'devices', group: 'update', label: '更新' },
      },
      {
        id: 'about-diagnostics',
        title: '反馈与诊断日志',
        summary: '反馈时附上版本号、渠道与诊断日志，更容易定位。',
        keywords: ['反馈', '诊断', '日志', '版本', '仓库', '关于'],
        steps: [
          '进入「设备与同步 → 诊断与维护」，可打开或导出诊断日志。',
          '「关于」页有「帮助与反馈」与仓库入口。',
          '反馈时附上版本号、渠道与诊断日志，便于定位问题。',
        ],
        goTo: { page: 'devices', group: 'maintenance', label: '诊断与维护' },
      },
    ],
  },
];

/** 全部条目数：界面用来展示「共 N 条」。 */
export const HELP_ENTRY_COUNT = HELP_CATEGORIES.reduce((total, category) => total + category.entries.length, 0);

export interface HelpSearchResult {
  /** 过滤后的分类（只保留还有条目的分类） */
  categories: readonly HelpCategory[];
  /** 命中条目总数 */
  total: number;
}

/** 一条条目参与搜索的全部文本：标题、一句话说明、关键词、步骤与分类名。 */
function searchText(category: HelpCategory, entry: HelpEntry): string {
  return [category.title, entry.title, entry.summary, entry.keywords.join(' '), entry.steps.join(' ')]
    .join(' ')
    .toLowerCase();
}

/**
 * 按标题、关键词与正文过滤帮助内容。
 * 空查询返回全部分类；没有命中时返回空分类与 total=0（界面据此显示空态）。
 */
export function searchHelp(query: string): HelpSearchResult {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { categories: HELP_CATEGORIES, total: HELP_ENTRY_COUNT };
  const categories: HelpCategory[] = [];
  let total = 0;
  for (const category of HELP_CATEGORIES) {
    const entries = category.entries.filter((entry) => searchText(category, entry).includes(needle));
    if (entries.length === 0) continue;
    categories.push({ ...category, entries });
    total += entries.length;
  }
  return { categories, total };
}

/** 通过 id 取条目：冒烟与单测用它核对「去设置」目标，不依赖数组顺序。 */
export function findHelpEntry(id: string): HelpEntry | null {
  for (const category of HELP_CATEGORIES) {
    const entry = category.entries.find((item) => item.id === id);
    if (entry !== undefined) return entry;
  }
  return null;
}
