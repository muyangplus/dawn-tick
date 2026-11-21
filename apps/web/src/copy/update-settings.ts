/** 设备与同步 · 更新分组：检查更新、渠道开关、下载源、忽略版本、回滚与近期更新。 */
import { fail } from './common.ts';

export const updateSettingsCopy = {
  devFeaturesLabel: '开发者特性',
  devFeaturesDescription: '关闭后按正式版运行',
  inAppOnly: '只在应用内检查版本',

  checkButton: '检查更新',
  releasePageAria: '打开发布页（GitHub）',
  releasePageLink: '打开发布页',
  receiveBetaLabel: '接收测试版更新',
  receiveBetaDescriptionBeta: '关闭后只收正式版',
  receiveBetaDescriptionRelease: '开启后也收测试版',
  devChannelNote: '开发版只接收开发构建',
  autoCheckLabel: '自动检查版本更新',
  autoCheckDescription: '启动后检查一次，有新版本时弹窗',
  releaseNotesLabel: '更新后显示新版本内容',
  releaseNotesDescription: '升级后首次打开时弹出更新内容',
  downloadSourceLabel: '下载源',
  downloadSourceHelp: '自动检测同时探测 Gitee 与 GitHub，选响应快的。某个源不可用或还没发布时，自动换另一个源。',
  redetectAria: '重新检测下载源',
  redetectButton: '重新检测',
  ignoredVersion: (version: string) => `已忽略的版本：${version}`,
  unignoreAria: '取消忽略版本',
  unignoreButton: '取消忽略',
  unignoredToast: '已取消忽略。下次检查会再提示该版本',
  unignoreFailed: (reason: string) => fail('取消忽略', reason, '请稍后再试'),
  rollbackButton: '回滚到正式版',
  rollbackChannelNote: (channel: string) => `当前为${channel}`,
  betaWarningTitle: '开启测试版更新？',
  betaWarningDescription:
    '测试版先于正式版收到改动，可能包含未完成或不稳定的功能。出问题时请在「应用诊断日志」导出日志反馈。',
  cancel: '取消',
  betaWarningConfirm: '开启测试版更新',

  checkingLabel: '正在检查更新…',
  checkFailed: { what: '检查更新', next: '请稍后再试' },
  checkFailedText: (reason: string) => fail('检查更新', reason, '请稍后再试'),
  /** 来源说明：`正式版，来源 GitHub`，回退时追加 `；Gitee 不可用，已回退` */
  checkSource: (channel: string, source: string, fallbackFrom?: string) =>
    fallbackFrom === undefined
      ? `${channel}，来源 ${source}`
      : `${channel}，来源 ${source}；${fallbackFrom} 不可用，已回退`,
  checkFound: (version: string | null, source: string) => `发现新版本 ${version ?? ''}（${source}）`,
  checkFoundIgnored: (version: string | null, source: string) =>
    `发现新版本 ${version ?? ''}（${source}）。此版本已忽略`,
  checkLatest: (source: string) => `已是最新版本（${source}）`,

  rollbackTitle: '回滚到正式版？',
  rollbackDescription: (current: string, channel: string) =>
    `将安装最新正式版（当前 ${current} · ${channel}）。课表、待办、提醒、设置与快照都会保留。安装后不再接收测试版与开发版。`,
  rollbackNoPackage: '最新正式版没有自动安装包',
  rollbackStarted: (version: string) => `已开始安装正式版 ${version}。请按提示完成安装`,
  rollbackFailed: (reason: string) => fail('回滚到正式版', reason, '请稍后再试，或到发布页手动下载'),
  rollbackDownloadFailed: (reason: string | null) => fail('回滚到正式版', reason, '请稍后再试'),
  rollbackCancelDownload: '取消下载',
  rollbackRetry: '重试',
  rollbackStart: '开始回滚',
  rollbackLater: '稍后',
  rollbackNoReleaseList: '读不到正式版发布记录',
  rollbackNoRelease: '还没有正式版发布',
  ignoreEmptyVersion: '要忽略的版本号为空',
  releasesOffline: '当前环境无法联网检查更新',
  releasesNotFound: '该仓库还没有发布记录',
  releasesRateLimited: 'GitHub 接口限流，请稍后再试',
  releasesHttpStatus: (status: number) => `更新源返回 ${status}`,

  recentButton: '近期更新',
  recentTitle: '近期更新',
  recentDescription: '按发布时间倒序',
  recentEmpty: '还没有更新记录',
  recentBeta: '测试版',
  recentVersion: (version: string) => `v${version}`,
  recentDetailAria: (version: string) => `打开发布 v${version} 的 Release 页面`,
  recentDetail: '详情',
  recentClose: '关闭',
} as const;
