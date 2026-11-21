/** 更新弹窗、渠道提示、更新内容弹窗与后台下载面板（components/update/）。 */
import { fail } from './common.ts';

export const updateDialogCopy = {
  // 弹窗头部
  title: (version: string) => `发现新版本 ${version}`,
  description: (channel: string, current: string) => `发布渠道 ${channel} · 当前版本 ${current}`,
  current: (version: string) => `当前 ${version}`,
  source: (source: string, fallbackFrom: string | null) =>
    fallbackFrom === null ? `下载源 ${source}` : `下载源 ${source}（${fallbackFrom} 不可用，已回退）`,
  notesLink: '详细说明',
  notesSummary: '发布说明',
  ignoredNote: '已忽略此版本',
  unavailable: (reason: string) => fail('自动更新', reason, '请到发布页下载'),
  installKind: (label: string) => `版本类型：${label}`,
  progressAria: '下载进度',
  progressNoPercent: '已下载',
  progressPercent: (percent: number) => `${percent}%`,

  // 底部与「更多」
  cancel: '取消',
  later: '稍后',
  moreAria: '更多更新操作',
  more: '更多',
  unignore: '取消忽略此版本',
  ignore: '忽略此版本',
  ignoring: '正在忽略…',
  background: '后台下载并关闭',
  retry: '重试',
  openRelease: '打开发布页',
  copyLink: '复制下载链接',

  // 主按钮与状态行（update-dialog-model.ts）
  primary: { update: '立即更新', install: '安装更新', refresh: '立即更新', 'download-web': '立即更新' },
  portableInstall: '继续更新并退出',
  installing: '正在安装更新…',
  verifying: '正在校验安装包…',
  ready: '安装包已就绪',
  cancelled: '已取消下载',
  installedReady: '更新已就绪。请按提示完成',
  allowUnknownApps: '请允许安装未知应用后重试',
  downloadFailed: (reason: string | null) => fail('下载更新', reason, '请稍后重试'),
  webDownloadHint: '「立即更新」将下载 Web 版安装包',
  webRefreshHint: '「立即更新」将刷新页面',
  portableHint: '校验通过后应用将自动退出、替换并重启',
  installerHint: '校验通过后自动开始安装',

  // toast
  linkCopied: '已复制下载链接',
  copyFailed: fail('复制', null, '请手动选中链接复制'),
  releaseOpened: '已在默认浏览器打开发布页',
  browserFailed: fail('打开浏览器', null, '请改用「更多 → 复制下载链接」'),
  installerLaunched: '安装程序已启动。请按提示完成安装',
  prepareFailed: (portable: boolean, reason: string | null) =>
    fail(portable ? '准备便携版更新' : '下载更新', reason, '请稍后重试'),
  updateFailed: (reason: string) => fail('更新', reason, '请稍后重试'),
  updateReady: '更新已就绪',
  webDownloadStarted: '已开始下载 Web 版安装包',
  webDownloadFailed: fail('打开下载地址', null, '请改用「更多 → 复制下载链接」'),
  backgrounded: '已转到后台下载。进度见设备页',
  ignored: '已忽略该版本。不再自动提示',
  unignored: '已取消忽略。下次检查会再提示该版本',
  ignoreWhat: '忽略版本',
  unignoreWhat: '取消忽略',
  ignoreFailed: (what: string, reason: string) => fail(what, reason, '请稍后再试'),

  // 后台下载面板（update-task-panel.tsx）
  taskLabel: '后台下载',
  taskStatus: {
    downloading: '正在后台下载',
    verifying: '正在校验并写入安装包',
    ready: '安装包已就绪',
    failed: '后台下载失败',
    cancelled: '已取消下载',
  },
  taskHint: {
    downloading: '关闭弹窗后下载继续',
    verifying: '校验通过后可安装',
    ready: '由系统安装器完成安装',
    failed: '反复失败请到发布页手动下载',
    cancelled: '继续会从头下载',
  },
  taskHintPortableReady: '应用退出时替换 exe 并自动重启',
  taskInstallFailed: (portable: boolean, reason: string | null) =>
    fail(portable ? '准备便携版更新' : '启动安装程序', reason, '请稍后重试'),
  taskPrimaryWeb: '刷新页面',
  taskPrimaryPortable: '更新并退出',
  taskPrimaryInstall: '安装',
  taskVersion: (version: string | null) => `版本 ${version ?? '—'}`,
  taskSource: (source: string) => `来源 ${source}`,
  taskContinue: '继续下载',
  taskDismiss: '关闭',

  // 渠道提示（notice-dialog.tsx）
  noticeBetaTitle: '测试版提示',
  noticeDevTitle: '开发版提示',
  noticeBetaDescription: '测试版可能不稳定',
  noticeDevDescription: '开发版仅用于开发与测试',
  noticeBetaDetail: '测试版先于正式版收到改动，可能包含未完成的功能。反馈问题时请附上「应用诊断日志」。',
  noticeDevDetail: '开发版随每次提交滚动更新，不保证稳定。测试版开关对开发版无效。',
  noticeDownloadRelease: '下载正式版',
  noticeBetaContinue: '继续使用测试版',
  noticeDevContinue: '继续使用开发版',

  // 更新内容（release-notes-dialog.tsx）
  releaseNotesTitle: (version: string) => `已更新到 ${version}`,
  releaseNotesDescription: '本次更新内容',
  releaseNotesDisable: '不再显示',
  releaseNotesClose: '关闭',
} as const;
