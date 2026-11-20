/** 选校：学校搜索、筛选、适配徽标，以及按学校套用作息。 */
export const schoolCopy = {
  /** 选校弹窗 */
  dialogTitle: '选择学校',
  dialogDescription: '创建学期时按该校作息排好节次',
  closeAria: '关闭选校',
  cancel: '取消',

  /** 学校列表 */
  recentGroup: '最近使用',
  otherProvince: '其他',
  searchLabel: '搜索学校',
  searchPlaceholder: '校名 / 简称 / 拼音',
  filterAllAria: '筛选 全部',
  filterAll: '全部',
  filterAria: (tag: string) => `筛选 ${tag}`,
  moreTagsAria: '更多标签',
  collapseTags: '收起标签',
  moreTags: (count: number) => `更多标签（${count}）`,
  provinceAria: '地区',
  allProvinces: '全部地区',
  /** 结果计数行：共 120 所 · 仅显示前 50 所 · 筛选 985 · 江苏省 */
  resultCount: (total: number, shown: number | null, tag: string | null, province: string | null) =>
    [
      `共 ${total} 所`,
      shown === null ? null : `仅显示前 ${shown} 所`,
      tag === null ? null : `筛选 ${tag}`,
      province,
    ]
      .filter((part) => part !== null)
      .join(' · '),
  resultsAria: (searchLabel: string) => `${searchLabel}结果`,
  noMatch: '没有匹配的学校，请换个关键词（校名、简称、拼音首字母均可）',
  rowAria: (name: string, subtitle: string, badge: string) =>
    subtitle === '' ? `${name}，${badge}` : `${name}，${subtitle}，${badge}`,
  picked: '已选',
  requestAdapterAria: (name: string) => `请求适配 ${name}`,
  requestAdapter: '请求适配',
  presetLoading: '正在读取预设…',
  presetUnavailable: (problem: string) => `预设索引不可用：${problem}`,
  presetFooter: (version: string) => `预设 ${version} · 已适配=有解析脚本`,
  notFound: '找不到你的学校？',
  submitSchool: '提交学校信息',

  /** 请求适配的 Issue 标题 */
  issueDefaultTitle: '[学校适配] 提交学校信息',
  issueTitle: (name: string) => `[学校适配] ${name}`,

  /** 适配徽标与未适配原因（悬停显示） */
  adapted: (version: string) => `已适配 ${version}`,
  notAdapted: '暂未适配',
  presetReading: '预设还在读取中',
  indexUnavailable: '预设索引不可用',
  noSystemForSchool: '预设索引里没有该校教务系统',
  systemMissing: (systemId: string) => `预设索引里没有教务系统 ${systemId}`,
  noParser: (systemName: string) => `教务系统 ${systemName} 还没有解析脚本`,
  schoolMissing: '预设索引里没有这所学校',
  noTimetablePath: '预设索引里该校没有作息路径',
  noTimetableInSnapshot: '快照里没有该校作息',
  timetableMissing: (id: string) => `生效的预设里没有作息 ${id}`,
  fallbackUnavailable: '内置通用作息不可用，请重新安装应用',

  /** 按学校套用作息 */
  cardTitle: '按学校套用作息',
  cardHint: '按该校作息重排节次',
  pickAria: '按学校套用作息',
  pickButton: '选择学校',
  applyRecentAria: (name: string) => `一键套用 ${name} 的作息`,
  applyRecent: (name: string) => `一键套用：${name}`,
  applying: '正在按学校套用作息…',
  appliedExclusive: (name: string, count: number) => `已套用「${name}」作息（${count} 节）`,
  appliedFallback: (count: number) => `该校没有专属作息，已套用通用作息（${count} 节）`,
  appliedMessageExclusive: (name: string, count: number) => `已套用 ${name} 的作息（${count} 节）`,
  appliedMessageFallback: '该校没有专属作息，已套用通用作息',
  applyFailWhat: '套用失败',
  applyFailReason: '作息没能写入本机',
  applyFailNext: '请重试；仍失败请重启应用',
  presetBuiltIn: (version: string) => `预设 ${version}（内置）`,
  presetCached: (version: string) => `预设 ${version}（已更新）`,
  slotsNone: '当前没有节次',
  slotsCount: (count: number) => `当前 ${count} 个节次`,
  lastApplied: (school: string, timetable: string, periods: number, exclusive: boolean) =>
    ` · 上次套用：${school} → ${timetable}（${periods} 节，${exclusive ? '专属作息' : '通用作息'}）`,
  source: (source: string) => `作息来源：${source}`,
  dialogApplyDescription: '按学校作息重排节次',
} as const;
