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

## 界面

- [ ] 「我的」页面内容（当前为建设中占位）

## 发布

- [ ] 仓库 secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`
