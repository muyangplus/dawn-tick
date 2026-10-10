# 晓刻 Dawn Tick

课表与日程提醒工具：课表导入一次、多端同步、课前准时提醒、桌面与主屏小组件随时看。

## 平台与产物

| 平台 | 形态 | 本地存储 | 工程目录 | 产物 |
|---|---|---|---|---|
| Web | 浏览器应用 | IndexedDB | `apps/web` | `apps/web/dist` |
| Windows | Tauri 2 桌面应用（紧凑条 + 托盘） | SQLite | `apps/desktop` | NSIS 安装包 |
| Android | Capacitor 应用（2×2 与 4×2 主屏小组件） | SQLite | `apps/mobile` | APK |

## 功能

| 模块 | 内容 |
|---|---|
| 课表 | 学期与节次、周视图（5/6/7 天）、今日视图、课程详情、调课与放假 |
| 导入 | ICS 导入导出、CSV 与 Excel 二维矩阵、教务适配接口位 |
| 提醒 | 课前 5/10/15/30 分钟与自定义、放假跳过、贪睡、勿扰分级 |
| 主题 | 四套配色 × 深浅模式（含跟随系统） |
| 数据 | JSON 全量备份导出导入；同步协议 pull → push → pull |
| 组件 | Windows 紧凑条、Android 2×2「下一节课」与 4×2「今日课表」 |

## 技术栈

| 层 | 选型 |
|---|---|
| 领域逻辑 | TypeScript，`packages/core` |
| 存储抽象 | `Storage` / `Collection`，各端实现（IndexedDB / SQLite） |
| 界面 | React 19 + Vite 8 |
| 桌面 | Tauri 2（Rust）+ tauri-plugin-sql |
| 移动 | Capacitor + Kotlin 小组件 |
| 测试 | `node --test`（Node 24 原生类型擦除）、内存存储、`node:sqlite` 与 Python 跨引擎校验 |

## 目录

| 路径 | 内容 |
|---|---|
| `packages/core` | 数据模型、存储抽象、展开、提醒、导入导出、备份、同步 |
| `apps/web` | 三端共用界面、平台探测与存储驱动、紧凑条入口 |
| `apps/desktop` | Tauri 壳、托盘、窗口配置 |
| `apps/mobile` | Capacitor 壳与 Android 小组件 |
| `tools/schema-check` | 建表 SQL 的跨引擎校验 |
| `tools/release` | 版本号同步与发布规则 |
| `tools/setup` | 镜像、Rust、Android SDK、JDK、图标、密钥脚本 |
| `tools/verify` | 一键验证脚本 |
| `docs` | 规范与记录 |

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm test` | 全部单元测试 |
| `pnpm typecheck` | 全部类型检查 |
| `pnpm -C apps/web dev` | 启动 Web 开发服务器 |
| `pnpm -C apps/web build` | 构建 Web |
| `pnpm -C apps/desktop exec tauri build` | 构建 Windows 安装包 |
| `pnpm version:set 0.2.0` | 同步五处版本号 |
| `pnpm version:check` | 校验版本号一致 |
| `powershell -File tools/verify/verify-all.ps1` | 三端产物与测试总校验 |

## 文档

| 文档 | 内容 |
|---|---|
| [00 项目说明与已确认决策](docs/00-项目说明与已确认决策.md) | 范围、决策登记 |
| [01 数据模型设计](docs/01-数据模型设计.md) | 表结构、约束、展开规格 |
| [02 技术选型对比](docs/02-技术选型对比.md) | 候选方案事实对比 |
| [03 开源组件调研](docs/03-开源组件调研.md) | 组件事实与许可证 |
| [04 里程碑与范围](docs/04-里程碑与范围.md) | 里程碑、验收判据、不做清单 |
| [05 待定事项](docs/05-待定事项.md) | 未定事项 |
| [06 配色方案](docs/06-配色方案.md) | 四套主题色值 |
| [07 发布与版本规范](docs/07-发布与版本规范.md) | 渠道、标签、产物、密钥、仓库设置 |
| [08 开发环境与验证](docs/08-开发环境与验证.md) | 工具链、镜像、脚本、验证、环境坑 |
| [records](docs/records) | 各阶段校验与修复记录 |

## 发布渠道

| 渠道 | 来源分支 | 触发 | 标签 | Release |
|---|---|---|---|---|
| dev | `dev` | 手动或每日定时 | `dev-latest` | 预发布，滚动覆盖 |
| beta | `beta` | 手动 | `vX.Y.Z-beta.<n>` | 预发布，保留历史 |
| release | `main` | 打标签 | `vX.Y.Z` | 正式 Release |

产物：Windows NSIS 安装包、Android APK、Web 静态包、`SHA256SUMS.txt`。
