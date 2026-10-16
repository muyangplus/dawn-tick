# 晓刻 DawnTick

课表与日程提醒工具。课表导入一次，多端同步，课前准时提醒，桌面与主屏小组件随时看。

## 平台与产物

| 平台 | 形态 | 本地存储 | 工程目录 | 产物 |
|---|---|---|---|---|
| Web | 浏览器应用 | IndexedDB | `apps/web` | `apps/web/dist` |
| Windows | Tauri 2 桌面应用（悬浮窗 + 托盘） | SQLite | `apps/desktop` | NSIS 安装包、免安装 zip |
| Android | Capacitor 应用（主屏小组件 2×2 / 4×2 / 4×4） | SQLite | `apps/mobile` | APK |

## 功能

| 模块 | 内容 |
|---|---|
| 课表 | 学期与节次、周视图（1–7 天，窄屏不横向滚动）、时间轴与当前时间指示线、今日视图、拖拽调课、放假与停课、实验条目、自定义时间 |
| 日程 | 加待办（日程 / 作业 / 考试 / 实验）、逐条倒计时与手动完成、待办排序、考试倒计时、条目可显示在课表上 |
| 导入 | ICS 导入导出、CSV 与 Excel 矩阵、内置高校与教务入口、内嵌教务窗口、网页课表识别、手动添加 |
| 提醒 | 课前 5/10/15/30 分钟与自定义、放假跳过、贪睡、勿扰分级、安卓通知与精确闹钟授权 |
| 数据 | 存储位置可配、数据库日志模式开关、诊断日志、自动备份与快照恢复、导出导入、WebDAV 同步 |
| 组件 | Windows 悬浮窗四种样式（含无课时的明日预告）、Android 四个主屏小组件 |
| 更新 | 按渠道检查版本、预设仓库更新、发现新版本时弹窗 |

各模块的完整行为见 [产品与功能](docs/01-产品与功能.md)。

## 快速开始

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm -C apps/web dev` | 启动 Web 开发服务器 |
| `pnpm test` | 全部单元测试 |
| `pnpm typecheck` | 全部类型检查 |
| `powershell -File tools/verify/verify-all.ps1` | 全部校验（测试、类型、产物、冒烟） |
| `powershell -File tools/build-local.ps1` | 本地打包（默认 dev 渠道 + debug 构建，产物在 `out-local/`） |

环境要求与各端构建命令见 [平台与构建](docs/03-平台与构建.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/core` | 数据模型、存储抽象、周次展开、提醒、检索、导入导出、页面识别、备份、同步 |
| `apps/web` | 界面与平台存储驱动（`src/components` 组件库、`src/design` 设计令牌） |
| `apps/desktop` | Tauri 壳、托盘、窗口配置 |
| `apps/mobile` | Capacitor 壳与 Android 小组件 |
| `tools` | 校验、发布、设计令牌、许可证、预设同步脚本 |
| `docs` | 公开文档 |

## 文档

| 文档 | 内容 |
|---|---|
| [产品与功能](docs/01-产品与功能.md) | 平台与产物、功能清单、范围边界、术语 |
| [数据与存储](docs/02-数据与存储.md) | 数据表、时间口径、三端存储、迁移、备份与恢复、导出导入、WebDAV |
| [平台与构建](docs/03-平台与构建.md) | 环境要求、目录结构、各端构建、渠道与产物命名 |
| [界面与文案规范](docs/04-界面与文案规范.md) | 设计令牌、配色、断点、动效、文案规范 |
| [验证与质量](docs/05-验证与质量.md) | 校验入口、逐项检查、测试与冒烟、提交前清单 |
| [发布与版本](docs/06-发布与版本.md) | 渠道、标签、升版判定、Release 正文、密钥与仓库设置 |
| [变更日志](CHANGELOG.md) | 每个版本的「新增 / 变更 / 修复」，发布说明的来源 |
| [贡献指南](CONTRIBUTING.md) / [安全策略](SECURITY.md) | 提交与分支规则 / 漏洞反馈方式 |
| [第三方许可证](THIRD-PARTY-LICENSES.md) | 运行时依赖清单与许可证全文 |

## 预设仓库

作息表、教务系统与页面解析器由独立仓库 [`muyangplus/dawn-tick-presets`](https://github.com/muyangplus/dawn-tick-presets) 维护；主仓库保存一份内置快照，打包期内联进三端产物。

| 项 | 内容 |
|---|---|
| 内容 | 学校作息（`presets/schools/<校>/school.json`）、教务系统配置（`presets/systems/<系统>/system.json`）、页面解析器与夹具 |
| 更新 | 设置页「检查预设更新」→ 版本比较 → 下载快照 → sha256 校验 → 写本地缓存，失败回退内置；下载成功后提示「下次启动生效」 |
| 提交 | Issue 表单请求适配或报告失效；PR 需同时提交 `parse.js` 与 `fixtures/`，通过 `node scripts/validate.mjs` 与 `node scripts/snapshot.mjs` |
| 同步 | 主仓库用 `node tools/presets/sync-snapshot.mjs --from <预设仓库>` 同步内置快照 |

应用与预设的取源见 [产品与功能](docs/01-产品与功能.md)；同步脚本用法见 [tools/presets/README.md](tools/presets/README.md)。

## 发布渠道

| 渠道 | 来源分支 | 触发 | 标签 | Release |
|---|---|---|---|---|
| dev | `dev` | 手动或每日定时 | `dev-latest` | 预发布，滚动覆盖 |
| beta | `main` | 手动 | `vX.Y.Z-beta.<n>` | 预发布，保留历史 |
| release | `main` | 打标签 | `vX.Y.Z` | 正式 Release |

产物名为 `DawnTick-<version>-<channel>-<平台>`，每个产物附同名 `.sha256` 文件；完整规则见 [发布与版本](docs/06-发布与版本.md)。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。
