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

## 发布

- [x] 仓库 secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`（已用 `tools/release/set-github-secrets.ps1` 写入 muyangplus/dawn-tick，四个都在；keystore 走临时文件经 stdin 传入，不回显任何口令）
