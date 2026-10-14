# 参与开发

## 1. 环境

| 项 | 版本 |
|---|---|
| Node | 24 及以上 |
| pnpm | 12 |
| Python | 3.12 及以上（`pyyaml`、`pynacl`） |
| Rust | stable（Windows 需 MSVC 工具链） |
| JDK | 21（Android 构建） |
| Android SDK | `platforms;android-35`、`build-tools;35.0.0`、`platform-tools` |

一键准备脚本见 `tools/setup/`，环境变量见 [docs/08](docs/08-开发环境与验证.md)。

## 2. 日常命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm -C apps/web dev --host 127.0.0.1` | Web 开发服务器 |
| `pnpm test` | 全部单元测试 |
| `pnpm typecheck` | 全部类型检查 |
| `pnpm ui:smoke` | 界面冒烟（jsdom 渲染与切页） |
| `powershell -File tools/verify/verify-all.ps1` | 一键验证，任一失败即退出码 1 |
| `pnpm -C apps/desktop exec tauri build` | Windows 打包 |
| `sh ./gradlew assembleDebug`（在 `apps/mobile/android`） | Android 打包 |

打包产物只留在本地；推送与发版由维护者显式触发。

## 3. 结构

| 目录 | 内容 |
|---|---|
| `packages/core` | 数据模型、存储抽象、展开、提醒、导入导出、检索、备份、同步 |
| `apps/web` | 三端共用界面与平台存储驱动 |
| `apps/desktop` | Tauri 壳、托盘、窗口与原生日志 |
| `apps/mobile` | Capacitor 壳与 Android 小组件 |
| `tools/` | 校验、发布、设计令牌、环境准备脚本 |
| `docs/` | 规范、决策登记与记录 |

平台差异统一走 `apps/web/src/platform-detect.ts`，不要在界面里散落判断。

## 4. 时间语义

| 类型 | 存储 |
|---|---|
| 时刻 | INTEGER，UTC 毫秒 |
| 日期 | TEXT，`YYYY-MM-DD` |
| 上课时刻 | TEXT，`HH:MM`，配合 `semesters.time_zone` |
| 周次集合 | INTEGER 位图，第 N 周对应第 N-1 位 |

显示默认 `Asia/Shanghai`。涉及时间的改动必须在 `packages/core/test/` 增加样例。

## 5. 提交

| 项 | 约定 |
|---|---|
| 格式 | `type(scope): 短句`，type 取 feat / fix / chore / docs / refactor / test |
| 语言 | 中文短句，禁止声明式或解释式描述 |
| 范围 | 一次提交只做一件事；不同关注点分开提交 |
| 推送 | 默认只在本地提交，推送与发版由维护者指示 |

提交前必须通过 `pnpm test`、`pnpm typecheck` 与 `tools/verify/verify-all.ps1`。

## 6. 分支与渠道

| 分支 | 渠道 | 标签 |
|---|---|---|
| `dev` | 开发版 | `dev-latest`（滚动） |
| `beta` | 公测版 | `vX.Y.Z-beta.<n>` |
| `main` | 正式版 | `vX.Y.Z` |

版本号以根 `package.json` 为唯一来源，由 `tools/release/version.mjs` 同步到各端。渠道差异见 [docs/07](docs/07-发布与版本规范.md)。

## 7. 功能可见性

按渠道隐藏的功能登记在 `apps/web/src/channel.ts` 的 `FEATURES`，构建时由 `DT_CHANNEL` 注入；新增或调整后需同步更新该表与冒烟测试。

## 8. 文档

| 文件 | 内容 |
|---|---|
| `docs/00-项目说明与已确认决策.md` | 决策登记（D 编号） |
| `docs/01-需求说明.md` | 需求 |
| `docs/02-功能清单.md` | 功能与优先级 |
| `docs/03-开源组件调研.md` | 依赖选型 |
| `docs/04-里程碑与范围.md` | 里程碑 |
| `docs/05-待定事项.md` | 未决问题 |
| `docs/06-配色方案.md` | 配色与无障碍约束 |
| `docs/07-发布与版本规范.md` | 渠道、标签、产物 |
| `docs/08-开发环境与验证.md` | 环境、命令、环境坑 |
| `docs/records/` | 阶段性记录 |

界面文案与文档禁止声明式、解释式表述；注释写给其他开发者，不解释给机器。

## 9. 提交前检查

| 项 | 要求 |
|---|---|
| 测试 | 新增行为有对应测试，`pnpm test` 全绿 |
| 类型 | `pnpm typecheck` 无错误 |
| 无障碍 | 正文对比度 ≥ 4.5:1，触控目标 ≥ 44px，`tools/design/check-a11y.mjs` 通过 |
| 数据模型 | 改表结构需同时改 `001_init.sql`、`tools/schema-check` 与迁移版本 |
| 文档 | 决策变更写入 `docs/00`，环境变化写入 `docs/08` |
