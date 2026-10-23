# TODO

> 当前版本 `v0.6.3`（2026-10-23 发布）。已完成任务的详细位置/证据/改法不再保留（查 git log 与 CHANGELOG.md）；本文件只留待验收清单、未完成方向、决策与边界。
> 历史事实索引（行号类快照）已随重构完成而移除；需要时按函数名 / `data-role` / 文案锚点检索。

## 0. 现状快照

- **版本**：`0.6.3`（`versionCode 603`）。已发布 `v0.1.0`、`v0.2.0-beta.1`、`v0.3.0-beta.1`、`v0.4.0`、`v0.4.1`、`v0.5.0`、`v0.6.0`、`v0.6.1`、`v0.6.2`、`v0.6.3`；`dev` 分支推送会自动滚动发布 `dev-latest`。
- **验证**：`pnpm test`（core 276 / web 487 / tools 36）、`pnpm ui:smoke`（430 项，固定 `Asia/Shanghai` 与 2026-10-18T18:30 时钟）、`tools/verify/verify-all.ps1`（18 项）、小组件契约检查。
- **CI**：四个 job——`node`（typecheck / test / 界面冒烟）、`schema`、`rust`、`android`（编译校验；失败时把 gradle 日志推到 `ci-debug` 分支）。
- **本地安卓编译**（无需 CI 往返）：`JAVA_HOME=C:\Users\<user>\.gradle\jdks\eclipse_adoptium-21-amd64-windows\jdk-21.0.7+6`、`ANDROID_HOME=E:\work\dsh\android-sdk`，在 `apps/mobile/android` 跑 `gradlew.bat :app:compileDebugKotlin --no-daemon`。
- **结构**：`App.tsx` 449 行；`settings-view.tsx` 212 行 / `devices-view.tsx` 176 行，卡片在 `screens/settings/`；`data.ts` 732 行（`loadAppData` 70 行）；`app/` 拆启动编排、会话、课表动作、副作用、恢复；`screens/{import,timetable,settings}/` 均按职责拆分，单文件 ≤400 行。
- **单点**：文案 `copy/zh.ts`；节次范围 `lib/format.ts`；课程色 `core/colors.ts`；原生桥 `lib/native.ts`（命令与 Rust 一一对应）；插件契约 `lib/plugins.ts` + `apps/mobile/docs/plugins.contract.md`；`app_meta` 助手 `lib/meta.ts` + 键清单 `lib/meta-keys.ts`；局域网协议 `apps/mobile/docs/lan-sync.contract.md`。

## 1. 已交付（截至 0.6.0，均已通过 CI）

| 批次 | 内容 | 版本 |
|---|---|---|
| P0（8 条） | 删除入口与确认框、详情关闭出口、设置页快捷动作与单一导入入口、备份键清单、整包打包共用、`weeks_raw` 派生 | 0.3.0-beta.1 |
| P1（13 条） | 设备与同步页、统一「＋」菜单、搜索直达、调课合并、待重启条、通知六态、回退只读、错误页、空态三态、键盘可达、版本号兜底等 | 0.3.0-beta.1 / 0.4.0 |
| P2（17 条） | 表单语义、导入冲突筛选与手动映射、引导页统一、校验与忙碌态、侧列布局、移动端 Sheet、悬浮窗与小组件文案、命名与文风统一等 | 0.3.0-beta.1 / 0.4.0 |
| A 系列（18 条） | 时间/颜色/文案单源、重叠与钟点纯函数、原生桥收口、大文件拆分、组件基元、快照索引、CI 冒烟与安卓编译、视图过渡等（A-16 按重合度关闭） | 0.4.1 |
| 体验反馈（15 条） | 更新判定与 Markdown 弹窗、三端自动更新、渠道警告、悬浮窗自适应与拉伸、时区偏移与搜索、默认周视图、课表滚动与拖动、调课改考试、导出路径、导入重构、局域网同步一期、统一动效 | 0.5.0 |
| R 系列（11 条） | ICS 导出、考试倒计时悬浮窗、主题联动悬浮窗与小组件、提醒动作、更新运营（忽略/回滚）、局域网二期（发现/二维码/预览/自动同步）、备份导出加密、课表图片与 PDF、学期统计、WebDAV 凭据加密、导入诊断 | 0.6.0 |

## 2. 待验收（需要真机 / 实机证据）

- **Windows 桌面**：悬浮窗按内容自适应与拉伸记忆、双击唤主窗口、托盘「提醒」菜单动作、自动更新下载→启动安装、备份/课表导出的「打开所在位置」、DPAPI 凭据加密后的 WebDAV 同步。
- **Android 真机**：通知动作（贪睡/完成/勿扰）、开机与杀进程后的提醒投递、APK 自动更新与系统安装器、导出分享与「打开所在位置」、Keystore 凭据加密、小组件主题配色与「还有 N 节」。
- **双设备**：局域网同步配对、UDP 自动发现、预览后合并、30 分钟自动同步；防火墙放行。
- **发布链路**：`v0.6.0` Release 产物与 `.sha256`、`version.json` 可访问；自动更新能从 0.5.0 升到 0.6.0。

## 3. 未完成方向

### 待定口径

- **R-05 教务系统在线抓取**：卡在 Q15（内嵌会话是否复用、凭据是否落盘、抓取合规边界）。定了才能开，入口放导入流程内。

### 暂不做（有前置条件）

| 编号 | 内容 | 原因 |
|---|---|---|
| R-06 | 调课实时推送 | 依赖服务端与账号 |
| R-08 | 服务端、账号登录、多端同步 | 无服务端规划 |
| R-09 | 增量同步与字段级冲突解决 | 与 WebDAV/LAN 整包路线冲突 |
| R-10 | iOS 端 | 平台能力抽象已就绪，投入产出未验证 |
| R-11 | Windows 11 小组件面板 | 需 WinRT/MSIX |
| R-12 | 局域网同步三期（后台常驻/发现增强） | 一期二期已交付，三期需真机验收后再定 |
| — | 社交共享课表、成绩管理、收费内购 | 需求未提及，不立项 |

### 候选（按价值排序，待你拍板）

1. **更多教务模板与浏览器扩展**：在现有 bookmarklet + 内嵌窗口基础上扩充识别模板；导入诊断已就位，便于收集失败样本。
2. **统计增强**：出勤明细、课程/考试趋势、可导出报表（当前只有学期概览卡片）。
3. **提醒增强**：位置提醒、考试倒计时主题、提醒时间段与勿扰日程化。
4. **分享**：只读课表分享链接/文件（当前可导出 PNG/PDF/ICS）。
5. **平台扩展**：iOS（能力抽象已就绪）、PWA 可安装（Q8 目前不做）。
6. **数据安全二期**：备份口令加密的找回策略、快照加密（后台无口令，需设计）。

## 4. 已定决策（Q1–Q33）

| 编号 | 结论 |
|---|---|
| Q1–Q8 | 设备与同步页；导入不占导航；非 Web 端补原生状态；硬删+确认；回退只读；学期边界置灰；不做撤销；文档改「本地优先」 |
| Q9–Q12 | Release 资产与 `.sha256` 已核；`gh secret list` 待你执行；发布产物带 `version.json`；0.2.0 段改 beta |
| Q13–Q19 | 旧库只检测提示；A-16 先量重合度；R-05 不落盘凭据；R-06 只做轮询；ICS 导出勾选模块；社交/成绩/内购不立项；P0 按数据风险排序 |
| Q20–Q26 | A-16 量后关闭；P1/P2 发 0.4.0、A 系列发 0.4.1；冒烟固定时区；Full Changelog 由发布脚本拼；侧列保留；移动端 Sheet；R-02 并入 P1-02 |
| Q27–Q33 | 下一阶段顺序；三端自动更新；局域网一期；动画只做动效；悬浮窗自适应+记忆；渠道警告频率；时区偏移+搜索 |

## 5. 不建议现在做

1. 全局撤销与操作历史——用二次确认 + 快照恢复兜底。
2. 周视图改真 ARIA grid/table——会动绝对定位渲染与拖拽命中。
3. 完整键盘拖拽调课——已有「详情 → 调课」等价路径。
4. 全部 Dialog 改底部 Sheet——只把高频短表单改成 Sheet。
5. PWA / Service Worker 与 Web mini 入口裁剪。
6. 主题间距密度重做、账号与社交体系。
7. Rust `lib.rs` 拆模块；「管理员权限注册开机启动」写 HKLM 需 UAC 链路。
8. `core/sync.ts` 行级同步接线、局域网后台常驻。
9. 学校名录双数据源合并——依赖仓库外生成链。
10. 冒烟拆 `bootstrap` + `cases/*`、i18n 全量 `t()`、状态管理库、卡片注册表插件化。

## 6. 发版与批次记录

| 版本 | 内容 |
|---|---|
| `v0.1.0-beta.1` / `v0.1.0` | 首个公测版与正式版：课表、日程、导入、提醒、备份、WebDAV、悬浮窗与小组件、渠道更新 |
| `v0.2.0-beta.1` | 加载蒙版、动效设置、N 天窗口、通知权限引导、卡片布局对话框、启动自检 |
| `v0.3.0-beta.1` | P0 批次 + 第一批 6 条 |
| `v0.4.0` | P1/P2 产品体验批次 |
| `v0.4.1` | A 系列架构收口 + 两处修复 |
| `v0.5.0` | 体验反馈 15 条（更新/渠道/悬浮窗/时区/导入/局域网一期/动效） |
| `v0.6.0` | R 系列 11 项（导出、提醒动作、更新运营、局域网二期、加密、统计、诊断） |
| `v0.6.1` | 更新下载后台化 + 并发 Range 分片 + 更新 UI 重排；发布校验回退单一 `SHA256SUMS.txt` |
| `v0.6.2` | 设置页与设备页配置卡片各拆为 7 张、手风琴展开；`dev` 推送自动滚动发布 `dev-latest` |
| `v0.6.3` | Windows 更新区分便携版/安装版；局域网同步修复安卓配对卡死、Windows 代理导致失败、多网卡自动选择与切换 |

执行方式：每任务独立 `task/<id>` 分支 + worktree，按批次并行；每任务跑 typecheck + 相关测试，批次末跑全量测试与冒烟；跨任务冲突由 Lead 合并解决。

## 7. 验证与发布命令

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm ui:smoke
cargo check --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
node tools/verify/check-widget-contract.mjs
node tools/verify/verify-all.ps1
node tools/release/version.mjs --check
node tools/release/changelog.mjs --check
# 本地安卓编译（Windows）
cd apps/mobile/android
set JAVA_HOME=C:\Users\<user>\.gradle\jdks\eclipse_adoptium-21-amd64-windows\jdk-21.0.7+6
set ANDROID_HOME=E:\work\dsh\android-sdk
gradlew.bat :app:compileDebugKotlin --no-daemon
# 发版：改版本号 → 切 CHANGELOG 段 → 推 dev 与标签
node tools/release/version.mjs 0.6.1
git tag v0.6.1 && git push origin dev v0.6.1
```
