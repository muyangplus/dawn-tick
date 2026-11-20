import { fail } from './common.ts';

/** 添加 / 编辑课程：课程信息、排课时段与颜色。 */
export const courseFormCopy = {
  createTitle: '添加课程',
  editTitle: '编辑课程',
  description: '课程信息与排课时段',
  saving: '正在保存课程…',
  created: '已添加课程',
  saved: '已保存课程',
  overlap: (name: string, range: string) => `与「${name}」${range}重叠，两门课都已保留`,
  saveFailed: (reason: string) => fail('保存课程', reason, '请重试'),

  nameLabel: '课程名',
  nameRequired: '请填写课程名',
  shortNameLabel: '简称',
  teacherLabel: '教师',
  locationLabel: '地点',
  creditsLabel: '学分',
  noteLabel: '备注',

  schedulesTitle: '排课时段',
  addSchedule: '增加时段',
  weekdayAria: '星期',
  periodStartAria: '起始节',
  periodEndAria: '结束节',
  period: (no: number) => `第 ${no} 节`,
  customTime: '自定义时间',
  startTimeAria: '开始时间',
  endTimeAria: '结束时间',
  roomLabel: '教室',
  removeScheduleAria: '删除此时段',

  colorTitle: '颜色',
  colorAria: (index: number) => `课程色 ${index}`,
  cancel: '取消',
  save: '保存',
} as const;
