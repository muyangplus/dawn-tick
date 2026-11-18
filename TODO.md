# TODO

> 当前版本 `v0.7.0`（2026-11-17 正式版）。已完成任务的细节不再保留（查 git log 与 CHANGELOG.md）；本文件只留现状、待验收清单、未完成方向、决策与边界。

## 0. 现状快照

- **版本**：`0.7.0`（`versionCode 700`）。正式版 `v0.1.0`、`v0.4.0`、`v0.4.1`、`v0.5.0`、`v0.6.0`–`v0.6.3`、`v0.7.0`；测试版 `v0.2.0-beta.1`、`v0.3.0-beta.1`、`v0.6.4-beta.1`、`v0.6.5`–`v0.6.12`（纯版本号 + `[prerelease]`）。`dev` 分支推送自动滚动发布 `dev-latest`。
- **验证**：`pnpm test`（core 314 / web 658 / core-sqlite 314 / tools 65）、`pnpm ui:smoke`（489 项，固定 `Asia/Shanghai` 与时钟）、`cargo test`（112 + 6）、`tools/verify/verify-all.ps1`、小组件契约检查；Windows 专属 Rust 代码可在 Linux 上 `cargo check --target x86_64-pc-windows-gnu` 交叉检查。
- **CI**：`node`（typecheck / test / 冒烟 / a11y / 小组件契约 / CHANGELOG）、`schema`（迁移回放 + 工作流断言）、`rust`（含 Windows 上的许可证清单校验）、`android`（编译校验；失败时把 gradle 日志推到 `ci-debug` 分支）。
- **本地安卓编译**（无需 CI 往返）：`JAVA_HOME=C:\Users\<user>\.gradle\jdks\eclipse_adoptium-21-amd64-windows\jdk-21.0.7+6`、`ANDROID_HOME=E:\work\dsh\android-sdk`，在 `apps/mobile/android` 跑 `gradlew.bat :app:compileDebugKotlin --no-daemon`。
- **结构**：core 写入按领域拆在 `mutations/`，学期快照 `loadSemesterSnapshot` + `expandInputOf` 一次读齐；设置为描述表；网页表格识别共用 `import/html-grid.ts`。web 的 `data.ts`、`schedule-cards.tsx` 为汇总导出；大表单的状态与回填/重置逻辑在旁边的纯模块里测试。Rust 按存储、备份、日志、实例、托盘、自启、提权、窗口几何、教务窗口拆模块，`lib.rs` 只留命令注册与迁移。冒烟的种子与桩在 `smoke/kit.tsx`。
- **运维工具**：`tools/repair/repair-db.mjs --dir=<数据目录> [--dry-run] [--stage=<快照>]` 检查/恢复损坏数据库；正常启动也会自检并从最新健康快照恢复。
- **单点**：文案 `copy/zh.ts`；节次范围 `lib/format.ts`；节次上限 `MAX_PERIODS`（40，core `timetable.ts`）；课程色 `core/colors.ts`；原生桥 `lib/native.ts`（命令与 Rust 一一对应）；插件契约 `lib/plugins.ts` + `apps/mobile/docs/plugins.contract.md`；`app_meta` 助手 `lib/meta.ts` + 键清单 `lib/meta-keys.ts`；局域网协议 `apps/mobile/docs/lan-sync.contract.md`。

## 1. 已交付（均已通过 CI）

| 批次 | 内容 | 版本 |
|---|---|---|
| P0（8 条） | 删除入口与确认框、详情关闭出口、设置页快捷动作与单一导入入口、备份键清单、整包打包共用、`weeks_raw` 派生 | 0.3.0-beta.1 |
| P1（13 条） | 设备与同步页、统一「＋」菜单、搜索直达、调课合并、待重启条、通知六态、回退只读、错误页、空态三态、键盘可达、版本号兜底等 | 0.3.0-beta.1 / 0.4.0 |
| P2（17 条） | 表单语义、导入冲突筛选与手动映射、引导页统一、校验与忙碌态、侧列布局、移动端 Sheet、悬浮窗与小组件文案、命名与文风统一等 | 0.3.0-beta.1 / 0.4.0 |
| A 系列（18 条） | 时间/颜色/文案单源、重叠与钟点纯函数、原生桥收口、大文件拆分、组件基元、快照索引、CI 冒烟与安卓编译、视图过渡等（A-16 按重合度关闭） | 0.4.1 |
| 体验反馈（15 条） | 更新判定与 Markdown 弹窗、三端自动更新、渠道警告、悬浮窗自适应与拉伸、时区偏移与搜索、默认周视图、课表滚动与拖动、调课改考试、导出路径、导入重构、局域网同步一期、统一动效 | 0.5.0 |
| R 系列（11 条） | ICS 导出、考试倒计时悬浮窗、主题联动悬浮窗与小组件、提醒动作、更新运营（忽略/回滚）、局域网二期（发现/二维码/预览/自动同步）、备份导出加密、课表图片与 PDF、学期统计、WebDAV 凭据加密、导入诊断 | 0.6.0 |
| 分发与稳定性 | 国内下载源（Gitee / assets 仓库、`version.json` v2）、安卓 ABI 拆包与瘦身、扫一扫、帮助模块、更新弹窗精简、全局 busy 看门狗与原生超时、局域网 deviceId 与离线退避 | 0.6.5–0.6.12 / 0.7.0 |
| 审计重构 | 提醒投递与对账、备份导入校验与合并、ICS / 网页表格解析、级联删除、夏令时、设置校验；导出与更新包路径收口、CSP、局域网防重绑定、教务窗口校验值；发布同一构建提交、dev-latest 原地更新；core / web / Rust / 冒烟按职责拆分，测试按目录重组 | 0.7.0 |

## 2. 待验收（需要真机 / 实机证据）

- **Windows 桌面**：悬浮窗按内容自适应与拉伸记忆、双击唤主窗口、托盘「提醒」菜单动作、自动更新下载→启动安装（0.7.0 起更新包写私有暂存目录并复核 SHA-256）、导出改为原生「另存为」后的备份/课表/日志导出与「打开所在位置」、教务导入窗口带校验值交回、DPAPI 凭据加密后的 WebDAV 同步、启用 CSP 后各页面无白屏。
- **Android 真机**：通知动作（贪睡/完成/勿扰）、提醒一次排完前瞻窗口并与系统已排通知对账（删课/改时后不再按旧时刻弹）、开机与杀进程后的提醒投递、APK 自动更新与系统安装器、导出分享、Keystore 凭据加密、小组件主题配色与「还有 N 节」、beta/release 包确认 WebView 远程调试已关。
- **双设备**：局域网同步配对、UDP 自动发现、deviceId 认回、预览后合并（两边当前学期不同时的选择弹窗）、30 分钟自动同步；防火墙放行；同步包不再带本机专属设置。
- **发布链路**：`v0.7.0` Release 产物、`SHA256SUMS.txt`、`version.json` v2 与 assets 仓库同步；自动更新能从 0.6.12 测试版与 0.6.3 正式版升到 0.7.0；`dev-latest` 原地更新时客户端始终能下到完整一版。

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

### 排期

**统计口径（硬约束，所有里程碑适用）**

- 不做出勤：不记录、不估算、不展示、不导出任何出勤信息，没有打卡、签到、缺勤或「出勤率」字段。
- 停课的课次默认计入「已上课时」，不单列停课数，也不进「待上」；日期没到的停课登记后同样计入已上。这是课时口径，不是出勤，不提供逐节改回的开关。
- 统计、报表、分享文件、小组件都按这一口径算。测试断言统计结果和导出内容里不出现出勤字段。

**v0.8.0（开发中，2026-11-18 起）**

| 项 | 内容 | 验收 |
|---|---|---|
| 口径修正 | 删掉学期概览的「出勤估算」与相关文案；停课计入已上课时 | `semester-stats.test.ts` 停课用例改写；冒烟断言无出勤 |
| 统计增强 | 每周课时（已上 / 待上）、各课程课时进度、考试时间线；学期报表导出 CSV（只有课时与考试） | 统计纯模块测试；报表内容测试断言无出勤字段 |
| 勿扰时段 | 按星期设置的勿扰时段（可跨午夜），时段内的提醒顺延到结束或跳过；三端调度共用 core 判定 | core 测试覆盖跨午夜、夏令时与 CI 时区 |
| 只读分享文件 | 导出只含学期、节次、课程与排课的分享文件；导入为新学期，走 `importBackup` | 格式写进 `docs/02`；导入 FK 与学期冲突测试 |

**v0.8 之后（未排期）**：教务模板扩充（等导入诊断样本）、浏览器扩展、考试倒计时主题、分享链接、位置提醒。

**决策点（开工前需要你定）**

- **分享链接**：目前没有公开部署的 Web 版，链接需要一个可访问的地址（如 GitHub Pages）承载只读页面，数据放在 URL `#` 片段里不经服务器。不部署就只做文件。做之前定。
- **位置提醒**：需要后台定位权限（`ACCESS_BACKGROUND_LOCATION`）、地理围栏与耗电评估，桌面和 Web 不做。做之前定是否继续，试点只进 dev 渠道。
- **平台扩展**（iOS、PWA）与**数据安全二期**（备份口令找回、快照加密）不进本轮排期。

**节奏**：每个版本在发布前一周从 main 打纯版本号 + `[prerelease]` 测试版，真机验收后转正式版。

## 4. 已定决策

| 编号 | 结论 |
|---|---|
| Q1–Q8 | 设备与同步页；导入不占导航；非 Web 端补原生状态；硬删+确认；回退只读；学期边界置灰；不做撤销；文档改「本地优先」 |
| Q9–Q12 | Release 资产与 `.sha256` 已核；`gh secret list` 待你执行；发布产物带 `version.json`；0.2.0 段改 beta |
| Q13–Q19 | 旧库只检测提示；A-16 先量重合度；R-05 不落盘凭据；R-06 只做轮询；ICS 导出勾选模块；社交/成绩/内购不立项；P0 按数据风险排序 |
| Q20–Q26 | A-16 量后关闭；P1/P2 发 0.4.0、A 系列发 0.4.1；冒烟固定时区；Full Changelog 由发布脚本拼；侧列保留；移动端 Sheet；R-02 并入 P1-02 |
| Q27–Q33 | 下一阶段顺序；三端自动更新；局域网一期；动画只做动效；悬浮窗自适应+记忆；渠道警告频率；时区偏移+搜索 |
| 0.7.0 审计 | 本机专属设置（WAL、开机自启、启动隐藏、WebDAV 账号）不随备份与同步走；导入时两边当前学期不同由用户在弹窗里选；本轮不做更新包签名；beta 标签方案维持现状；允许破坏性调整（迁移 006、调课动作只留 move / cancel） |
| 2026-11 排期 | 不做任何出勤信息；停课默认计入已上课时；统计、报表、分享按同一口径；平台扩展与数据安全二期不进本轮 |

## 5. 不建议现在做

1. 全局撤销与操作历史——用二次确认 + 快照恢复兜底。
2. 周视图改真 ARIA grid/table——会动绝对定位渲染与拖拽命中。
3. 完整键盘拖拽调课——已有「详情 → 调课」等价路径。
4. 全部 Dialog 改底部 Sheet——只把高频短表单改成 Sheet。
5. PWA / Service Worker 与 Web mini 入口裁剪。
6. 主题间距密度重做、账号与社交体系。
7. 「管理员权限注册开机启动」写 HKLM——需 UAC 链路。
8. 行级同步（跨设备一律走整包导入）、局域网后台常驻。
9. 学校名录双数据源合并——依赖仓库外生成链。
10. 便携版数据目录 ACL/WebView2 写权限问题——现阶段靠提权与「已有实例」提示兜底。
11. i18n 全量 `t()`、状态管理库、卡片注册表插件化。
12. 更新包 Ed25519 签名——目前靠 HTTPS + `SHA256SUMS.txt` + 安装前复核；要做需先定密钥保管与轮换。

### 可做的整理（不影响行为）

- Rust 测试从 `lib.rs` 挪进各自模块。
- 冒烟按场景拆成互相独立的用例（现在共用一次启动的状态，只抽了 `smoke/kit.tsx`）。
- 工作流里的 action 固定到提交号；CI 失败日志改存构建产物，替代推 `ci-debug` 分支。

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
| `v0.6.4-beta.1` | 设置页与设备页改为分组导航 + 下钻；关于页新增「近期更新」（内置 CHANGELOG）；beta 标签允许不带序号（发布时指定，默认 1） |
| `v0.6.5`–`v0.6.8`（测试版） | 安卓原生诊断日志、小组件读取失败提示；国内下载源（Gitee、assets 仓库）、`version.json` v2、按渠道探测下载源 |
| `v0.6.9`–`v0.6.12`（测试版） | beta 渠道可升到更高正式版；扫一扫、局域网网络切换与 `/ping` 预检；帮助模块、更新弹窗精简；全局 busy 看门狗与原生调用超时、安卓局域网地址兜底 |
| `v0.7.0` | 审计重构：提醒、导入、备份合并、ICS、级联删除、夏令时等数据正确性修复；安全收口；发布链路同一提交与原地更新；局域网 deviceId、安卓 ABI 拆包；各端代码按职责拆分 |


## 7. 验证与发布命令

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm ui:smoke
cargo check --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
node tools/verify/check-widget-contract.mjs
pwsh tools/verify/verify-all.ps1
node tools/release/version.mjs --check
node tools/release/changelog.mjs --check
# 本地安卓编译（Windows）
cd apps/mobile/android
set JAVA_HOME=C:\Users\<user>\.gradle\jdks\eclipse_adoptium-21-amd64-windows\jdk-21.0.7+6
set ANDROID_HOME=E:\work\dsh\android-sdk
gradlew.bat :app:compileDebugKotlin --no-daemon
# 数据库修复（只读预演 / 从快照恢复 / 下次启动恢复）
node tools/repair/repair-db.mjs --dir=out-local --dry-run
node tools/repair/repair-db.mjs --dir=out-local
node tools/repair/repair-db.mjs --dir=out-local --stage=dawn-tick-20261025-204530.db
# 发版：改版本号 → 切 CHANGELOG 段 → 推 dev → PR 合入 main → 在 main 上打标签
node tools/release/version.mjs 0.7.0
git push origin dev            # 然后开 dev → main 的 PR 并合并
git fetch origin main && git tag v0.7.0 origin/main && git push origin v0.7.0
# 测试版：纯版本号标签 + 说明带 [prerelease]
git tag -a v0.7.1 -m "[prerelease] 0.7.1 测试版" origin/main && git push origin v0.7.1
```
