# 晓刻 DawnTick

课表与日程提醒工具。功能范围：课表导入与导出、多端数据同步、课前提醒、桌面与主屏小组件。

## 平台与产物

| 平台 | 形态 | 本地存储 | 工程目录 | 产物 |
|---|---|---|---|---|
| Web | 浏览器应用 | IndexedDB | `apps/web` | `apps/web/dist` |
| Windows | Tauri 2 桌面应用（紧凑条 + 托盘） | SQLite | `apps/desktop` | NSIS 安装包 |
| Android | Capacitor 应用（2×2 与 4×2 主屏小组件） | SQLite | `apps/mobile` | APK |

## 功能

| 模块 | 内容 |
|---|---|
| 课表 | 学期与节次、周视图（1–7 天任意天数，窄屏按列宽压缩、不横向滚动，节次轴始终显示起止时间）、时间轴与当前时间指示线、今日视图、课程详情、拖拽调课、调课与放假、停课与调课标记（原位置「已调课」、落点「调课」）、实验条目按周次落格并标「实验」、自定义时间的条目按真实起止时间定位 |
| 导入 | ICS 导入导出、CSV 与 Excel 二维矩阵、内置高校与教务入口、内嵌教务窗口导入（Windows 独立窗口、Android 应用内 WebView）、通用网页课表识别（含手动校正映射）、手动添加；入口在设置页内（不再单独占导航） |
| 日程 | 一个入口「加待办」，类型可选日程 / 作业 / 考试 / 实验；逐条「开启倒计时」「需要手动确认完成」「自定义时间」「显示在课表上」开关（作业与考试默认开倒计时、作业默认需要手动确认完成、实验默认占课表）；待办排序可选按开始时间或按类型；倒计时卡片与时间线的条目都能单击进详情编辑（已完成的也一样），倒计时条目还能直接勾完成；考试倒计时、待办分组与勾选、调课与临时日程；正在上的课带「进行中」与剩余时间 |
| 导航 | 课表 / 日程 / 设置 / 我的；导入已并入设置页，「我的」为建设中占位 |
| 课程管理 | 课程与排课的新增、编辑、删除；「复制课程」可选只复制课程信息或连排课一起复制；排课同样支持自定义时间 |
| 检索 | 课程、教师、地点、周次与日程全文搜索（`/` 唤起） |
| 提醒 | 课前 5/10/15/30 分钟与自定义、放假跳过、贪睡、勿扰分级 |
| 主题 | 四套配色 × 深浅模式（含跟随系统），设计令牌与对比度校验；小组件背景（浅色/深色/透明）同时作用于悬浮窗与 Android 小组件；时区为选择列表（默认上海，首次启动按系统时区对齐一次），待办排序可选 |
| 渠道 | dev 构建有「开发者特性」开关（默认关，与正式版表现一致；打开后才记 debug 日志、启用右键菜单与日志控制台，更新仍随 dev）；首次进入按渠道提示（开发版可能频繁更新、测试版可能不稳定），每条提示只弹一次、新增提示对老用户也会弹；发现新版本时弹窗显示版本、渠道与发布说明 |
| 数据 | JSON 与 Base64 两种备份格式，导出时选择保存位置、默认文件名全为英文；「导入配置」一个入口既可选文件也可粘贴文本；同步协议 pull → push → pull |
| 组件 | Windows 悬浮窗（四种样式，上课中显示剩余时间；当天没课或课都上完时，按「空日程提示明日预告」显示明日课程预告）；Android 桌面小组件 2×2 下一节课、4×2 今日课表、4×4 一周概览、2×2 考试倒计时，设置页给出添加引导并可一键请求添加到桌面 |

## 预设仓库（作息与教务配置）

作息表、教务系统与页面解析器由独立仓库
[`muyangplus/dawn-tick-presets`](https://github.com/muyangplus/dawn-tick-presets) 维护。
主仓库保存一份内置快照，作为离线来源在打包期内联进三端产物。

内容范围：

- 学校作息时间：上下课时间表，路径 `presets/schools/<校>/school.json`（逐节起止时间）。
- 教务系统配置与识别特征：登录入口、页面标记、课表表格 id / class、网格单元格 id 正则，路径 `presets/systems/<系统>/system.json`。
- 页面解析器与夹具：`parse.js` 把教务页面解析成课程事件；同目录 `fixtures/` 携带页面样本与期望事件。
- 某校的覆盖配置：只改本校差异（作息、识别特征、入口）的覆盖文件；解析器优先级为学校级 `parse.js` ＞ 系统级 `parse.js`。

应用侧的消费路径：

1. 内置快照：无网、快照损坏或校验不符时使用内置预设。
2. 在线更新：设置页「检查预设更新」→ 语义化版本比较 → 下载对应版本快照 → 规范化 sha256 校验 → 写入本地缓存；任一步失败则回退内置。下载成功后提示「下次启动生效」，运行时不替换当前预设。
3. 设置页「关于」区块展示预设版本（内置 / 已更新）与「检查预设更新」按钮。

提交方式：

- Issue 表单：[`request-school.yml`](https://github.com/muyangplus/dawn-tick-presets/issues/new?template=request-school.yml) 请求适配或提交学校信息；[`report-adapter-broken.yml`](https://github.com/muyangplus/dawn-tick-presets/issues/new?template=report-adapter-broken.yml) 报告适配失效（附页面样本与现象）。
- PR 要求：`parse.js` 与 `fixtures/` 同时提交（≥1 页面样本 + ≥1 期望事件），沙箱产出与期望逐条一致，否则 `validate.mjs` 失败。

维护流程：

- 预设仓库内容修改后执行 `node scripts/validate.mjs`（校验 + 静态安全扫描 + 沙箱冒烟），再执行 `node scripts/snapshot.mjs` 重新生成快照并提交；快照是唯一分发产物，禁止手改。
- 主仓库侧用 `node tools/presets/sync-snapshot.mjs --from <预设仓库>` 同步内置快照；该脚本幂等：内容一致时不触碰文件。

解析器在受限环境中执行，输出限事件数据；应用端消费的数据限于 JSON（快照清单、索引、作息与系统配置），不执行第三方 JS。

## 更新与预设的取源

| 检查项 | 首选来源 | 回退来源 |
|---|---|---|
| 应用更新 | `api.github.com` 的发布接口（按渠道取 `dev-latest` / `beta-latest` / 最新正式版），版本取自标签或发布资产名，说明取自发布正文 | 发布内的 `version.json` |
| 预设版本与快照 | `raw.githubusercontent.com` 的 preset 仓库文件 | `api.github.com` 的 contents 接口（正文以 base64 返回） |

两条链路都只访问 GitHub 官方域名，不使用任何第三方镜像或代理。应用内只检查版本与说明，下载与安装到发布页完成。

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
| `tools/legal` | 第三方许可证清单生成与校验 |
| `tools/verify` | 验证脚本 |
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
| `node tools/legal/collect-licenses.mjs --check` | 校验第三方许可证清单与依赖一致 |
| `powershell -File tools/verify/verify-all.ps1` | 三端产物与测试总校验 |

## 文档

| 文档 | 内容 |
|---|---|
| [发布与版本规范](docs/07-发布与版本规范.md) | 渠道、标签、产物、密钥、仓库设置 |

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

运行日志：写入应用数据目录（安装版 `%APPDATA%\com.dawntick.app`，便携版在程序所在目录；该目录不可写时依次回退 `%LOCALAPPDATA%\com.dawntick.app`、`%TEMP%\DawnTick`），同时输出到启动它的控制台（提权启动时附加父控制台，附加不到则另开一个日志控制台）。数据目录里只有数据库与日志；窗口几何存在数据库的 `app_meta.window_geometry`，WebView2 的用户数据目录固定在 `%LOCALAPPDATA%\com.dawntick.app\EBWebView`（首次运行会把旧的 `<数据目录>\EBWebView` 搬过去）。日志行为 `YYYY-MM-DD HH:MM:SS.mmm ±HH:MM [level] scope: 消息`，文件、控制台与导出文件同一格式；设置页「数据」提供「打开数据目录」「打开日志文件所在目录」，并可填自定义存储位置、「启用 WAL 日志模式」与自动备份设置。

数据库快照：Windows 用 `VACUUM INTO` 在数据目录 `backups/` 写整库文件，Web 与 Android 存库内 JSON 快照；默认自动备份（启动时与每天各一次，保留最近 10 份，份数可改 1–100），也可手动备份；设置页可查看、恢复与删除快照，恢复文件快照后重启生效。跨设备迁移用「导出配置 / 导入配置」：JSON 文件、Base64 文本或整包 zip。

WebDAV 同步：把整库快照与设置预设打包传到远端目录，可手动上传/下载，也可开启自动同步（启动时与每天各一次，远端更新时提示下载）；地址、用户名与密码存在本机设置里（密码不进导出）。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。运行时依赖的清单与许可证全文见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)：由 `node tools/legal/collect-licenses.mjs` 从各端清单与已安装依赖的元数据生成，`--check` 可校验两者一致；应用内「关于」也展示同一份清单。
