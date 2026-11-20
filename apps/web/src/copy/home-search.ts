/** 全局搜索弹窗。 */
export const searchCopy = {
  title: '搜索',
  description: '课程、教师、地点、周次与日程',
  placeholder: '输入关键词',
  inputLabel: '搜索关键词',
  idleTitle: '输入关键词开始搜索',
  noResultTitle: '没有匹配结果',
  clearButton: '清空关键词',
  kind: {
    course: '课程',
    schedule: '排课',
    event: '日程',
  },
  /** 结果第二行：类型 · 副标题 */
  hitMeta: (kind: string, subtitle: string) => (subtitle.length > 0 ? `${kind} · ${subtitle}` : kind),
} as const;
