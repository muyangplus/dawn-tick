# 局域网同步契约（I-14 一期）

设备与同步页的「局域网同步」：一端开配对，另一端输入「IP + 配对码」连上，然后在
**课表 / 待办 / 设置**三个范围里拉取或推送。本文件是 TS、Rust、Kotlin 三端唯一对照表。

一期边界（不做）：mDNS/UDP 自动发现、后台常驻、云端中转、多设备并发配对。
浏览器（Web/PWA）只做发起方，不做服务端。

## 1. 角色与平台矩阵

| 平台 | 开配对（服务端） | 连接对方（客户端） | 实现 |
|---|---|---|---|
| Windows（Tauri） | 是 | 是 | `apps/desktop/src-tauri/src/lan_sync.rs` + `apps/web/src/lan-sync.ts` |
| Android（Capacitor） | 是 | 是 | `apps/mobile/android/app/src/main/java/com/dawntick/app/lan/` |
| Web / PWA | **否** | 是（需要对方回 CORS 头） | `apps/web/src/lan-sync.ts` |

- 服务端的原生层只做传输：监听、最小 HTTP 解析、只接受局域网来源、请求体上限、排队与超时。
- **配对码与令牌的校验、数据导出/导入都在 TS**（`apps/web/src/lan-sync-protocol.ts`）。
  数据层在 TS，鉴权必须能单测；原生层不读数据库、不解释业务 JSON。
- 服务端进程内只有一份状态（`Mutex<Option<LanSyncServer>>` / 单例插件字段），
  TS 侧配对状态也只放内存，不落盘任何长期凭据。

## 2. 地址与端口

- 监听地址：本机**局域网 IPv4**（10/8、172.16/12、192.168/16、169.254/16、127/8），
  端口由系统分配（`bind(..., 0)`），`lan_sync_start` / `LanSync.start` 返回实际端口。
- 客户端输入：`192.168.1.5:8765` 或 `http://192.168.1.5:8765`；只接受局域网地址，
  公网地址与域名一律拒绝（`parsePeerAddress`）。
- 同一台机器自测也走局域网地址；服务端额外接受环回来源（127.0.0.1），其余一律 403。

## 3. 配对与令牌

1. 服务端「开启配对」后生成 6 位数字配对码，**5 分钟**内有效（`PAIR_CODE_TTL_MS`）。
2. 客户端 `POST /pair` 提交配对码；成功返回一次性会话令牌（32 位十六进制）与到期时间。
3. 配对成功即**消耗配对码**：再提交同一配对码返回 409/401，必须重新开启配对。
4. 令牌**只在内存**，有效期 **10 分钟**（`SESSION_TTL_MS`）或直到「停止配对」；
   客户端在到期后必须重新配对。服务重启/停止即失效。
5. 同一时间只允许一个已配对会话；服务端已配对时新的 `/pair` 返回 409。

## 4. HTTP 接口

服务端只实现四个入口，其它路径 404，方法不符 405。请求/响应均为 UTF-8 JSON。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/pair` | 无 | 配对码换令牌 |
| `GET` | `/export?scope=…` | `Authorization: Bearer <token>` | 导出所选范围 |
| `POST` | `/import?scope=…&mode=merge\|overwrite` | `Authorization: Bearer <token>` | 导入（合并/覆盖） |
| `OPTIONS` | 任意 | 无 | CORS 预检，原生层直接 204 |

- `scope` 取值 `timetable` / `todos` / `settings`，逗号分隔；未知值忽略，空范围 400。
- **范围由发起方决定**：拉取方在 `/export` 里选，推送方在 `/import` 里选；
  接收方卡片上的勾选只影响它自己发起的请求。导入时生效范围再与信封里的 `scope` 取交集。
- `mode` 缺省 `merge`：按行 `updated_at` 较新的一方获胜，旧的跳过（复用
  `packages/core/src/backup.ts` 的 `importBackup` 规则）；`overwrite` 直接覆盖。
- 统一错误体：`{"error":{"code":"…","message":"…"}}`，
  `code` ∈ `bad_request` / `unauthorized` / `conflict` / `not_found` / `method_not_allowed` /
  `payload_too_large` / `busy` / `timeout` / `forbidden` / `internal`。
- 请求体上限 **5MB**（`MAX_REQUEST_BYTES`），响应体上限 **20MB**；超限 413/500。
- 原生层等待 TS 处理的上限 **10 秒**，超时回 504 并把请求从队列里丢掉。
- 所有响应带 CORS 头（`Access-Control-Allow-Origin: *` 等），浏览器端才能作为客户端；
  响应头 `Cache-Control: no-store`。连接一律 `Connection: close`。

### 4.1 `POST /pair`

请求：`{"code":"123456","schemaVersion":1}`
成功 200：`{"token":"<32 hex>","expiresAt":1759900000000,"schemaVersion":1}`
失败：400（码格式） / 401（不匹配或已过期） / 409（已有会话）

### 4.2 `GET /export`

成功 200：§5 的同步信封。失败 400（缺范围）/ 401（令牌缺失、无效或过期）。

### 4.3 `POST /import`

请求体：§5 的同步信封。成功 200：`{"imported":N,"skipped":N,"removed":N,"warnings":[]}`。
失败 400（信封或范围不合法）/ 401（令牌无效）/ 413（体积超限）。

## 5. 同步信封（schema 版本 1）

```json
{
  "kind": "dawn-tick-lan-sync",
  "schemaVersion": 1,
  "generatedAt": 1759900000000,
  "scope": ["timetable", "todos"],
  "backup": { "...": "packages/core/src/backup.ts 的 BackupPayload" }
}
```

- `kind` / `schemaVersion` 必须精确匹配；不认识的版本直接 400，不做猜测兼容。
- `backup` 由 `exportBackup(storage, { modules })` 生成，导入走 `importBackup`；
  与 WebDAV 整包用的是同一套备份格式（`format` / `version` / `stores` / `meta`）。
- 只含业务数据：课表（`users` / `semesters` / `time_slots` / `courses` / `course_schedules`）、
  待办（`events`）、设置（`BACKUP_META_KEYS`）。**不含**日志、快照文件、预设正文与 WebDAV 密码。

范围到备份模块的映射（`LAN_SCOPE_MODULES`）：

| 范围 | 备份模块 | 集合 |
|---|---|---|
| `timetable` | `semesters`、`courses` | users / semesters / time_slots / courses / course_schedules |
| `todos` | `events` | events |
| `settings` | `settings` | app_meta 中的 `BACKUP_META_KEYS` |

## 6. 原生转发协议（poll / respond）

原生层收到允许的请求后编号入队，TS 轮询取走并回写：

| 动作 | Windows（Tauri 命令） | Android（Capacitor 插件 `LanSync`） |
|---|---|---|
| 开服务 | `lan_sync_start()` → `{host, port}` | `start()` → `{host, port}` |
| 停服务 | `lan_sync_stop()` | `stop()` |
| 取请求 | `lan_sync_poll()` → `{id, method, path, query, authorization, body, receivedAt}` 或 `null` | `poll()` → 同字段 |
| 回响应 | `lan_sync_respond(id, status, body)` | `respond({id, status, body})` |

- 队列上限 32 条，满了直接 503；每个连接线程等自己的响应，10 秒超时 504 并清掉队列项。
- 原生层**不校验**配对码/令牌，`Authorization` 原样带给 TS；`/pair` 也照常入队。
- 入队前已完成的拒绝：非局域网来源 403、路径不在上表 404、方法不符 405、请求头过大 431、
  请求体超过 5MB 413、请求不是合法 UTF-8/HTTP 400。
- 轮询间隔由 TS 决定（`LAN_SYNC_POLL_INTERVAL_MS = 400`）；停止配对后不再轮询。
- TS 侧字段命名与 Rust `#[serde(rename_all = "camelCase")]`、Kotlin `JSObject` 一致：
  `id` / `method` / `path` / `query` / `authorization` / `body` / `receivedAt`。

## 7. TS 模块与测试

| 文件 | 职责 |
|---|---|
| `apps/web/src/lan-sync-protocol.ts` | 范围、地址、配对码与会话令牌的纯函数 |
| `apps/web/src/lan-sync-payload.ts` | 信封编解码、`importBackup` 应用与 `handleLanRequest`（服务端纯函数） |
| `apps/web/src/lan-sync.ts` | 客户端 `fetch`、配对、拉取/推送、服务端生命周期、会话状态机 |
| `apps/web/src/screens/settings/lan-sync-block.tsx` | 设备页卡片内容 |
| `apps/web/test/lan-sync.test.ts` | 配对码/范围/状态机/HTTP 处理/双端收发模拟 |
| `apps/web/smoke/entry.tsx` | 设备页出现卡片、地址与配对码输入、拉取/推送入口 |

## 8. 安全清单

- 配对码 6 位数字、5 分钟失效、用后作废；令牌密码学随机（`crypto.getRandomValues`）。
- 令牌、配对码只在本机内存；不写 `app_meta`、不进导出、不进日志。
- 只监听局域网地址，并逐请求校验来源地址；只接受局域网目标（客户端侧同样校验）。
- 请求体 5MB / 响应体 20MB / 每请求 10 秒处理窗口 / 队列 32 条。
- 只传业务数据；日志、快照、预设正文与任何账号密码都不进信封。
- 传输为明文 HTTP，**只在信任的局域网使用**；不要在公共 Wi-Fi 开配对。

## 9. 未在本仓库验证

Android 没有构建链：`LanSyncPlugin.kt` / `LanSyncServer.kt` 未编译，真机联调在打包机
（`pnpm android:dev`）上做。静态核对由 `apps/web/test/plugins.test.ts` 覆盖方法名与插件名。
