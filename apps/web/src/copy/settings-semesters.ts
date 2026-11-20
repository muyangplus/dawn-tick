/** 设置 · 学期：学期列表、新建、编辑与删除。 */
import { COUNT, DELETE, fail } from './common.ts';

/** 学期写操作失败后的下一步 */
const RETRY_OR_RESTART = '请重试；仍失败请重开应用后再试。';

export interface SemesterRemoveCounts {
  courses: number;
  schedules: number;
  slots: number;
  events: number;
  reminders: number;
}

function removeParts(counts: SemesterRemoveCounts): string[] {
  return [
    `课程 ${COUNT('course', counts.courses)}`,
    `排课 ${COUNT('schedule', counts.schedules)}`,
    `节次 ${COUNT('period', counts.slots)}`,
    `日程 ${COUNT('event', counts.events)}`,
    `提醒 ${COUNT('reminder', counts.reminders)}`,
  ];
}

export const semestersCopy = {
  empty: '还没有学期。请在下方新建',
  meta: (startDate: string, weeks: number, timeZone: string) => `${startDate} 起 · ${weeks} 周 · ${timeZone}`,
  current: '当前',
  switchButton: '切换',
  editAria: (name: string) => `编辑学期 ${name}`,
  deleteAria: (name: string) => `删除学期 ${name}`,
  switchingLabel: '正在切换当前学期…',
  switchedToast: '已切换当前学期',
  switchFailed: { what: '切换学期失败', next: RETRY_OR_RESTART },

  newSummary: '新建学期',
  nameLabel: '学期名称',
  startLabel: '开学日期',
  startHint: '该周记为第 1 周',
  weeksLabel: '总周数',
  createButton: '创建并切换',
  creatingLabel: '正在新建学期…',
  createdToast: '已新建学期并设为当前学期',
  createFailed: { what: '新建学期失败', next: RETRY_OR_RESTART },

  editTitle: '编辑学期',
  editDescription: '修改会立即影响周次与课表计算',
  saveButton: '保存',
  timeZoneLabel: '时区',
  timeZoneInvalid: '时区名无效',
  editInvalid: fail('保存学期设置', '学期名称、开学日期或时区无效', '请修改后再保存'),
  savingLabel: '正在保存学期设置…',
  savedToast: '已保存学期设置',
  saveFailed: { what: '保存学期设置失败', next: '请重试；仍失败请重开应用后再改。' },

  deleteTitle: '删除学期',
  deleteConfirm: '确认删除',
  deleteDescription: (name: string, counts: SemesterRemoveCounts) => DELETE(name, removeParts(counts)),
  deletingLabel: '正在删除学期…',
  deleteFailed: { what: '删除学期失败', next: '请重试；仍失败请重开应用后再删。' },
  deletedToast: (name: string, counts: SemesterRemoveCounts) => `已删除「${name}」：${removeParts(counts).join('、')}`,
} as const;
