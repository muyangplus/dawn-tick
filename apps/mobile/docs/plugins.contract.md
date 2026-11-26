# Android 插件契约

Web 层通过 Capacitor 调用 Android 原生插件。方法名与字段名是**跨语言手写同构**的：TS 侧拼错或 Android 侧改名，运行时会静默拿到 `undefined`，不会编译报错。这份文档是两端唯一的对照表。

- TS 侧唯一定义：`apps/web/src/lib/plugins.ts`（插件名 `PLUGIN_NAMES`、方法清单 `PLUGIN_METHODS`、接口 `*Plugin`）。
- 加载唯一入口：`loadPlugin()`（`apps/web/src/lib/plugins.ts`）→ `loadCapacitorPlugin()`（`apps/web/src/lib/native.ts`）→ Capacitor `registerPlugin`。
- Android 侧实现：
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/system/SystemActionsPlugin.java`
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/school/SchoolWindowPlugin.kt`
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetPinPlugin.kt`
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetRefreshPlugin.kt`
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/install/ApkInstallerPlugin.kt`
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/share/FileSharePlugin.kt`
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/lan/LanSyncPlugin.kt`
    （局域网同步的传输层在 `.../lan/LanSyncServer.kt`，网络枚举在 `.../lan/LanNetworks.kt`，
    网络状态在 `.../lan/LanNetworkStatus.kt`，
    UDP 发现在 `.../lan/LanDiscovery.kt`；`share/` 与 `install/` 共用的路径校验与 FileProvider 换算在 `.../app/files/LocalFile.kt`）
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/reminder/ReminderActionsPlugin.kt`
    （提醒投递在 `.../reminder/ReminderNotifier.kt`、`.../reminder/ReminderAlarms.kt`，动作按钮与离线队列在 `.../reminder/ReminderReceivers.kt`、`.../reminder/ReminderStore.kt`）
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/secret/SecretStorePlugin.kt`
    （AndroidKeyStore AES-GCM 实现在 `.../secret/SecretVault.kt`；Windows 对应实现在 `apps/desktop/src-tauri/src/secret_store.rs`）
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/ai/AiStreamPlugin.kt`
  - 原生诊断日志：`apps/mobile/android/app/src/main/java/com/dawntick/app/diag/NativeLog.kt`
    （教务窗口、外部链接、小组件读取的失败原因都写 `filesDir/diag/native.log`；由 `SystemActions.readNativeLog` 读出）
- TS 接线（`PLUGIN_NAMES`、`PLUGIN_METHODS`、接口）已覆盖第 1–10 节，`plugins.test.ts` 与其余插件一并对齐。
- 静态核对：`apps/web/test/plugins.test.ts` 逐项比对 `PLUGIN_METHODS`、Java/Kotlin 的 `@PluginMethod` 与本文件；本仓库用 `gradlew.bat :app:compileDebugKotlin --no-daemon` 做 Android 编译检查，真机验证在打包机上执行 `pnpm android:dev`。

## 维护规则

1. 插件名与 `@CapacitorPlugin(name = "…")` 逐字一致。
2. 方法名在 TS 接口、`PLUGIN_METHODS`、Android `@PluginMethod` 与本文件四处逐字一致。
3. 参数与返回字段用 camelCase；Android 侧可以不 `put` 可选字段，TS 侧必须按可选处理。
4. 返回字段只增不改名；新增字段先加到 TS 接口与本文件，再改 Android 实现。
5. 页面导入协议（`<<<DAWNTICK>>>` / 诊断字段）不属于插件契约，见 `packages/core/src/import/page-tables.ts` 的 `PAGE_DIAGNOSTICS_FIELDS`。

## 1. SystemActions

| 项 | 内容 |
|---|---|
| 插件名 | `SystemActions` |
| TS 接口 | `SystemActionsPlugin` |
| Android 实现 | `SystemActionsPlugin.java` |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `openExternal` | `url: string` | `opened: boolean` | 只接受 http/https；没有可打开的应用时 reject，`message` 为 `<异常类>: <原始 message>`（同时写 `native.log`） |
| `isIgnoringBatteryOptimizations` | 无 | `ignoring: boolean` | 是否已在电池优化白名单 |
| `requestIgnoreBatteryOptimizations` | 无 | `ignoring?: boolean`、`requested?: boolean` | 已在白名单返回 `ignoring`，否则跳系统页并返回 `requested` |
| `notificationStatus` | `asked: boolean` | `appEnabled?: boolean`、`runtime?: string`、`asked?: boolean`、`channelId?: string \| null`、`channelName?: string \| null`、`channelMuted?: boolean` | `runtime` 取值 `granted` / `denied` / `prompt` / `permanently-denied` |
| `openNotificationSettings` | `channelId?: string` | `opened: boolean` | 有渠道 id 时直达该渠道 |
| `readNativeLog` | `maxBytes?: number` | `text?: string`、`path?: string`、`bytes?: number` | 读 `filesDir/diag/native.log` 最近约 200 行；默认读尾部 256KB，`maxBytes` 限制读取字节数 |
| `clearNativeLog` | 无 | `cleared: boolean` | 清空当前日志与滚动文件 `native.log.1` |
| `setNativeLogLevel` | `level: string` | 无 | 设置原生日志级别门槛（`error` / `warn` / `info` / `debug` / `trace`），存于 `dawn_tick_diag` 偏好，重启后仍生效；未知值忽略 |
| `abi` | 无 | `primary?: string`、`abis?: string[]` | Android 更新拆包的设备 ABI：`Build.SUPPORTED_ABIS` 原序返回，`primary` 取第一个；客户端据此在 arm64-v8a / armeabi-v7a 包中选择（见 `apps/web/src/lib/android-abi.ts`）。旧安装包没有本方法时调用失败，Web 层按 arm64-v8a 回退 |

### 1.1 原生诊断日志

真机没有 logcat 时，用这段日志排查「内嵌教务窗口打不开 / 外部链接确认后没反应 / 小组件空白 / 局域网配对失败」：

- 位置：`<app files>/diag/native.log`（应用私有目录，卸载即清除）。
- 格式：`时间 [级别] 范围: 消息`，与 Web、桌面同一口径，例如
  `2026-11-07 14:20:10.123 [info] import: SchoolWindow.open 打开教务窗口 url=https://…/path length=64`。
  消息先写一句事实，上下文以 `key=value` 跟在后面；消息里带类名或方法名（如 `WidgetStore.load`）便于搜索；
  换行折成空格，一条事件一行。
- 级别（从严到详）：
  - `error`：影响用户或数据的失败；
  - `warn`：已降级或已自动恢复；
  - `info`：关键流程节点，一次用户操作最多 1–2 条；
  - `debug`：排查用的中间状态；
  - `trace`：高频细节。
- 级别门槛：默认 `info`；Web 端经 `SystemActions.setNativeLogLevel` 同步，原生侧持久化在 `dawn_tick_diag` 偏好里，
  后台任务（小组件刷新等）也按它过滤。
- 范围：只用 `NativeLog.SCOPES` 登记的 16 个值，三端共用（`apps/web/src/lib/log-scopes.ts`、桌面 `LOG_SCOPES`）：
  `app`（启动、运行时、窗口）、`storage`（数据库、本地存储）、`backup`（备份与导出）、`sync`（局域网同步）、
  `reminder`（提醒与通知）、`permission`（系统权限）、`widget`（桌面小组件）、`update`（应用更新）、
  `preset`（预设）、`import`（课表导入与教务 WebView 窗口）、`timetable`（课表）、`todo`（待办）、
  `settings`（设置）、`credentials`（凭据）、`link`（外部链接）、`log`（日志本身）。未登记的范围只在 logcat 告警。
- 滚动：单文件约 512KB，写满后改名为 `native.log.1`（旧的 `.1` 丢弃）。
- 读取：`SystemActions.readNativeLog`（应用内「导出诊断日志」使用）→ 返回文本与绝对路径；
  `clearNativeLog` 清空。
- 记录点（按范围）：
  - `app`：`MainActivity` 启动版本（info）、插件自检（通过 debug，缺插件 error）、自检异常（warn）。
  - `import`：`SchoolWindow.open` 打开与窗口关闭（info）、缺地址 / 构造 Intent / `startActivityForResult` 失败（error）；
    `SchoolWebActivity` 的 `onCreate` / `onPageStarted` / `onPageFinished`（debug）、主框架 `onReceivedError`（error，
    子资源 warn）、拦截非 http(s) 跳转 / 教务页控制台 ERROR / `onCreateWindow` 拿不到子窗口（warn）。
  - `link`：`SystemActions.openExternal` 入口与交给浏览器（info）、scheme 校验（debug）、缺地址 / scheme 不支持 /
    `startActivity` 失败（error）。
  - `permission`：电池优化设置页、通知设置页打不开（error）。
  - `log`：`setNativeLogLevel` 同步级别、`clearNativeLog` 清空（info）。
  - `widget`：`WidgetStore.load` 候选库与快照读取（debug / trace）、单个候选库打开或解析失败（warn）、
    最终读不出快照（error）；`WidgetRefresher.refreshAll` 开始（trace）与结果（debug）；
    `WidgetPinPlugin.requestPin` 入口与结束（info）、不支持 / 停用 / 未弹出确认（warn）、未知组件（error）。
  - `sync`：`LanSync` 的 `start`（入口与监听成功 info，超时 / 失败 error）、`stop`（info）、`networks`
    （候选摘要 info，回退链路地址或候选为空 warn，失败 error）、`scanDiscovery`（结果 info，失败 error）、
    `respond` 回写失败与指定地址失效（warn）；`LanNetworkStatusReader` 读取失败、UDP 广播 / 发现端口 bind /
    multicast lock 失败（warn，不影响开配对）。
- 隐私：URL 只记 scheme + host + path（`NativeLog.redactUrl`，查询串可能带登录 token）；令牌、配对码、密码、
  Cookie 一律不写日志。


## 2. SchoolWindow

| 项 | 内容 |
|---|---|
| 插件名 | `SchoolWindow` |
| TS 接口 | `SchoolWindowPlugin` |
| Android 实现 | `SchoolWindowPlugin.kt`（页面在 `SchoolWebActivity.kt`） |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `open` | `url: string` | `payload?: string` | 打开内嵌教务窗口；用户取消或失败时 `payload` 为空串，页面内容带 `<<<DAWNTICK>>>` 标记时由 Web 层解析。入口、Intent 构造与 `startActivityForResult` 异常都写 `native.log` 并 reject 原始 message |
| `available` | 无 | `platform?: string`、`supported?: boolean` | 当前平台是否支持内嵌窗口；安卓恒为 `{ platform: "android", supported: true }` |

## 3. DawnTickWidget

| 项 | 内容 |
|---|---|
| 插件名 | `DawnTickWidget` |
| TS 接口 | `WidgetPinPlugin` |
| Android 实现 | `WidgetPinPlugin.kt` |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `readStates` | 无 | `supported?: boolean`、`widgets?: { provider?: string; added?: boolean; enabled?: boolean }[]` | 每种尺寸一行；`enabled === false` 表示被系统或启动器停用 |
| `requestPin` | `provider: string`（`next` / `today` / `week` / `exam`） | `status?: string`、`reason?: string` | `status` 取值 `added` / `already-added` / `cancelled` / `unsupported` / `disabled` / `rejected`；`reason` 只用于排查 |

## 4. WidgetRefresh

| 项 | 内容 |
|---|---|
| 插件名 | `WidgetRefresh` |
| TS 接口 | `WidgetRefreshPlugin` |
| Android 实现 | `WidgetRefreshPlugin.kt` |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `refresh` | 无 | 无（resolve 空） | Web 层写完小组件快照后请求立即重绘 |

## 5. ApkInstaller

| 项 | 内容 |
|---|---|
| 插件名 | `ApkInstaller` |
| TS 接口 | `ApkInstallerPlugin` |
| Android 实现 | `ApkInstallerPlugin.kt` |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `installApk` | `path: string` | `opened: boolean`、`needsPermission?: boolean` | `path` 只接受应用缓存 / 外部私有下载目录内的绝对路径或 `file://` URI，且扩展名必须是 `.apk`；未授权「安装未知应用」时跳本应用设置页并返回 `opened: false`、`needsPermission: true`，用户授权后重试一次 |

## 6. FileShare

| 项 | 内容 |
|---|---|
| 插件名 | `FileShare` |
| TS 接口 | `FileSharePlugin` |
| Android 实现 | `FileSharePlugin.kt` |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `shareFile` | `path: string`、`mimeType?: string` | `shared: boolean` | `ACTION_SEND` + FileProvider 分享；`mimeType` 缺省按扩展名推断，推不出按 `application/octet-stream` |
| `revealFile` | `path: string` | `opened: boolean`、`via?: string` | Android 没有「打开所在文件夹」：先开系统文件应用的所在目录，失败退 `content://` 目录，再失败回退分享面板；`via` 取值 `documents` / `content` / `share` |

## 7. LanSync

局域网同步（I-14）的 Android 服务端。插件只做监听、排队、取请求与回响应；
配对码、长期令牌（只落哈希）、范围与数据导出导入全在 TS，协议见
`apps/mobile/docs/lan-sync.contract.md`。socket **绑定通配地址**（`ServerSocket(0)` 不指定网卡），
对外广播/展示的是选中网卡的局域网 IPv4；每个请求仍校验来源必须是局域网地址。

| 项 | 内容 |
|---|---|
| 插件名 | `LanSync` |
| TS 接口 | `LanSyncPlugin`（`apps/web/src/lib/plugins.ts`） |
| Android 实现 | `lan/LanSyncPlugin.kt`（服务在 `lan/LanSyncServer.kt`，UDP 发现在 `lan/LanDiscovery.kt`） |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `start` | `host?: string`、`deviceId?: string` | `host?: string`、`port?: number`、`listening?: boolean` | 用通配地址 + 系统分配端口监听，`host` 只决定对外展示/广播地址；`deviceId` 是本机稳定设备 id，写进 UDP 广播（非法值只丢字段，不影响开配对）。resolve 前确认 socket 已 bind，返回 `listening:true`。`host` 未传或已不在本机网卡上时回退 `LanNetworks.preferredAddress()`；仍失败时 reject **异常类: message**（界面显示 `开启配对失败：<原因>`）。成功后开始 UDP 广播（不含配对码）；广播 / multicast lock 失败只记日志，不影响 resolve。后台线程另有 **10 秒看门狗** |
| `stop` | 无 | 无（resolve 空） | 关监听、停广播并释放 multicast lock；**幂等**，重复调用仍 resolve |
| `networks` | 无 | `networks?: { name?: string; address?: string; isLan?: boolean; kind?: string; preferred?: number }[]`、`status?: { wifi?: boolean; ethernet?: boolean; mobile?: boolean; vpn?: boolean; ipv4Count?: number; interfaceSummary?: string }` | 枚举本机 IPv4：排除回环，`kind` 取 `wifi` / `ethernet` / `vpn` / `other`；VPN 与虚拟网卡降级排序。`status` 由 `ConnectivityManager` + `NetworkCapabilities` 判断当前传输类型（只需 `ACCESS_NETWORK_STATE`，无运行时权限），读取失败时全为 false 并写 `native.log`。枚举失败时 reject 可读原因（不再返回空数组），界面显示「读取本机网络失败：…」；候选为空时把全部网卡（含 IPv6 / 回环）写日志 |
| `poll` | 无 | `id?: number`、`method?: string`、`path?: string`、`query?: string`、`authorization?: string`、`body?: string`、`receivedAt?: number` | 队列空时无字段；字段与 Rust `lan_sync_poll` 一致 |
| `respond` | `id: number`、`status: number`、`body: string` | 无（resolve 空） | 写回 HTTP 响应；请求已超时（10 秒）时 reject |
| `scanDiscovery` | `timeoutMs?: number` | `peers?: { name?: string; host?: string; port?: number; deviceId?: string }[]` | UDP 短超时扫描同网设备；返回设备名 / 地址 / 端口 / 稳定 `deviceId`，按 host:port 去重。旧版本广播没有 `deviceId`，字段可缺省 |

HTTP 路径白名单（原生层只放行这些，其余 404/405）：`/ping`、`/pair`、`/pair/refresh`、
`/pair/revoke`、`/export`、`/import`，另有 `OPTIONS` 预检。

### 7.1 相机扫码依赖与权限

应用内扫码不是自研插件，而是第三方 Capacitor 插件；方法名与字段以该包自身契约为准，
本仓库在 `apps/web/src/lib/scan.ts` 里动态加载（配对面板经 `lan-pair-scan.ts` 转发）：

| 项 | 内容 |
|---|---|
| 依赖 | `@capacitor-mlkit/barcode-scanning@^8.2.1`（`apps/mobile/package.json` 与 `apps/web/package.json` 都声明） |
| Android 插件类 | `io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerPlugin`（`cap sync android` 后写入 `capacitor.plugins.json`） |
| 权限 | `AndroidManifest.xml`：`android.permission.CAMERA`；`<uses-feature android:name="android.hardware.camera" android:required="false"/>` |
| 使用的方法 | `isSupported` / `requestPermissions` / `startScan` / `stopScan` / `addListener('barcodesScanned')` / `addListener('scanError')` |
| 为什么不用 `scan()` | `scan()` 依赖 Google Play 服务的条码模块，无 GMS / 国产 ROM 会直接失败；`startScan()` 用打包进 APK 的 ML Kit 模型 |

### 7.2 返回键

返回键同样用第三方插件，由 `apps/web/src/lib/back-dispatch.ts` 在 Capacitor 平台动态加载：

| 项 | 内容 |
|---|---|
| 依赖 | `@capacitor/app@^8.1.2`（`apps/mobile/package.json` 与 `apps/web/package.json` 都声明） |
| 使用的方法 | `addListener('backButton')` / `minimizeApp` |
| 行为 | 注册监听后系统不再默认退出；网页侧按「中断只读操作 → 关弹窗 → 逐级返回」处理，都无事可做时调用 `minimizeApp` |

## 8. ReminderActions

提醒动作（R-07）：课前/日程提醒的定时、投递与通知按钮。插件只接管提醒投递，`LocalNotifications` 的其它用途保持原样；动作语义（贪睡 10 分钟 / 完成 / 勿扰 1 小时）与纯函数在 TS `apps/web/src/lib/reminder-actions.ts`，Android 只负责排定、展示通知、回传动作，并在进程不在线时把动作排队。

| 项 | 内容 |
|---|---|
| 插件名 | `ReminderActions` |
| TS 接口 | `ReminderActionsPlugin`（`apps/web/src/lib/plugins.ts`） |
| Android 实现 | `reminder/ReminderActionsPlugin.kt` |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `schedule` | `id: number`、`title: string`、`body?: string`、`at: number`、`kind: string`、`targetId?: string` | 无（resolve 空） | `at` 是 epoch 毫秒；`kind` 决定动作集合（见下表）；同一 `id` 重复调用按最后一次覆盖 |
| `cancel` | `id: number` | 无（resolve 空） | 取消闹钟并清掉已展示的通知 |
| `pending` | 无 | `reminders?: { id?: number; at?: number }[]` | 持久化里的全部提醒（含已展示、等待动作回传的）；前端按 `at > now` 过滤后与扫描结果对账 |
| `requestPermissionInfo` | 无 | `notifications?: string`、`exactAlarm?: string` | 只报告不弹窗；取值 `granted` / `denied` |
| `pollActions` | 无 | `actions?: { id?: number; action?: string; targetId?: string; kind?: string }[]` | 取走进程不在线时堆积的动作；队列空时为空数组 |

动作集合（与 TS `reminder-actions.ts`、Rust `reminder_actions.rs` 逐项一致）：

| `kind` | 通知动作 |
|---|---|
| `class`（课前提醒） | `snooze`、`mute` |
| `todo` / `homework` / `exam` / `lab`（日程提醒） | `snooze`、`done`、`mute` |

动作回传：插件在线时通过 `notifyListeners("actionPerformed", { id, action, targetId, kind })` 交给 JS；进程重启后由前端 `pollActions()` 补取。原生会先按同一语义执行一次（贪睡重排、完成/勿扰取消闹钟与通知），JS 负责写回 `events.done` 与维护勿扰窗口。

## 9. SecretStore

本机密钥库（WebDAV 密码加密）。Android 用 AndroidKeyStore 里的 AES-256-GCM 密钥，
Win 端对应 DPAPI（`apps/desktop/src-tauri/src/secret_store.rs`，Tauri 命令 `secret_encrypt` / `secret_decrypt`）。
插件只收发 Base64 密文；`enc:v1:` 信封与旧明文迁移在 TS `apps/web/src/lib/credentials.ts`。

| 项 | 内容 |
|---|---|
| 插件名 | `SecretStore` |
| TS 接口 | `SecretStorePlugin`（`apps/web/src/lib/plugins.ts`） |
| Android 实现 | `secret/SecretStorePlugin.kt`（加解密在 `secret/SecretVault.kt`） |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `encrypt` | `value: string` | `ciphertext?: string` | 返回 Base64(12 字节 IV + GCM 密文与标签)；空串由 Web 层拦截，不走原生 |
| `decrypt` | `ciphertext: string` | `value?: string` | 密钥丢失、密文被改动或来自别的设备时 reject |
| `isAvailable` | 无 | `available?: boolean` | 密钥库不可用时 Web 层回退明文并在设置页显式提示 |

## 10. AiStream

AI 助手的流式回复。CapacitorHttp 接管的全局 fetch 会把响应整段缓冲，SSE 逐字输出走这条通道；
TS 侧把事件拼回 `AiFetch` 响应（`apps/web/src/lib/ai-stream.ts`），`lib/ai.ts` 在 Android 上优先用它，插件加载不到时退回全局 fetch。

| 项 | 内容 |
|---|---|
| 插件名 | `AiStream` |
| TS 接口 | `AiStreamPlugin`（`apps/web/src/lib/plugins.ts`） |
| Android 实现 | `ai/AiStreamPlugin.kt` |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `start` | `id: string`、`url: string`、`headers: Record<string, string>`、`body: string` | 无（resolve 空） | 校验参数后立即 resolve，POST 在后台线程发出；只收 http / https；请求头带 API Key，不进日志 |
| `cancel` | `id: string` | 无（resolve 空） | 断开连接；之后不再推送这个 `id` 的事件 |

事件：`notifyListeners("aiStream", { id, type, … })`，同一个 `id` 依次收到：

| `type` | 附带字段 | 说明 |
|---|---|---|
| `status` | `status: number` | HTTP 状态码；状态码 ≥ 400 时随后的 `chunk` 是错误响应体 |
| `chunk` | `text: string` | 一段 UTF-8 文本，按到达顺序拼接 |
| `end` | 无 | 响应读完 |
| `error` | `message: string` | 连接或读取失败（文案取自 strings.xml，只带异常类名）；可能出现在 `status` 之前 |

## 11. 变更检查清单

改插件契约时按顺序过一遍：

- [ ] `apps/web/src/lib/plugins.ts`：接口、`PLUGIN_METHODS`、必要时 `PLUGIN_NAMES`
- [ ] Android 实现：`@PluginMethod` 方法名与 `JSObject` 返回字段
- [ ] 本文件的插件名 / 方法 / 参数 / 返回字段表
- [ ] `pnpm -C apps/web test`（或仓库根 `node --test apps/web/test/plugins.test.ts`）
- [ ] 打包机上 `pnpm android:dev`，在真机走一遍对应入口
