/** 周次选择器：快捷按钮与逐周勾选。 */
export const weekPickerCopy = {
  label: '周次',
  shortcuts: {
    all: '全部',
    odd: '单周',
    even: '双周',
    none: '清空',
  },
  shortcutAria: (label: string) => `周次${label}`,
  selected: (count: number, total: number) => `已选 ${count}/${total} 周`,
  groupAria: '周次选择',
  weekAria: (week: number) => `第 ${week} 周`,
} as const;
