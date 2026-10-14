# TODO

## 课表布局

- [ ] 网格按真实分钟向上/向下扩展：头部与尾部补白随自定义时间条目伸缩，节次轴、当前时间线与拖动换算一起平移（现状：超出节次范围的自定义时间条目夹进网格保证可见）
- [ ] 行高自适应在真实窗口里逐项验证：课程名/地点/教师与「显示在课表上」的待办条目都要完整显示，行高在 56–96 之间；探测已改为逐后代比较（含 `truncate` / `line-clamp` 的 span），拖动残影已排除，jsdom 量不到布局只能人工看

## 数据层重构

- [x] 存储位置：便携版默认程序同目录（名为 `DawnTick.exe` 且不在 `%LOCALAPPDATA%\DawnTick`），安装版 `%APPDATA%\com.dawntick.app`；设置里可填自定义绝对/相对路径（相对程序目录），改完复制数据库、窗口几何与日志并重启生效；数据目录不可写时回退默认并提示
- [x] 数据库日志模式：设置页「启用 WAL 日志模式」开关，默认便携版关闭（`journal_mode=DELETE`、单文件、无 `-wal`/`-shm`）、安装版与 Android 开启
- [x] 数据管理模块：导出与导入抽成 `data-management` 模块；导出 JSON 文件 / Base64 文本 / 整包 zip（可选一并打包预设快照与日志），导入支持 JSON、Base64 文本与整包 zip，冲突处理为跳过 / 覆盖 / 清空所选模块后导入 / 按修改时间合并；设置键清单补全（`auto_check_update`、`todo_sort`、`dev_features`、`log_enabled`、`log_level`、`wal_mode`）
- [x] 备份与恢复：Windows 用 `VACUUM INTO` 在数据目录 `backups/` 写整库文件快照，Web 与 Android 把 JSON 快照存进库内；自动备份总开关 + 「启动时」「每天」两个开关 + 保留份数 1–100（默认 10）；设置页列出快照（时间、大小）可查看 / 恢复 / 删除，恢复前自动备一份当前库，文件快照恢复后提示并给「立即重启」
- [x] WebDAV 云同步：一个包上传整库快照 + 设置与预设；下载可选「恢复全部」（提示重启）或「只应用设置与预设」（当场热加载），下载前先自动备份本机；地址/用户名/密码存本机设置（密码不进导出）；远端文件名可选固定覆盖或保留历史多份；自动同步为启动 + 每天一次且可配置，远端更新时提示下载、否则上传；Windows 走 Tauri 官方 http 插件，Android 由 Capacitor 接管 fetch，Web 用浏览器 fetch
- [ ] 老库兼容：Windows 侧迁移由原生插件的 `_sqlx_migrations` 记账，若某个库是早期纯 JS 迁移建的（没有该表），插件的迁移会从 001 重跑并因「表已存在」失败，表现为回退 IndexedDB（本机现有库都有该表，未触发）

## 界面

- [ ] 「我的」页面内容（当前为建设中占位）
- [ ] 暂停时未提交的改动（改完但未 verify-all、未 commit，工作区文件：`apps/web/src/screens/onboarding.tsx`、`apps/web/src/App.tsx`、`apps/web/src/components/nav.tsx`、`apps/web/src/styles.css`、`apps/web/smoke/entry.tsx`）：
  - 引导页整页可滚动：`data-role="onboarding-scroll"`，`h-full` + `overflow-y-auto` + 内层 `my-auto` 居中（原先被 `#root { overflow: hidden }` 裁掉，无法滚动）
  - 学校选择折叠进首启页「高级设置」`<details>`（默认收起，`summary` 显示已选学校；「已有数据：直接导入」保持可见）
  - 底部栏与悬浮按钮留白：新增 `--dt-bottom-nav` / `--dt-bottom-fab`，`app-main` 的 `padding-bottom` 与「快速添加」按钮的 `bottom` 都按它们加安全区计算，`BottomNav` 用同一高度
  - 布局自检写日志：`layout: 视口变化` 带上 `navHeight` 与 `mainPadBottom`，留白小于栏高告警；`layout: 引导页滚动容器` 记录内容超出却不可滚动的情况
  - 日志级别从未同步到原生：`App.tsx` 里 `applyLogSettings` 只导入未调用 → 设置里的「应用诊断日志 / 日志级别」对 `dawn-tick.log` 无效，写文件门槛停在 info（`[debug]`/`[trace]` 进不去）；已补 effect 同步
- [ ] 上述改动的收尾：`verify-all` 全量验证 + 真实窗口复核（引导页能滚到底、底部栏与悬浮按钮不挡内容、日志级别改 trace 后文件里能看到 `[debug]`；jsdom 量不到布局，只能靠真机日志里的 `layout: 视口变化` / `引导页滚动容器` 两行判断）

## 发布

- [ ] 仓库 secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`
