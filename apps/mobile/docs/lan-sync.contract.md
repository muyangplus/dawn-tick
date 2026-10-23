# 局域网同步契约（I-14 二期）

设备与同步页的「局域网同步」：一端开配对，另一端输入「IP + 配对码」连上，然后在
**课表 / 待办 / 设置**三个范围里拉取或推送。本文件是 TS、Rust、Kotlin 三端唯一对照表。

二期在「手输 IP + 6 位配对码 + 手动拉取/推送」之上增加：
**UDP 广播自动发现**、**配对信息二维码（只展示，不扫码）**、**拉取前变更预览**、
**启动 / 30 分钟自动同步**。同步信封与冲突规则不变，`schemaVersion` 仍为 **1**。

边界（不做）：mDNS、相机扫码、后台常驻服务端、云端中转、多设备并发配对、
服务端/账号登录。浏览器（Web/PWA）只做发起方，不做服务端，也不做 UDP 发现。

## 1. 角色与平台矩阵

| 平台 | 开配对（服务端） | 连接对方（客户端） | UDP 发现 | 实现 |
|---|---|---|---|---|
| Windows（Tauri） | 是 | 是 | 是（广播 + 扫描） | `apps/desktop/src-tauri/src/lan_sync.rs`、`lan_discovery.rs` + `apps/web/src/lan-sync*.ts` |
| Android（Capacitor） | 是 | 是 | 是（广播 + 扫描） | `apps/mobile/android/app/src/main/java/com/dawntick/app/lan/` |
| Web / PWA | **否** | 是（需要对方回 CORS 头） | **否**（只能手输） | `apps/web/src/lan-sync*.ts` |

- 服务端的原生层只做传输：监听、最小 HTTP 解析、只接受局域网来源、请求体上限、排队与超时；
  发现层只做 UDP 广播与扫描，不解释同步数据。
- **配对码与令牌的校验、数据导出/导入、预览统计与自动同步策略都在 TS**
  （`apps/web/src/lan-sync*.ts`）；原生层不读数据库、不解释业务 JSON。
- 服务端进程内只有一份状态（`Mutex<Option<LanSyncServer>>` / 单例插件字段），
  TS 侧配对状态也只放内存，不落盘任何长期凭据。

## 2. 地址与端口

- HTTP 监听地址：本机**局域网 IPv4**（10/8、172.16/12、192.168/16、169.254/16、100.64/10、127/8），
  端口由系统分配（`bind(..., 0)`），`lan_sync_start` / `LanSync.start` 返回实际端口。
- 客户端输入：`192.168.1.5:8765` 或 `http://192.168.1.5:8765`；只接受局域网地址，
  公网地址与域名一律拒绝（`parsePeerAddress`）。
- **多网络识别**：本机有多块网卡 / VPN 时，桌面 `lan_network_list()` 与 Android
  `LanSync.networks()` 返回候选 `{name, address, isLan, kind, preferred}`；`kind` 只按网卡名
  推断（`wifi` / `ethernet` / `vpn` / `other`）。排序规则三端一致：
  **局域网地址优先 → 有线/无线优先于其它、VPN 降级到最后 → 192.168.\* > 10.\* >
  172.16–31.\* > 100.64/10 > 169.254/16 → 地址数值**。
- 设备页显示「网络：`<地址> · <分类>`」与「切换网络」下拉；选中的地址写入
  `localStorage` 的 `dt.lan.host`（只存地址，不存凭据），下次开配对优先使用。
  切换后必须**重启配对**（停止再开启），因为 HTTP 监听与 UDP 广播都绑定该地址。
- `lan_sync_start({host})` / `LanSync.start({host})` 用选中地址监听；缺省时自动选首选局域网。
  安卓在 `start` 里另有 **10 秒看门狗**；TS 对 `start` 另有 **8 秒超时**（超时文案
  「开启配对超时：请确认已连接 Wi-Fi 后重试」，可直接重试）。
- 发现使用 **UDP 8766**（`LAN_DISCOVERY_PORT`）；广播目标是选中地址**所属网段的广播地址**
  （桌面按 `ipconfig` 的子网掩码计算，Android 取 `InterfaceAddress.broadcast`），
  同时保留 `255.255.255.255:8766` 兜底，同机自测额外发一份到 `127.0.0.1:8766`。
- 同一台机器自测也走局域网地址；服务端额外接受环回来源（127.0.0.1），其余一律 403。

## 3. UDP 自动发现（二期新增）

### 3.1 广播包

服务端「开启配对」成功后，原生层每 **800ms** 广播一次；停止配对即停止广播。
广播包是 UTF-8 JSON，字段名与 Rust / Kotlin / TS 逐字一致：

```json
{
  "kind": "dawn-tick-lan-discover",
  "schemaVersion": 1,
  "name": "书房电脑",
  "host": "192.168.1.5",
  "port": 8765
}
```

- `kind` / `schemaVersion` 必须精确匹配（`dawn-tick-lan-discover` / `1`），否则丢弃；
- `name` 为设备名（1–48 字符；Windows 取计算机名，Android 取机型）；
- `host` 只广播局域网 IPv4，`port` 是 HTTP 监听端口（不是 8766）；
- **广播包不含配对码、令牌、范围或任何业务数据**。发现只负责填地址，配对码仍需
  对方界面上显示的 6 位数字。

### 3.2 扫描

- 客户端点击「发现设备」后，原生层绑定 UDP 8766，**短超时收集 1.5 秒**，按 `host:port`
  去重、按设备名排序，最多 32 台返回给 TS。桌面把选中地址（`dt.lan.host`）传给
  `lan_discovery_scan({timeoutMs, host})`，只保留该地址所属网段的广播（环回自测始终保留）；
  多网卡时不会把别的网段设备混进来。
- 列表每行显示「设备名 · IP:端口」；点击即把 `IP:端口` 填入「对方地址」。
- 收到后 10 秒没有再广播的条目视为过期；本机自己的地址会被过滤。
- Web 端没有原生 UDP：按钮禁用并提示手输地址；冒烟测试用固定扫描桩验证「发现 → 填入」。

## 4. 配对与令牌

1. 服务端「开启配对」后生成 6 位数字配对码，**5 分钟**内有效（`PAIR_CODE_TTL_MS`）。
2. 客户端 `POST /pair` 提交配对码；成功返回一次性会话令牌（32 位十六进制）与到期时间。
3. 配对成功即**消耗配对码**：再提交同一配对码返回 409/401，必须重新开启配对。
4. 令牌**只在内存**，有效期 **10 分钟**（`SESSION_TTL_MS`）或直到「停止配对」；
   客户端在到期后必须重新配对。服务重启/停止即失效。
5. 同一时间只允许一个已配对会话；服务端已配对时新的 `/pair` 返回 409。
6. 自动同步复用同一套令牌：**不持久化令牌**，重启或过期后需要重新配对；
   重新配对会拿到新令牌。

### 4.1 二维码配对信息（只展示，不扫描）

- 服务端开启配对后，TS 用 `pairingQrText(host, port, code)` 生成文本
  **`IP:端口 配对码`**（例如 `192.168.1.5:8765 123456`），并用本地二维码编码器
  （`apps/web/src/lan-sync-qr.ts`，字节模式、纠错 M、版本 1–4）画成 SVG。
- 该文本同时放在「复制配对信息」按钮里；对方扫码后**手动输入**到另一端的地址与配对码。
- 本仓库**不引入相机/扫码依赖**；如需直接扫码另立任务。
- 二维码包含配对码，只在「开启配对」期间展示，停止配对后随卡片一起消失。

## 5. HTTP 接口

服务端只实现四个入口，其它路径 404，方法不符 405。请求/响应均为 UTF-8 JSON。
二期**没有新增 HTTP 路径**；预览复用 `GET /export`，在客户端本地统计。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/pair` | 无 | 配对码换令牌 |
| `GET` | `/export?scope=…` | `Authorization: Bearer <token>` | 导出所选范围；预览也用它 |
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

### 5.1 `POST /pair`

请求：`{"code":"123456","schemaVersion":1}`
成功 200：`{"token":"<32 hex>","expiresAt":1759900000000,"schemaVersion":1}`
失败：400（码格式） / 401（不匹配或已过期） / 409（已有会话）

### 5.2 `GET /export`

成功 200：§6 的同步信封。失败 400（缺范围）/ 401（令牌缺失、无效或过期）。

### 5.3 `POST /import`

请求体：§6 的同步信封。成功 200：`{"imported":N,"skipped":N,"removed":N,"warnings":[]}`。
失败 400（信封或范围不合法）/ 401（令牌无效）/ 413（体积超限）。

### 5.4 客户端传输：桌面原生直连（绕过系统代理）

Windows 开着系统代理时，`@tauri-apps/plugin-http` 会套用系统代理，连 `192.168.x.x` 也走代理，
局域网同步直接失败。因此**桌面局域网 HTTP 一律走 Rust 原生命令**，不再用 `plugin-http`：

| 项 | 规则 |
|---|---|
| 命令 | `lan_http_request({method, url, headers, body, timeoutMs})` → `{status, body}` |
| 实现 | `apps/desktop/src-tauri/src/lan_http.rs`：`std::net::TcpStream` 手写 HTTP/1.1，**不经系统代理** |
| 目标 | 只允许 `http://` + 局域网 IPv4（含 127/8；拒绝域名、https、公网地址） |
| 方法 | `GET` / `POST` / `OPTIONS`；`Host` / `Content-Length` / `Connection: close` 由原生层补 |
| 响应 | 支持 `Content-Length` 与 `chunked`；正文上限 **20MB**；只接受 UTF-8 |
| 超时 | 默认 **15 秒**（服务端最多等 TS 10 秒，留余量），上限 30 秒 |
| 失败回退 | 原生命令失败时 TS 记 `lan-sync` 日志并回退 `fetch`，保持旧路径可用 |

- Android 不受桌面系统代理影响：`lanFetch` 走 **CapacitorHttp**（`capacitor.config.ts` 里也
  全局接管了 `fetch`），失败时同样回退 `fetch` 并记日志。
- 浏览器的局域网请求仍是普通 `fetch`（依赖服务端 CORS 头）。

## 6. 同步信封（schema 版本保持 1）

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
- 二期没有改信封字段：发现包是另一个 `kind`，预览与自动同步都复用这份信封。
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

## 7. 拉取前预览（二期新增）

1. 用户点「从对方拉取」：先 `GET /export?scope=…` 拿到**一份信封**，不写本机。
2. TS 在本地统计「对方将带来的变更数量」，按课表 / 待办 / 设置分组
   （`apps/web/src/lan-sync-preview.ts` 的 `countLanChanges`）：
   - 行数据：本机没有该 `id`，或对方 `updated_at` **更新**，计 1；
     统计口径与 `importBackup` 的 `merge` 完全一致；缺 `id` 或非法行不计。
   - 设置：`BACKUP_META_KEYS` 中对方有值且与本机不同的键，计 1。
3. 界面显示「同步前预览：对方将带来 课表 N 项 / 待办 N 项 / 设置 N 项」；
   用户点「确认合并」后才把**同一份信封**交给 `applyLanEnvelope`（`merge`），
   避免二次拉取导致「看完数量后又变了」。
4. 用户取消则丢弃信封；预览不产生任何写入。
5. 冲突规则不新增：仍按 `updated_at` 较新获胜，旧的跳过。
6. 预览是**行级估算**：按备份行与 `updated_at` 统计，尚未做逐行外键校验；
   最终写入数以「确认合并」返回的 `imported` / `skipped` 为准。

## 8. 自动同步（二期新增）

设置卡片里的「自动同步」开关与频率选择：

| 模式 | 触发 |
|---|---|
| `off` | 关闭 |
| `startup` | 每次应用启动后，在**已有可用配对会话**时执行一次 |
| `interval30` | 已配对时每 **30 分钟**执行一次；距上次满 30 分钟才跑 |

- 配置存 `localStorage` 的 `dt.lan.auto.v1`：`{ mode, scopes, lastRunAt }`，
  **只存模式、范围与上次运行时间**，不存配对码或令牌。
- 范围沿用卡片上的勾选（`scopes`）；没有勾选任何范围时跳过。
- 自动同步只做**拉取 + merge 合并**（与预览确认后的合并同规则），不自动推送，
  避免两端互相把 `updated_at` 刷新成新值而反复回传。
- 失败**静默重试一次**；仍失败只写 `lan-sync` 日志，不弹 toast。
- 令牌 10 分钟过期或应用重启后没有可用会话：跳过并在界面提示「配对过期，请重新配对」；
  不新增长期凭据，也没有常驻后台进程。

## 9. 原生转发协议（poll / respond / scan）

原生层收到允许的请求后编号入队，TS 轮询取走并回写：

| 动作 | Windows（Tauri 命令） | Android（Capacitor 插件 `LanSync`） |
|---|---|---|
| 列网络 | `lan_network_list()` → `[{name, address, isLan, kind, preferred}]` | `networks()` → `{networks:[…]}` |
| 开服务 | `lan_sync_start({host?})` → `{host, port}` | `start({host?})` → `{host, port}` |
| 停服务 | `lan_sync_stop()` | `stop()` |
| 取请求 | `lan_sync_poll()` → `{id, method, path, query, authorization, body, receivedAt}` 或 `null` | `poll()` → 同字段 |
| 回响应 | `lan_sync_respond(id, status, body)` | `respond({id, status, body})` |
| 扫描设备 | `lan_discovery_scan({timeoutMs, host?})` → `[{name, host, port}]` | `scanDiscovery({timeoutMs})` → `{peers:[…]}` |
| 客户端请求 | `lan_http_request({method, url, headers, body, timeoutMs})` → `{status, body}` | CapacitorHttp（TS 直调，无独立插件方法） |

- `lan_network_list` / `lan_discovery_scan` 的 `host` 都是**选中地址**：
  前者只用于枚举；后者按该地址所属网段过滤扫描结果。
- 队列上限 32 条，满了直接 503；每个连接线程等自己的响应，10 秒超时 504 并清掉队列项。
- 原生层**不校验**配对码/令牌，`Authorization` 原样带给 TS；`/pair` 也照常入队。
- 入队前已完成的拒绝：非局域网来源 403、路径不在上表 404、方法不符 405、请求头过大 431、
  请求体超过 5MB 413、请求不是合法 UTF-8/HTTP 400。
- 轮询间隔由 TS 决定（`LAN_SYNC_POLL_INTERVAL_MS = 400`）；停止配对后不再轮询。
- 开配对成功即启动 UDP 广播；停止配对/页面销毁即停广播；广播不含配对码。
- TS 侧字段命名与 Rust `#[serde(rename_all = "camelCase")]`、Kotlin `JSObject` 一致：
  `id` / `method` / `path` / `query` / `authorization` / `body` / `receivedAt`。

## 10. TS 模块与测试

| 文件 | 职责 |
|---|---|
| `apps/web/src/lan-sync-protocol.ts` | 范围、地址、配对码与会话令牌的纯函数 |
| `apps/web/src/lan-sync-payload.ts` | 信封编解码、`importBackup` 应用与 `handleLanRequest`（服务端纯函数） |
| `apps/web/src/lan-sync.ts` | 客户端 `fetch`、配对、拉取/推送、服务端生命周期、会话状态机 |
| `apps/web/src/lan-sync-http.ts` | 桌面原生直连 / Android CapacitorHttp / 浏览器 fetch 分支与错误体归一 |
| `apps/web/src/lan-sync-network.ts` | 候选排序、默认选择、地址文案与 `dt.lan.host` 读写（纯函数 + 原生桥） |
| `apps/web/src/lan-sync-discovery.ts` | 发现包编解码、去重、TTL、扫描调用（纯函数 + 原生桥） |
| `apps/web/src/lan-sync-preview.ts` | 预览统计、拉取信封、确认后合并 |
| `apps/web/src/lan-sync-auto.ts` | 自动同步配置编解码、启动/30 分钟策略、失败重试一次 |
| `apps/web/src/lan-sync-qr.ts` | 二维码矩阵（字节模式、纠错 M、版本 1–4）与配对文本 |
| `apps/web/src/screens/settings/lan-sync-block.tsx` | 设备页卡片：服务端、二维码、发起方入口 |
| `apps/web/src/screens/settings/lan-sync-client-panel.tsx` | 发现、配对、范围、自动同步、预览与拉取/推送 |
| `apps/web/test/lan-sync.test.ts` | 配对码/范围/状态机/HTTP 处理/双端收发模拟 |
| `apps/web/test/lan-sync-network.test.ts` | 网段优先级、候选排序与默认选择、切换地址、文案与 `dt.lan.host` |
| `apps/web/test/lan-sync-start.test.ts` | 选中地址透传、8 秒超时文案、超时后可重试 |
| `apps/web/test/lan-sync-http.test.ts` | 桌面走 `lan_http_request`、Android CapacitorHttp、失败回退 fetch |
| `apps/web/test/lan-sync-discovery.test.ts` | 发现包编解码、去重、超时、Web 端不发现 |
| `apps/web/test/lan-sync-preview.test.ts` | 预览统计口径、只读、确认后合并 |
| `apps/web/test/lan-sync-auto.test.ts` | 启动/30 分钟策略、重试一次、配置往返 |
| `apps/web/test/lan-sync-qr.test.ts` | 二维码尺寸、定位/时序图案、确定性与超长报错 |
| `apps/web/smoke/entry.tsx` | 设备页卡片、发现列表与填入、预览说明、自动同步开关与频率 |

## 11. 安全清单

- 配对码 6 位数字、5 分钟失效、用后作废；令牌密码学随机（`crypto.getRandomValues`）。
- 令牌、配对码只在本机内存；不写 `app_meta`、不进导出、不进日志。
- 自动同步配置只落 `mode` / `scopes` / `lastRunAt`，不落任何凭据。
- UDP 广播只含设备名 / 局域网地址 / HTTP 端口；**不含配对码与令牌**。
- 二维码包含配对码，只在开配对期间展示；拍照/截屏风险由用户自行控制。
- 只监听局域网地址，并逐请求校验来源地址；只接受局域网目标（客户端侧同样校验）。
- 桌面局域网 HTTP 由原生 `TcpStream` 直连，**不读取系统代理设置**，也不跟随重定向、
  不带 cookie：请求不会被代理或第三方看到；目标必须是局域网 IPv4。
- 请求体 5MB / 响应体 20MB / 每请求 10 秒处理窗口 / 队列 32 条。
- 只传业务数据；日志、快照、预设正文与任何账号密码都不进信封。
- 传输为明文 HTTP、发现为明文 UDP，**只在信任的局域网使用**；不要在公共 Wi-Fi 开配对。

## 12. 未在本仓库验证

- Android 构建在打包机（`pnpm android:dev`）上验证；本仓库本地用
  `gradlew.bat :app:compileDebugKotlin --no-daemon` 做编译检查。
- UDP 广播在真机上的收发、多网卡切换后的广播目标、Windows 防火墙入站规则需真机联调；
  首次开配对时需允许应用访问专用网络。
- 静态核对由 `apps/web/test/plugins.test.ts` 覆盖方法名、插件名与契约文档；
  `apps/web/test/native-commands.test.ts` 覆盖 Tauri 命令注册。
- Rust 侧 `lan_network` 的网段排序 / 网卡分类 / 广播地址、`lan_http` 的 URL / 头 /
  Content-Length / chunked / 超限 / 非局域网拒绝、`lan_discovery` 的编解码与回环广播
  都由 `cargo test` 覆盖（不依赖真实外网）。
