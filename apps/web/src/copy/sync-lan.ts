/**
 * 局域网同步的协议层文案：配对信息解析、客户端请求、服务端错误回复、网络探测与重连状态。
 * 设置页面板上的文案在 `copy/sync-lan-panel.ts`。
 */
export const lanSyncCopy = {
  // 本机名：写进对方的可信令牌列表
  deviceAndroid: 'Android 手机',
  deviceDesktop: 'Windows 电脑',
  deviceBrowser: '浏览器',
  unknownDevice: '未知设备',

  scopeTimetable: '课表',
  scopeTodos: '待办',
  scopeSettings: '设置',

  autoOff: '关闭',
  autoStartup: '每次启动',
  autoInterval30: '每 30 分钟',
  autoFailed: '自动同步失败',

  // 配对信息解析
  payloadEmpty: '配对信息为空：请扫码或粘贴对方显示的链接',
  payloadUnrecognized: '无法识别配对信息：请粘贴 dawn-tick://pair?… 或「IP:端口 配对码」',
  payloadVersionUnsupported: (version: string) => `配对信息版本 ${version} 不受支持：请升级应用`,
  payloadMissingHost: '配对信息缺少对方地址：请重新复制配对信息',
  payloadMissingCode: '配对信息缺少配对码：请重新复制配对信息',
  payloadLinkMissingQuery: '配对链接缺少参数：请重新生成二维码',
  payloadTextMissingCode: '配对信息缺少配对码：格式为「IP:端口 6 位配对码」',
  payloadBadPort: '端口无效：应为 1–65535',
  pairCodeFormat: '配对码应为 6 位数字',
  payloadHostNotLan: (host: string) => `对方地址 ${host} 不是局域网 IPv4：请填对方显示的地址`,

  // 已配对设备
  neverSynced: '未同步',
  lastSynced: (time: string) => `上次同步：${time}`,
  neverSeen: '未上线',
  lastSeen: (time: string) => `最近在线：${time}`,

  // 客户端请求
  pairTimeout: '配对请求超时：请确认两端在同一 Wi-Fi',
  peerUnreachable: '无法连接对方：请确认两端在同一 Wi-Fi，并关闭 VPN、代理与路由器 AP 隔离',
  connectTimeout: '连接对方超时',
  actionConnect: '连接对方',
  actionPair: '配对',
  actionRefresh: '刷新配对',
  actionUnpair: '移除配对',
  actionPull: '拉取',
  actionPush: '推送',
  actionPreview: '预览',
  httpFailed: (action: string, status: number) => `${action}失败（HTTP ${status}）`,
  pairNoToken: '对方未返回配对令牌',
  refreshNoToken: '对方未返回新令牌',
  scopeRequired: '请至少勾选一个同步范围',
  pairingExpired: '配对已过期，请重新配对',
  pushTooLarge: '推送数据超过 5MB：请减少同步范围',
  peerTimeout: (seconds: number) => `对方 ${seconds} 秒内没有响应`,
  nativeHttpIncomplete: '局域网原生 HTTP 返回不完整',
  noCapacitorHttp: '当前平台没有 CapacitorHttp',
  unreachable: '网络不可达',

  // 设备发现广播
  announceNameLength: '设备名应为 1–48 个字符',
  announceHostNotLan: '广播地址必须是局域网地址',
  announceBadPort: '广播端口无效',

  // 同步数据与服务端回复
  envelopeNotJson: '同步数据不是合法 JSON',
  envelopeBadShape: '同步数据结构不正确',
  envelopeWrongKind: '不是晓刻局域网同步数据',
  envelopeVersionUnsupported: (version: string) => `同步数据版本 ${version} 不受支持`,
  envelopeMissingBackup: '同步数据缺少备份内容',
  envelopeWrongFormat: '同步数据不是晓刻备份格式',
  requestTooLarge: '请求超过 5MB：请减少同步范围',
  methodOnly: (what: string, method: string) => `${what}只接受 ${method}`,
  routePing: '可达性检查',
  routePair: '配对',
  routeRefresh: '刷新令牌',
  routeRevoke: '吊销令牌',
  routeExport: '导出',
  routeImport: '导入',
  unauthorized: '未配对或配对令牌已失效，请重新配对',
  notFound: '没有该接口',
  pairBodyNotJson: '配对请求不是合法 JSON',
  pairCodeWrong: '配对码不正确',
  pairingInvalid: '配对已失效，请重新配对',
  exportTooLarge: '同步数据超过 20MB：请减少同步范围',
  importModeUnsupported: '导入方式只支持 merge 或 overwrite',
  envelopeInvalid: '同步数据不正确',
  importFailed: '导入失败',
  importScopeEmpty: '没有可导入的同步范围',

  // 令牌与配对码校验
  tokenMissing: '缺少配对令牌，请重新配对',
  pairCodeUsed: '配对码无效或已使用，请让对方重新开启配对',
  pairCodeExpired: '配对码已过期，请让对方重新开启配对',

  qrTooLong: (length: number, limit: number) => `二维码内容过长：${length} 字节，上限 ${limit} 字节`,

  // 重连状态
  statusOnline: '在线',
  statusUnchecked: '未检测',
  pairingOffline: '离线（端口可能已变化）：请让对方重新开启配对或重新扫码',
  pairingStale: '配对已失效：请移除后重新配对',
  retrying: '正在重试…',
  retryInSeconds: (seconds: number) => `下次重试：${seconds} 秒后`,
  retryInMinutes: (minutes: number) => `下次重试：${minutes} 分钟后`,

  // 开启配对（本机监听）
  serverStartTimeout: '本机监听 10 秒内没有响应，请确认已连接 Wi-Fi 后重试',
  serverStartErrorPrefix: '开启配对失败：',
  serverStartHint: '请确认已连接 Wi-Fi/热点并关闭 VPN/代理，再确认与对方在同一网段',
  serverStartRetryLater: '请稍后重试',
  serverNoAddress: '原生层没有返回监听地址与端口',
  serverNotListening: '原生层报告监听没有开启',
  serverBrowser: '浏览器端不能开配对，请在桌面版或安卓版上操作',
  serverUnsupported: '当前平台不支持开启局域网配对',

  // 本机网络
  kindEthernet: '有线网络',
  kindOther: '其他',
  networkLine: (label: string) => `网络：${label}`,
  networkEmpty: '未发现局域网地址：请确认已连接 Wi-Fi/热点',
  networkWifiNoIpv4: 'Wi-Fi 未分配 IPv4 地址：请重新连接 Wi-Fi',
  networkEthernetNoIpv4: '有线网络未分配 IPv4 地址：请检查网线或路由器 DHCP',
  networkMobileOnly: '未连接 Wi-Fi 或有线网络：请先连上与对方相同的 Wi-Fi',
  networkReadFailed: '读取本机网络失败',
  networkNoPlugin: '没有可用的局域网插件，请重新安装应用',

  // 「复制诊断信息」的文本
  diagYes: '是',
  diagNo: '否',
  diagTitle: '晓刻局域网诊断',
  diagCandidates: (count: number) => `候选 IPv4：${count} 个`,
  diagCandidatesEmpty: '候选列表：（空）',
  diagNotLan: '（非局域网）',
  diagStatusMissing: '网络状态：（原生层未返回）',
  diagStatus: (wifi: string, ethernet: string, mobile: string, vpn: string, ipv4: number) =>
    `网络状态：Wi-Fi=${wifi} 有线=${ethernet} 移动数据=${mobile} VPN=${vpn} IPv4=${ipv4}`,
  diagInterfaces: (summary: string) => `网卡摘要：${summary === '' ? '（空）' : summary}`,
  diagError: (error: string) => `读取错误：${error}`,
} as const;
