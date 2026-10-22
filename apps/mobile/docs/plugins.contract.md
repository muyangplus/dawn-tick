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
    （局域网同步的传输层在 `.../lan/LanSyncServer.kt`；`share/` 与 `install/` 共用的路径校验与 FileProvider 换算在 `.../app/files/LocalFile.kt`）
  - `apps/mobile/android/app/src/main/java/com/dawntick/app/reminder/ReminderActionsPlugin.kt`
    （提醒投递在 `.../reminder/ReminderNotifier.kt`、`.../reminder/ReminderAlarms.kt`，动作按钮与离线队列在 `.../reminder/ReminderReceivers.kt`、`.../reminder/ReminderStore.kt`）
- TS 接线（`PLUGIN_NAMES`、`PLUGIN_METHODS`、接口）已覆盖第 1–8 节，`plugins.test.ts` 与其余插件一并对齐。
- 静态核对：`apps/web/test/plugins.test.ts` 逐项比对 `PLUGIN_METHODS`、Java/Kotlin 的 `@PluginMethod` 与本文件；本仓库没有 Android 构建链，编译与真机验证在打包机上执行 `pnpm android:dev`。

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
| `openExternal` | `url: string` | `opened: boolean` | 只接受 http/https；没有可打开的应用时 reject |
| `isIgnoringBatteryOptimizations` | 无 | `ignoring: boolean` | 是否已在电池优化白名单 |
| `requestIgnoreBatteryOptimizations` | 无 | `ignoring?: boolean`、`requested?: boolean` | 已在白名单返回 `ignoring`，否则跳系统页并返回 `requested` |
| `notificationStatus` | `asked: boolean` | `appEnabled?: boolean`、`runtime?: string`、`asked?: boolean`、`channelId?: string \| null`、`channelName?: string \| null`、`channelMuted?: boolean` | `runtime` 取值 `granted` / `denied` / `prompt` / `permanently-denied` |
| `openNotificationSettings` | `channelId?: string` | `opened: boolean` | 有渠道 id 时直达该渠道 |

## 2. SchoolWindow

| 项 | 内容 |
|---|---|
| 插件名 | `SchoolWindow` |
| TS 接口 | `SchoolWindowPlugin` |
| Android 实现 | `SchoolWindowPlugin.kt`（页面在 `SchoolWebActivity.kt`） |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `open` | `url: string` | `payload?: string` | 打开内嵌教务窗口；用户取消或失败时 `payload` 为空串，页面内容带 `<<<DAWNTICK>>>` 标记时由 Web 层解析 |

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
配对码、令牌、范围与数据导出导入全在 TS，协议见 `apps/mobile/docs/lan-sync.contract.md`。

| 项 | 内容 |
|---|---|
| 插件名 | `LanSync` |
| TS 接口 | `LanSyncPlugin`（`apps/web/src/lib/plugins.ts`） |
| Android 实现 | `lan/LanSyncPlugin.kt`（服务在 `lan/LanSyncServer.kt`，UDP 发现在 `lan/LanDiscovery.kt`） |

| 方法 | 参数 | 返回字段 | 说明 |
|---|---|---|---|
| `start` | 无 | `host?: string`、`port?: number` | 绑定本机局域网 IPv4 与系统分配端口；没有局域网地址时 reject；成功后开始 UDP 广播（不含配对码） |
| `stop` | 无 | 无（resolve 空） | 关监听、停广播并清空队列、等待中的响应 |
| `poll` | 无 | `id?: number`、`method?: string`、`path?: string`、`query?: string`、`authorization?: string`、`body?: string`、`receivedAt?: number` | 队列空时无字段；字段与 Rust `lan_sync_poll` 一致 |
| `respond` | `id: number`、`status: number`、`body: string` | 无（resolve 空） | 写回 HTTP 响应；请求已超时（10 秒）时 reject |
| `scanDiscovery` | `timeoutMs?: number` | `peers?: { name?: string; host?: string; port?: number }[]` | UDP 短超时扫描同网设备；只返回设备名 / 地址 / 端口，按 host:port 去重 |

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
| `requestPermissionInfo` | 无 | `notifications?: string`、`exactAlarm?: string` | 只报告不弹窗；取值 `granted` / `denied` |
| `pollActions` | 无 | `actions?: { id?: number; action?: string; targetId?: string; kind?: string }[]` | 取走进程不在线时堆积的动作；队列空时为空数组 |

动作集合（与 TS `reminder-actions.ts`、Rust `reminder_actions.rs` 逐项一致）：

| `kind` | 通知动作 |
|---|---|
| `class`（课前提醒） | `snooze`、`mute` |
| `todo` / `homework` / `exam` / `lab`（日程提醒） | `snooze`、`done`、`mute` |

动作回传：插件在线时通过 `notifyListeners("actionPerformed", { id, action, targetId, kind })` 交给 JS；进程重启后由前端 `pollActions()` 补取。原生会先按同一语义执行一次（贪睡重排、完成/勿扰取消闹钟与通知），JS 负责写回 `events.done` 与维护勿扰窗口。

## 9. 变更检查清单

改插件契约时按顺序过一遍：

- [ ] `apps/web/src/lib/plugins.ts`：接口、`PLUGIN_METHODS`、必要时 `PLUGIN_NAMES`
- [ ] Android 实现：`@PluginMethod` 方法名与 `JSObject` 返回字段
- [ ] 本文件的插件名 / 方法 / 参数 / 返回字段表
- [ ] `pnpm -C apps/web test`（或仓库根 `node --test apps/web/test/plugins.test.ts`）
- [ ] 打包机上 `pnpm android:dev`，在真机走一遍对应入口
