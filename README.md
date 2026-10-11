# 晓刻 DawnTick

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
| 课表 | 学期与节次、周视图（5/6/7 天，时间轴与当前时间指示线）、今日视图、课程详情、拖拽调课、调课与放假 |
| 导入 | ICS 导入导出、CSV 与 Excel 二维矩阵、内置高校与教务入口、内嵌教务窗口导入、通用网页课表识别（含手动校正映射）、手动添加 |
| 日程 | 考试倒计时、待办分组与勾选、调课与临时日程 |
| 检索 | 课程、教师、地点、周次与日程全文搜索（`/` 唤起） |
| 提醒 | 课前 5/10/15/30 分钟与自定义、放假跳过、贪睡、勿扰分级 |
| 主题 | 四套配色 × 深浅模式（含跟随系统），设计令牌与无障碍自动校验 |
| 数据 | JSON 全量备份导出导入，支持按模块选择与覆盖策略；同步协议 pull → push → pull |
| 组件 | Windows 紧凑条；Android 2×2 下一节课、4×2 今日课表、4×4 一周概览、2×2 考试倒计时 |

## 技术栈

| 层 | 选型 |
|---|---|
| 领域逻辑 | TypeScript，`packages/core` |
| 存储抽象 | `Storage` / `Collection`，各端实现（IndexedDB / SQLite） |
| 界面 | React 19 + Vite 8 + Tailwind CSS v4 + Radix 原语（shadcn 风格组件）+ lucide 图标 |
| 桌面 | Tauri 2（Rust）+ tauri-plugin-sql |
| 移动 | Capacitor + Kotlin 小组件 |
| 测试 | `node --test`（Node 24 原生类型擦除）、内存存储、`node:sqlite` 与 Python 跨引擎校验 |

## 目录

| 路径 | 内容 |
|---|---|
| `packages/core` | 数据模型、存储抽象、展开、提醒、检索、导入导出、页面识别、备份、同步 |
| `apps/web` | 界面与平台存储驱动；`src/design` 设计令牌、`src/components` 组件库、`src/lib` 工具 |
| `apps/desktop` | Tauri 壳、托盘、窗口配置 |
| `apps/mobile` | Capacitor 壳与 Android 小组件 |
| `tools/schema-check` | 建表 SQL 的跨引擎校验 |
| `tools/design` | 设计令牌导出与无障碍校验 |
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
| [发布与版本规范](docs/07-发布与版本规范.md) | 渠道、标签、产物、密钥、仓库设置 |
| [第三方组件与数据](THIRD-PARTY.md) | 依赖与内置数据的来源、许可证 |

开发过程文档（决策登记、数据模型、选型对比、里程碑、配色、环境与验证、阶段记录）保存在本地 `local-notes/docs/`，不随仓库分发。

## 发布渠道

| 渠道 | 来源分支 | 触发 | 标签 | Release |
|---|---|---|---|---|
| dev | `dev` | 手动或每日定时 | `dev-latest` | 预发布，滚动覆盖 |
| beta | `beta` | 手动 | `vX.Y.Z-beta.<n>` | 预发布，保留历史 |
| release | `main` | 打标签 | `vX.Y.Z` | 正式 Release |

产物：`DawnTick-<version>-<channel>-windows-x64-setup.exe`（NSIS 安装包）、`DawnTick-<version>-<channel>-windows-x64-portable.zip`（免安装）、`DawnTick-<version>-<channel>-android.apk`、`DawnTick-<version>-<channel>-web.zip`，每个产物附同名 `.sha256` 文件。

## 本地打包

`powershell -File tools/build-local.ps1` 默认 **dev 渠道 + debug 构建**（`-Channel release` 才出 release），产物在 `out-local/`。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。第三方来源与许可见 [THIRD-PARTY.md](THIRD-PARTY.md)。
