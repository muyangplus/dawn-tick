# TODO

## 课表布局

- [x] 网格按真实分钟向上/向下扩展：头部与尾部补白随自定义时间条目伸缩（`grid-metrics.ts`：补白 = 超出第一节/最后一节的分钟 × 每行分钟折算，最多各三行），节次轴、当前时间线、空白格落点与拖动换算一起平移；补白区标出真实时间范围（`data-role="grid-pad-top"` / `data-role="grid-pad-bottom"`）
- [x] 行高自适应真实窗口复核：卡片探针一直量不到东西——可点击的课表卡片渲染成 `<button>` 且没带 `data-role="course-card"`（只有只读 `div` 带），已给两种形态都补上；1000×720 实测 12 张卡片 `clipped:false, overflow:0`，窄到 336px 时按 8px 逐级加到上限 96 仍被裁（宽度不够，非高度问题）并写 `行高已到上限仍有内容被裁` 告警

## 数据层重构

- [x] 存储位置：便携版默认程序同目录（名为 `DawnTick.exe` 且不在 `%LOCALAPPDATA%\DawnTick`），安装版 `%APPDATA%\com.dawntick.app`；设置里可填自定义绝对/相对路径（相对程序目录），改完复制数据库、窗口几何与日志并重启生效；数据目录不可写时回退默认并提示
- [x] 数据库日志模式：设置页「启用 WAL 日志模式」开关，默认便携版关闭（`journal_mode=DELETE`、单文件、无 `-wal`/`-shm`）、安装版与 Android 开启
- [x] 数据管理模块：导出与导入抽成 `data-management` 模块；导出 JSON 文件 / Base64 文本 / 整包 zip（可选一并打包预设快照与日志），导入支持 JSON、Base64 文本与整包 zip，冲突处理为跳过 / 覆盖 / 清空所选模块后导入 / 按修改时间合并；设置键清单补全（`auto_check_update`、`todo_sort`、`dev_features`、`log_enabled`、`log_level`、`wal_mode`）
- [x] 备份与恢复：Windows 用 `VACUUM INTO` 在数据目录 `backups/` 写整库文件快照，Web 与 Android 把 JSON 快照存进库内；自动备份总开关 + 「启动时」「每天」两个开关 + 保留份数 1–100（默认 10）；设置页列出快照（时间、大小）可查看 / 恢复 / 删除，恢复前自动备一份当前库，文件快照恢复后提示并给「立即重启」
- [x] WebDAV 云同步：一个包上传整库快照 + 设置与预设；下载可选「恢复全部」（提示重启）或「只应用设置与预设」（当场热加载），下载前先自动备份本机；地址/用户名/密码存本机设置（密码不进导出）；远端文件名可选固定覆盖或保留历史多份；自动同步为启动 + 每天一次且可配置，远端更新时提示下载、否则上传；Windows 走 Tauri 官方 http 插件，Android 由 Capacitor 接管 fetch，Web 用浏览器 fetch
- [x] Windows 起不来（`failed to initialize plugin http: 拒绝访问`）：http 插件默认特性带 cookies，初始化要在 `%LOCALAPPDATA%\com.dawntick.app\cache` 建 `.cookies` 文件，权限稍有问题就整个应用启动失败；已关掉 `cookies` 特性（只留 rustls-tls / http2 / charset / system-proxy），WebDAV 用 Basic 认证不需要 cookie
- [ ] 老库兼容：Windows 侧迁移由原生插件的 `_sqlx_migrations` 记账，若某个库是早期纯 JS 迁移建的（没有该表），插件的迁移会从 001 重跑并因「表已存在」失败，表现为回退 IndexedDB（本机现有库都有该表，未触发）

## 界面

- [ ] 「我的」页面内容（当前为建设中占位）
- [x] 引导页可滚动：`data-role="onboarding-scroll"`（`h-full` + `overflow-y-auto` + 内层 `my-auto` 居中），解决被 `#root { overflow: hidden }` 裁掉、滚不动的问题
- [x] 学校选择收进首启页「高级设置」`<details>`（默认收起，`summary` 显示已选学校；「已有数据：直接导入」保持可见）
- [x] 底部栏与悬浮按钮留白：`--dt-bottom-nav` / `--dt-bottom-fab` 变量，`app-main` 的 `padding-bottom`（含 `tablet:` 断点，原先被 `tablet:p-4` 覆盖成 16px）与「快速添加」按钮位置同源；实测 1000×720 `navHeight 56 / mainPadBottom 120`、336×656 同样通过
- [x] 布局自检写日志：`layout: 视口变化`（视口 / shell / main / 底部栏高度 / 主区留白 / 卡片数 / 补白是否存在）、`layout: 行高自适应` 与 `layout: 行高自检`；留白小于栏高、行高到上限仍被裁都会告警
- [x] 日志级别从未同步到原生：`App.tsx` 里 `applyLogSettings` 只导入未调用，已在设置变化时同步（修好后 `dawn-tick.log` 才能看到 `[debug]`/`[trace]`）
- [x] 引导页「请求适配 / 提交学校信息」点了没反应：`ExternalLinkConfirm` 只挂在主壳里，引导页分支没挂（所以创建学期后弹窗才冒出来）→ 引导页也挂上
- [x] 选校改弹窗：首启页「高级设置」里只留一行「已选：X」+「选择学校」按钮，点开 `SchoolPickerDialog`（搜索 / 筛选 / 列表，选中即关），不再把长列表铺在页面上
- [x] 卡片布局独立成对话框：设置页顶部固定一个「卡片布局」按钮（不受卡片显隐影响），面板里新增「全部显示」把被隐藏的卡片一次改回可见
- [x] 倒计时块宽屏只占一半：按你的要求**不改**（它在侧列，需要时在「卡片布局」里把「倒计时」切到主列即可占满整行）
- [x] 去掉便携目录里的 EBWebView 与 window.json：WebView2 用户数据目录固定到 `%LOCALAPPDATA%\com.dawntick.app\EBWebView`（首次运行把旧的 `<数据目录>\EBWebView` 整体搬过去；新位置已有数据就清掉残留；搬迁失败继续用旧位置），窗口几何改存数据库 `app_meta.window_geometry` 并在窗口显示前由原生侧读出应用（实测：启动即按 1250×900 恢复、无跳动；`window.json` 启动时清理）
- [x] 「倒计时」与「日期与倒计时」合并成一张卡：开学/假期徽标在上、逐条作业与考试倒计时在下（`data-role="countdown-badges"` / `countdown-row` 同属一张卡）；卡片 id 仍用 `exams`（不动 id，已保存的布局不失效），`countdownsCard` 与「日期与倒计时」标题删除
- [x] 开发者特性默认关闭：dev 构建也按正式版特性运行，诊断入口（导出日志 / 打开日志目录 / 日志级别）需要手动打开开关才显示；`DEFAULT_SETTINGS.devFeatures = false`
- [x] 首次引导页可跳过：「跳过，先用默认学期」直接用默认值建「我的学期」（本周一开学、20 周、内置默认作息）进入应用，之后在设置里随时可改；建学期逻辑与「创建并开始」共用同一段
- [x] beta 更新源对齐：客户端原来查滚动标签 `beta-latest`（流水线只发 `vX.Y.Z-beta.N`，永远查不到）→ 改为查发布列表，取「最新 beta 预发布」与「最新正式版」中版本更高的那个；正式版发布后测试版用户可直接更到正式版
- [x] 首次 beta 发版：`v0.1.0-beta.1`（提交 `1aac20a`，预发布，Windows 安装包 / 便携包 / release 签名 APK / Web 包各带 sha256）
- [x] 安卓明文与外部链接：清单加 `usesCleartextTraffic`（教务站点多为 http）与 http/https 的 `<queries>`（Android 11+ 不声明包可见性时一律判为打开失败）；外部链接改走原生 `ACTION_VIEW`
- [x] 安卓启动索取权限：启动申请通知（Android 13+），课前提醒开着且精确闹钟未授权时跳一次系统页；设置页「提醒设置」加精确闹钟与电池优化白名单状态与入口
- [x] 倒计时卡片实时刷新：正文抽成组件 + `useNowTick(15s)`，不再等别处的数据刷新
- [x] 课表卡片去边框、文字完整显示：去掉块边框与左侧色条边框（改内阴影色条），课名/地点/教师强制换行，去掉 `line-clamp` 与 `truncate`；行高自适应继续按实际高度加高
- [x] 界面动效可自定义：新增「界面动效」设置（跟随系统 / 始终播放 / 关闭动效），弹窗、抽屉与视图进入走 150–200ms 过渡，`data-motion` 落到根节点统一控制
- [x] 加载动画与防重复点击：`runBusy` 蒙版 + `Button loading`（自动禁用与转圈）+ `useBusyAction` 忽略重复触发
- [ ] 局域网多端同步（路线图）：同一局域网内配对后自动同步；一期计划为「一端生成配对码 → 另一端输码建立信任 → 按范围（课表 / 待办 / 设置）与覆盖方向互传」，后续再做后台自动同步与冲突合并
- [x] 移除 beta 分支：`dev` 改 PR 合入 `main`，beta 与 release 都用 `main` 的提交打标签（beta 打 `vX.Y.Z-beta.N`）
- [x] 周视图改为「从今天开始的 N 天窗口」：网格按日期键（跨周两周的课都进来）、拖动/碰撞/空白新建/调课预填全按日期、上一屏与下一屏按 N 天平移、`T` 回今天；冒烟补 7 条窗口断言（从今天起、列数=设置天数、前后平移、回到今天、← → 与 T）后 215 项全过


## 发布

- [x] 仓库 secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`（已用 `tools/release/set-github-secrets.ps1` 写入 muyangplus/dawn-tick，四个都在；keystore 走临时文件经 stdin 传入，不回显任何口令）
