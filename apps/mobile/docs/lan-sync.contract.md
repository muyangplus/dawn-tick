# 局域网同步契约（I-14 三期）

设备与同步页的「局域网同步」：一端开配对，另一端**扫码或粘贴标准配对信息**连上，然后在
**课表 / 待办 / 设置**三个范围里拉取或推送。本文件是 TS、Rust、Kotlin 三端唯一对照表。

三期在「手输 IP + 6 位配对码 + 手动拉取/推送」之上增加：
**标准化连接格式（`dawn-tick://pair?…`）**、**应用内相机扫码配对（Android）**、
**180 天长期令牌与配对持久化**、**断网/重启后自动重连**、**已配对设备列表与移除**、
**令牌刷新 / 吊销接口**。同步信封与冲突规则不变，`schemaVersion` 仍为 **1**。

边界（不做）：mDNS、云端中转、后台常驻服务端、多设备并发导入、账号登录。
浏览器（Web/PWA）只做发起方，不做服务端，也不做 UDP 发现与相机扫码。

## 1. 角色与平台矩阵

| 平台 | 开配对（服务端） | 连接对方（客户端） | UDP 发现 | 相机扫码 | 实现 |
|---|---|---|---|---|---|
| Windows（Tauri） | 是 | 是 | 是（广播 + 扫描） | **否** | `apps/desktop/src-tauri/src/lan_sync.rs`、`lan_discovery.rs` + `apps/web/src/lan-sync*.ts` |
| Android（Capacitor） | 是 | 是 | 是（广播 + 扫描） | **是** | `apps/mobile/android/app/src/main/java/com/dawntick/app/lan/` + `apps/web/src/lan-pair-scan.ts` |
| Web / PWA | **否** | 是（需要对方回 CORS 头） | **否**（只能手输/粘贴） | **否** | `apps/web/src/lan-sync*.ts` |

- 服务端的原生层只做传输：监听、最小 HTTP 解析、只接受局域网来源、请求体上限、排队与超时；
  发现层只做 UDP 广播与扫描，不解释同步数据。
- **配对码与令牌的校验、数据导出/导入、预览统计、自动同步策略与令牌持久化都在 TS**
  （`apps/web/src/lan-sync*.ts`、`lan-pair*.ts`）；原生层不读数据库、不解释业务 JSON。
- 服务端进程内只有一份运行时状态（`Mutex<Option<LanSyncServer>>` / 单例插件字段），
  可信令牌（只含哈希）持久化在 `app_meta`，客户端配对记录（含长期令牌明文）按平台持久化。

## 2. 地址与端口

- HTTP 监听：原生层 **绑定通配地址**（Rust `0.0.0.0` / Android `ServerSocket(0)` 不指定网卡），
  端口由系统分配（`bind(..., 0)`）；**对外广播/展示的是选中网卡的局域网 IPv4**。
  绑定通配地址避免「指定网卡绑定失败 / 切换网络后不可用」导致的开配对失败。
- 安全边界不靠绑定地址：**每个请求仍校验来源必须是局域网地址**（含环回），否则 403。
- 客户端输入：`192.168.1.5:8765`、`http://192.168.1.5:8765`、标准链接
  `dawn-tick://pair?…` 或 `IP:端口 配对码`；只接受局域网地址，公网地址与域名一律拒绝。
- **多网络识别**：本机有多块网卡 / VPN 时，桌面 `lan_network_list()` 与 Android
  `LanSync.networks()` 返回候选 `{name, address, isLan, kind, preferred}`；`kind` 只按网卡名
  推断（`wifi` / `ethernet` / `vpn` / `other`）。排序规则三端一致：
  **局域网地址优先 → 有线/无线优先于其它、VPN 降级到最后 → 192.168.\* > 10.\* >
  172.16–31.\* > 100.64/10 > 169.254/16 → 地址数值**。
- 设备页显示「网络：`<地址> · <分类>`」与「切换网络」下拉；选中的地址写入
  `localStorage` 的 `dt.lan.host`（只存地址，不存凭据），下次开配对优先使用。
  切换后需要**重启配对**（停止再开启），广播地址随之变化。
- `lan_sync_start({host})` / `LanSync.start({host})` 的 `host` 只决定对外展示/广播地址；
  缺省时自动选首选局域网。安卓在 `start` 里另有 **10 秒看门狗**；TS 对 `start` 另有
  **8 秒超时**。失败文案统一为 `开启配对失败：<原因>`，原因可以是原生异常 message 或超时文案，
  设备页提供「重试」。
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

## 4. 配对与长期令牌

1. 服务端「开启配对」或点「新配对码」时生成 6 位数字配对码，**5 分钟**内有效
   （`PAIR_CODE_TTL_MS`），**用后作废**（成功配对后置空）。
2. 客户端 `POST /pair` 提交 `{code, name?}`；成功返回 **180 天长期令牌**（32 位十六进制）
   与到期时间（`LAN_PAIRING_TTL_MS = 180 × 24h`）。
3. 服务端**只保存令牌的 SHA-256 哈希**（`TrustedToken.tokenHash`），不存明文；
   明文令牌只在 `/pair` 与 `/pair/refresh` 的响应里出现一次。
4. 已配对设备不再受「同时只有一个会话」限制：服务端可保存多条可信令牌，
   重新生成配对码后可再配对新设备。配对码仍是一次性的。
5. `POST /pair/refresh` 用现有令牌换新令牌并**顺延 180 天**；旧哈希立即作废。
   客户端在页面打开、`online` 事件与每 30 秒自动调用它做重连探测。
6. `POST /pair/revoke` 吊销当前令牌（设备页「移除」时调用）；成功返回
   `{"revoked":true}`，之后该令牌的请求一律 401。
7. 服务端可信令牌列表持久化在 `app_meta` 键 **`lan_trusted_tokens_v1`**：
   `{ tokenHash, name, createdAt, lastUsedAt, expiresAt }[]`；服务端启动（开启配对）时加载，
   鉴权成功会刷新 `lastUsedAt`。到期令牌在配对/刷新时顺手清理。
8. 客户端配对记录持久化：`app_meta` 键 **`lan_pairings_v1`**，Web 端降级到
   `localStorage` 键 `dt.lan.pairings.v1`：
   `{ id, name, host, port, token, pairedAt, lastSyncAt }[]`（`id` 为 `host:port`）。
   桌面 / 安卓用现有 meta 助手读写；localStorage 不可用时退回 `app_meta`。
9. 自动重连：对每条记录调 `POST /pair/refresh`。在线→换新令牌并显示「在线」；
   断网/超时→显示「离线，仍在重试」并保留记录；401→显示「配对已失效」但不自动删除。
   用户可随时「移除」，移除会先通知服务端吊销。

### 4.1 标准化连接格式

标准载荷（二维码与「复制配对信息」都用它）：

```
dawn-tick://pair?schema=1&host=192.168.1.23&port=8765&code=123456&name=PC
```

- 纯函数：`formatPairPayload({host, port, code, name?})` → 上面的链接；
  `name` 只用于展示，去空白并截断到 48 字符（避免二维码溢出）。
- 解析 `parsePairPayload(text)` 宽容支持四类输入，返回 `{host, port, code, name?}` 或可读错误：
  1. 标准链接（也接受 `dawn-tick:pair?…`、`http(s)://<host>:port/pair?…`）；
  2. `192.168.1.23:8765 123456`；
  3. `192.168.1.23:8765#123456`；
  4. 整段被 URL 编码过的文本（`encodeURIComponent(链接)`，扫码/聊天工具二次编码）。
- 统一校验：地址必须是局域网 IPv4（`parsePeerAddress` 同口径）、端口 1–65535、
  配对码 6 位数字；`name` 可选。
- 二维码下方同时显示人类可读文本 `IP:端口 配对码`，扫码失败时仍可手输。

### 4.2 二维码与相机扫码

- 二维码由本地编码器（`apps/web/src/lan-sync-qr.ts`）生成：字节模式、纠错 M、版本 1–6
  （最多 106 字节；标准链接约 72–90 字节）。超过上限时退回可读提示，不阻断页面。
- **Android 应用内扫码**：`apps/web/src/lan-pair-scan.ts` 动态 `import`
  `@capacitor-mlkit/barcode-scanning@8.2.1`（Capacitor 8 兼容）：
  - `isScanAvailable()` 仅 Android 原生返回 true；
  - `scanPairPayload()`：`isSupported()` → `requestPermissions()` → `startScan()` +
    `barcodesScanned` 监听，**扫到第一条即 `stopScan`**；用户取消返回 `null`；
    权限被拒 / 组件缺失 / 相机被占用都抛出可读原因；
  - `stopScan()` 幂等，离开页面时关闭相机；
  - 选择 `startScan`（打包进 APK 的 ML Kit 模型）而不是 `scan()`（依赖 Google Play 服务），
    无 GMS 的国产 ROM 也能扫码。
- Android 权限：`AndroidManifest.xml` 声明 `android.permission.CAMERA`；
  `<uses-feature android:name="android.hardware.camera" android:required="false"/>`。
  `cap sync android` 后 `capacitor.plugins.json` 会注册
  `io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerPlugin`。
- Web / 桌面不显示「扫码配对」，保留「粘贴配对信息」入口，解析同一套格式。

## 5. HTTP 接口

服务端实现六个入口，其它路径 404，方法不符 405。请求/响应均为 UTF-8 JSON。
预览复用 `GET /export`，在客户端本地统计；重连复用 `POST /pair/refresh`。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/pair` | 无（配对码） | 配对码换 180 天长期令牌 |
| `POST` | `/pair/refresh` | `Authorization: Bearer <token>` | 换新令牌并顺延有效期（自动重连） |
| `POST` | `/pair/revoke` | `Authorization: Bearer <token>` | 吊销当前令牌（移除配对） |
| `GET` | `/export?scope=…` | `Authorization: Bearer <token>` | 导出所选范围；预览也用它 |
| `POST` | `/import?scope=…&mode=merge\|overwrite` | `Authorization: Bearer <token>` | 导入（合并/覆盖） |
| `OPTIONS` | 任意 | 无 | CORS 预检，原生层直接 204 |

- `scope` 取值 `timetable` / `todos` / `settings`，逗号分隔；未知值忽略，空范围 400。
- **范围由发起方决定**：拉取方在 `/export` 里选，推送方在 `/import` 里选；
  接收方卡片上的勾选只影响它自己发起的请求。导入时生效范围再与信封里的 `scope` 取交集。
- `mode` 缺省 `merge`：按行 `updated_at` 较新的一方获胜，旧的跳过（复用
  `packages/core/src/backup.ts` 的 `importBackup` 规则）；`overwrite` 直接覆盖。
- 统一错误体：`{"error":{"code":"…","message":"…"}}`，
  `code` ∈ `bad_request` / `unauthorized` / `not_found` / `method_not_allowed` /
  `payload_too_large` / `busy` / `timeout` / `forbidden` / `internal`。
- 请求体上限 **5MB**（`MAX_REQUEST_BYTES`），响应体上限 **20MB**；超限 413/500。
- 原生层等待 TS 处理的上限 **10 秒**，超时回 504 并把请求从队列里丢掉。
- 所有响应带 CORS 头（`Access-Control-Allow-Origin: *` 等），浏览器端才能作为客户端；
  响应头 `Cache-Control: no-store`。连接一律 `Connection: close`。

### 5.1 `POST /pair`

请求：`{"code":"123456","name":"手机","schemaVersion":1}`（`name` 可选，写入服务端
「已配对设备」的显示名，缺省「未知设备」）
成功 200：`{"token":"<32 hex>","expiresAt":1759900000000,"schemaVersion":1}`
失败：400（JSON 不合法） / 401（格式不对、不匹配或已过期）

### 5.2 `POST /pair/refresh`

请求：空 JSON 或 `{"schemaVersion":1}`，鉴权 `Bearer <token>`。
成功 200：`{"token":"<新 32 hex>","expiresAt":<now+180d>,"schemaVersion":1}`；旧令牌立即失效。
失败 401（缺失、无效或过期）。

### 5.3 `POST /pair/revoke`

请求：空 JSON 或 `{"schemaVersion":1}`，鉴权 `Bearer <token>`。
成功 200：`{"revoked":true,"schemaVersion":1}`；服务端删除该哈希。
失败 401（缺失、无效或已过期；客户端仍会删除本地记录并提示）。

### 5.4 `GET /export`

成功 200：§6 的同步信封。失败 400（缺范围）/ 401（令牌缺失、无效或过期）。

### 5.5 `POST /import`

请求体：§6 的同步信封。成功 200：`{"imported":N,"skipped":N,"removed":N,"warnings":[]}`。
失败 400（信封或范围不合法）/ 401（令牌无效）/ 413（体积超限）。

### 5.6 客户端传输：桌面原生直连（绕过系统代理）

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
- 自动同步复用当前会话的长期令牌；令牌持久化与重启后的重连由「已配对设备」列表负责
  （§4 第 8–9 条），自动同步本身不新增长期凭据，也没有常驻后台进程。

### 8.1 已配对设备与自动重连（三期新增）

设备页「已配对设备」列表每行显示：名称 / 地址、在线状态、上次同步时间、
[立即同步] [移除]。

- 数据来自 §4 第 8 条的 `lan_pairings_v1`（Web 为 localStorage）；配对成功立即写入
  （同名设备按 `host:port` 覆盖），拉取/推送成功更新 `lastSyncAt`。
- 触发探测：组件挂载、列表变化、浏览器 `online` 事件、每 **30 秒**
  （`LAN_RECONNECT_INTERVAL_MS`）。探测 = `POST /pair/refresh`。
- 在线：换新令牌并写入持久化，显示「在线」；[立即同步] 再拉取全部范围并合并。
- 离线：显示「离线，仍在重试」，**不删除配对**；断网恢复后下一次探测自动回到在线。
- 401：显示「配对已失效，可移除后重新配对」；不自动删除，避免误删用户数据。
- 移除：先调 `POST /pair/revoke`；失败也删除本地记录，并提示「对方未响应，可能仍保留授权」。
- 安全提示：**配对设备可长期访问本机同步接口（180 天），可随时在设备页移除**。

## 9. 原生转发协议（poll / respond / scan）

原生层收到允许的请求后编号入队，TS 轮询取走并回写：

| 动作 | Windows（Tauri 命令） | Android（Capacitor 插件 `LanSync`） |
|---|---|---|
| 列网络 | `lan_network_list()` → `[{name, address, isLan, kind, preferred}]` | `networks()` → `{networks:[…]}` |
| 开服务 | `lan_sync_start({host?})` → `{host, port, listening}` | `start({host?})` → `{host, port, listening}` |
| 停服务 | `lan_sync_stop()` | `stop()`（幂等） |
| 取请求 | `lan_sync_poll()` → `{id, method, path, query, authorization, body, receivedAt}` 或 `null` | `poll()` → 同字段 |
| 回响应 | `lan_sync_respond(id, status, body)` | `respond({id, status, body})` |
| 扫描设备 | `lan_discovery_scan({timeoutMs, host?})` → `[{name, host, port}]` | `scanDiscovery({timeoutMs})` → `{peers:[…]}` |
| 客户端请求 | `lan_http_request({method, url, headers, body, timeoutMs})` → `{status, body}` | CapacitorHttp（TS 直调，无独立插件方法） |

- `host` 只决定对外展示/广播地址；socket 绑定通配地址（`0.0.0.0` / 不指定网卡）。
  原生层在 resolve 前确认 socket 已 bind，`listening === true`；绑定失败把原始异常 message
  reject 给 TS，界面显示 `开启配对失败：<原因>`。
- `lan_network_list` / `lan_discovery_scan` 的 `host` 都是**选中地址**：
  前者只用于枚举；后者按该地址所属网段过滤扫描结果。
- 队列上限 32 条，满了直接 503；每个连接线程等自己的响应，10 秒超时 504 并清掉队列项。
- 原生层**不校验**配对码/令牌，`Authorization` 原样带给 TS；`/pair`、`/pair/refresh`、
  `/pair/revoke` 也照常入队（三者都在原生路径白名单里）。
- 入队前已完成的拒绝：非局域网来源 403、路径不在白名单 404、方法不符 405、请求头过大 431、
  请求体超过 5MB 413、请求不是合法 UTF-8/HTTP 400。
- 轮询间隔由 TS 决定（`LAN_SYNC_POLL_INTERVAL_MS = 400`）；停止配对后不再轮询。
- 开配对成功即启动 UDP 广播；停止配对/页面销毁即停广播；广播不含配对码。
- TS 侧字段命名与 Rust `#[serde(rename_all = "camelCase")]`、Kotlin `JSObject` 一致：
  `id` / `method` / `path` / `query` / `authorization` / `body` / `receivedAt`。

## 10. TS 模块与测试

| 文件 | 职责 |
|---|---|
| `apps/web/src/lan-sync-protocol.ts` | 范围、地址、配对码、长期令牌（哈希/签发/校验/刷新/吊销/序列化）纯函数 |
| `apps/web/src/lan-pair-payload.ts` | 标准连接格式 `formatPairPayload` / 宽容解析 `parsePairPayload` / 人类可读文本 |
| `apps/web/src/lan-pair-scan.ts` | Android 相机扫码（动态加载 `@capacitor-mlkit/barcode-scanning`）与可读错误 |
| `apps/web/src/lan-pairings.ts` | 客户端配对持久化（meta/localStorage）、自动重连状态机与探测 |
| `apps/web/src/lan-trust-store.ts` | 服务端可信令牌读写 `lan_trusted_tokens_v1`（只存哈希） |
| `apps/web/src/lan-sync-payload.ts` | 信封编解码、`importBackup` 应用与 `handleLanRequest`（服务端纯函数） |
| `apps/web/src/lan-sync.ts` | 服务端生命周期（开/停监听、轮询、回写、运行时令牌） |
| `apps/web/src/lan-sync-client.ts` | 客户端配对、刷新/吊销、拉取/推送与客户端状态机 |
| `apps/web/src/lan-sync-http.ts` | 桌面原生直连 / Android CapacitorHttp / 浏览器 fetch 分支与错误体归一 |
| `apps/web/src/lan-sync-network.ts` | 候选排序、默认选择、地址文案与 `dt.lan.host` 读写（纯函数 + 原生桥） |
| `apps/web/src/lan-sync-discovery.ts` | 发现包编解码、去重、TTL、扫描调用（纯函数 + 原生桥） |
| `apps/web/src/lan-sync-preview.ts` | 预览统计、拉取信封、确认后合并 |
| `apps/web/src/lan-sync-auto.ts` | 自动同步配置编解码、启动/30 分钟策略、失败重试一次 |
| `apps/web/src/lan-sync-qr.ts` | 二维码矩阵（字节模式、纠错 M、版本 1–6）与人类可读文本 |
| `apps/web/src/screens/settings/lan-sync-block.tsx` | 设备页卡片：服务端状态、令牌哈希落盘、发起方入口 |
| `apps/web/src/screens/settings/lan-sync-server-panel.tsx` | 网络切换、开/停配对、新配对码、二维码与复制 |
| `apps/web/src/screens/settings/lan-sync-pair-panel.tsx` | 手输/扫码/粘贴配对、全屏扫码覆盖层 |
| `apps/web/src/screens/settings/lan-sync-devices-panel.tsx` | 已配对设备列表、在线状态、立即同步与移除 |
| `apps/web/src/screens/settings/lan-sync-client-panel.tsx` | 发现、配对、范围、自动同步、预览与拉取/推送 |
| `apps/web/test/lan-sync.test.ts` | 配对码/长期令牌/刷新/吊销/范围/状态机/HTTP 处理/双端收发模拟 |
| `apps/web/test/lan-pair-payload.test.ts` | 标准格式生成、四类输入解析与错误原因 |
| `apps/web/test/lan-pair-scan.test.ts` | 扫码可用性、取消返回 null、扫码文本走同一解析器、错误文案 |
| `apps/web/test/lan-pairings.test.ts` | 配对记录持久化（meta/localStorage）、自动重连状态机、探测分支 |
| `apps/web/test/lan-sync-network.test.ts` | 网段优先级、候选排序与默认选择、切换地址、文案与 `dt.lan.host` |
| `apps/web/test/lan-sync-start.test.ts` | 选中地址透传、8 秒超时、原生异常透传与「重试」文案 |
| `apps/web/test/lan-sync-http.test.ts` | 桌面走 `lan_http_request`、Android CapacitorHttp、失败回退 fetch |
| `apps/web/test/lan-sync-discovery.test.ts` | 发现包编解码、去重、超时、Web 端不发现 |
| `apps/web/test/lan-sync-preview.test.ts` | 预览统计口径、只读、确认后合并 |
| `apps/web/test/lan-sync-auto.test.ts` | 启动/30 分钟策略、重试一次、配置往返 |
| `apps/web/test/lan-sync-qr.test.ts` | 二维码尺寸（v1–6）、定位/时序图案、确定性与超长报错 |
| `apps/web/smoke/entry.tsx` | 设备页卡片、发现列表与填入、预览说明、自动同步；Android 扫码桩 → 已配对列表 → 移除 |

## 11. 安全清单

- 配对码 6 位数字、5 分钟失效、用后作废；令牌密码学随机（`crypto.getRandomValues`）。
- **服务端只保存令牌的 SHA-256 哈希**（`lan_trusted_tokens_v1`）；明文令牌只在
  `/pair`、`/pair/refresh` 响应里出现一次，客户端保存用于重连。
- 客户端配对记录（含明文令牌）存 `app_meta` `lan_pairings_v1` / Web localStorage；
  不进入备份导出、不写日志、不出现在 UI 文本里。
- 自动同步配置只落 `mode` / `scopes` / `lastRunAt`，不落任何凭据。
- UDP 广播只含设备名 / 局域网地址 / HTTP 端口；**不含配对码与令牌**。
- 二维码与标准链接包含配对码，只在开配对期间展示；拍照/截屏风险由用户自行控制。
- 监听 socket 绑定通配地址，但**逐请求校验来源地址**；只接受局域网目标（客户端侧同样校验）。
- 配对设备可长期访问本机同步接口（180 天），可在「已配对设备」里随时移除；
  移除会调 `/pair/revoke`，服务端删除哈希后旧令牌立即 401。
- 桌面局域网 HTTP 由原生 `TcpStream` 直连，**不读取系统代理设置**，也不跟随重定向、
  不带 cookie：请求不会被代理或第三方看到；目标必须是局域网 IPv4。
- 请求体 5MB / 响应体 20MB / 每请求 10 秒处理窗口 / 队列 32 条。
- 只传业务数据；日志、快照、预设正文与任何账号密码都不进信封。
- 传输为明文 HTTP、发现为明文 UDP，**只在信任的局域网使用**；不要在公共 Wi-Fi 开配对。

## 12. 未在本仓库验证（真机清单）

- Android 构建在打包机（`pnpm android:dev`）上验证；本仓库本地用
  `gradlew.bat :app:compileDebugKotlin --no-daemon` 做编译检查（已通过）。
- **安卓真机开配对**：确认 `start` 返回 `listening:true` 且另一台设备能连上；
  验证无 GMS / 国产 ROM 与有 GMS 设备各一台。
- **相机扫码**：首次请求 CAMERA 权限、拒绝后提示、扫到即停、取消返回空、
  微信/系统相机扫同一二维码也可读；验证 `startScan` 相机预览与 WebView 透明覆盖层。
- 重启应用 / 切换 Wi-Fi / 飞行模式恢复后，「已配对设备」自动回到在线，不需要重输配对码。
- 移除配对后，对方设备再请求应得 401；服务端 `app_meta` 的
  `lan_trusted_tokens_v1` 不再包含该哈希。
- UDP 广播在真机上的收发、多网卡切换后的广播目标、Windows 防火墙入站规则需真机联调；
  首次开配对时需允许应用访问专用网络。
- 静态核对由 `apps/web/test/plugins.test.ts` 覆盖方法名、插件名与契约文档；
  `apps/web/test/native-commands.test.ts` 覆盖 Tauri 命令注册。
- Rust 侧 `lan_network` 的网段排序 / 网卡分类 / 广播地址、`lan_http` 的 URL / 头 /
  Content-Length / chunked / 超限 / 非局域网拒绝、`lan_discovery` 的编解码与回环广播，
  以及 `lan_sync` 的通配绑定、路径白名单（含 refresh/revoke）都由 `cargo test` 覆盖。
