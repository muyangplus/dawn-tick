/**
 * 应用壳文案：侧栏、底栏、工具栏、加载页、错误页、待重启条与远端备份弹窗。
 */
import { fail, OVERWRITE } from './common.ts';

const APP_NAME = '晓刻 DawnTick';

const weekLabel = (week: number): string => `第 ${week} 周`;

export const appShellCopy = {
  appName: APP_NAME,
  rootMissing: '#root 缺失',
  sidebarSubtitle: (semester: string, week: number) => `${semester} · ${weekLabel(week)}`,
  windowAria: (range: string, week: number) => `查看窗口 ${range} · ${weekLabel(week)}`,
  courseDetailTitle: '课程详情',
  courseNotFound: '找不到这门课',

  storageKind: {
    indexeddb: '浏览器 IndexedDB',
    sqlite: '原生 SQLite',
    memory: '内存（测试）',
  },

  channel: {
    dev: '开发版',
    beta: '测试版',
    release: '正式版',
  },

  nav: {
    timetable: '课表',
    schedule: '日程',
    settings: '设置',
    devices: '设备与同步',
    help: '帮助',
    mainAria: '主导航',
    expandSidebar: '展开侧栏',
    collapseSidebar: '收起侧栏',
    shortcuts: '快捷键：/ 搜索 · ← → 平移一屏 · T 回到今天',
  },

  toolbar: {
    semesterAria: '选择学期',
    prevWindowAria: '上一屏',
    nextWindowAria: '下一屏',
    weekLabel,
    currentWeekSuffix: ' · 本周',
    prevDayAria: '前一天',
    nextDayAria: '后一天',
    todayAria: '回到今天',
    todayButton: '今天',
    weekTab: '周',
    dayTab: '日',
    helpAria: '帮助',
    searchAria: '搜索',
  },

  loading: {
    title: '正在载入…',
    slow: '仍在载入…',
  },

  errorScreen: {
    restoreFromFileButton: '从备份文件恢复',
    openBackupDirButton: '打开备份目录',
    retryButton: '重试',
    openLogsButton: '打开日志',
  },

  restartBar: {
    pending: (count: number) => `${count} 项改动待重启`,
    restartButton: '立即重启',
    expandButton: '展开',
    expandAria: '展开待重启提示',
    laterButton: '稍后',
    restartFailed: fail('重启', null, '请手动重新打开应用'),
  },

  remoteNewer: {
    title: '远端有较新的备份',
    description: (name: string, detail: string | null) =>
      `${name}${detail === null ? '' : ` · ${detail}`}。「恢复全部」${OVERWRITE('远端备份', '')}。下载前先备份本机`,
    laterButton: '稍后',
    applySettingsButton: '只应用设置与预设',
    applySettingsAria: '下载并只应用设置与预设',
    restoreAllButton: '恢复全部',
    restoreAllAria: '下载并恢复整库',
  },

  session: {
    downloadFailed: { what: '下载失败', unknownReason: '未知原因', next: '请检查同步设置后重试' },
    settingsApplied: (backedUp: boolean) => `已应用远端设置与预设${backedUp ? '（已先备份本机）' : ''}`,
    restored: (imported: number) => `已恢复整库（写入 ${imported} 条）`,
  },
} as const;
