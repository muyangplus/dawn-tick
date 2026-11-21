import { COUNT } from './common.ts';

/** 课表导入流程：选择方式、步骤条、预览与完成。 */
export const importFlowCopy = {
  channels: {
    paste: {
      title: '粘贴文本 / 文件',
      scenario: '适用：自己登录教务后复制网页课表，或已有课表文件',
      output: '产出：解析出的排课预览，勾选后导入',
      formats: '网页文本 · CSV · Excel · ICS',
    },
    window: {
      title: '教务系统内嵌窗口',
      scenario: '适用：Windows / Android 上用应用内窗口登录教务',
      output: '产出：从窗口带回页面并直接解析为排课',
    },
    manual: {
      title: '手动添加',
      scenario: '适用：只补一两门课，或自动识别总是不准',
      output: '产出：打开课程表单逐门录入，不经过预览',
    },
  },
  backupHint: '备份恢复（JSON / Base64 / 整包 zip）在「设备与同步 → 备份恢复」',

  /** 步骤条 */
  steps: ['选择方式', '获取课表', '预览', '完成'],
  compactStep: (step: number, total: number, title: string) => `第 ${step}/${total} 步 · ${title}`,
  stepsAria: '导入步骤',
  backAria: '上一步',
  back: '上一步',
  stepProgress: (step: number, total: number) => `当前第 ${step} 步 / 共 ${total} 步`,

  /** 预览 */
  summary: (count: number, selected: number) => `解析到 ${COUNT('schedule', count)}排课，已选 ${COUNT('schedule', selected)}`,
  summaryConflicts: (base: string, conflicts: number) => `${base} · 其中 ${COUNT('schedule', conflicts)}重复`,
  unsupportedFile: (fileName: string) => `不支持「${fileName}」：请选择 .csv / .xlsx / .ics 文件`,
  weekday: (day: number) => `周${day}`,
  periods: (start: number, end: number) => `${start}-${end} 节`,
  weeks: (count: number) => `${count} 周`,
  roomNone: '—',
  conflictOnly: (count: number) => (count > 0 ? `只看冲突项（${count}）` : '只看冲突项'),
  selectAll: '全选',
  selectNone: '清空',
  invert: '反选',
  filterNote: '批量选择只作用于可见行',
  noConflicts: '没有冲突项',
  warningSeparator: '；',
  confirm: '确认导入',
  previewBack: '返回',
  columns: {
    pick: '选',
    course: '课程',
    weekday: '星期',
    periods: '节次',
    weeks: '周次',
    room: '地点',
  },
  pickAria: (name: string) => `选择 ${name}`,
  duplicate: '重复，将被跳过',

  importing: '正在导入课表…',
  importFail: { what: '导入课表失败', next: '请检查文件与勾选项后重试' },
  imported: (courses: number, schedules: number, skipped: number) =>
    `已导入课程 ${COUNT('course', courses)}、排课 ${COUNT('schedule', schedules)}，跳过重复 ${COUNT('schedule', skipped)}`,

  /** 完成 */
  doneTitle: '导入完成',
  importMore: '继续导入',
  finish: '完成',
} as const;
