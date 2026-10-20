# TODO

## 0. 项目事实与证据索引

**核心页面与入口**
- 无 URL 路由：视图由 `view` 状态机切换（`timetable/schedule/settings/mine`，`apps/web/src/App.tsx:237`），条件渲染 `App.tsx:936-1004`；导航为桌面侧栏 `components/nav.tsx:14-19/23-67`、移动底栏 `nav.tsx:69-97`；第四项「我的」仍是占位（`App.tsx:998-1003`）。
- 视图组件：`screens/week-view.tsx:206`、`screens/today-view.tsx:18`、`screens/schedule-view.tsx:31`、`screens/settings-view.tsx:252`、`screens/onboarding.tsx:32`。

**关键用户路径**
- 首启建学期：`onboarding.tsx:91-140` → `createSemester`（`packages/core/src/mutations.ts:303`）→ `App.tsx:912-917`。
- 课表→课程详情→调课：`App.tsx:684-699` → `loadCourseDetail`（`data.ts:586`）→ `components/lesson-detail.tsx:23`；拖拽调课 `App.tsx:722-856` → `createReschedule`/`updateSchedule`（`mutations.ts:755/529`）。
- 导入：设置→学期设置→`CourseManager`（`settings-view.tsx:1007-1013`）→ `ImportFlow`（`import-flow.tsx:85`）→ `applyImport`（`import/apply.ts:34`）。
- 数据：导出/导入（`settings-view.tsx:1744/1751`、`data-management.ts:77/202`）；备份与 WebDAV（`backup.ts:122/226`、`webdav.ts:308/323`）。

**模块边界**
- core：`storage.ts:28-45`、`migrate.ts:36-47`、`sync.ts:132-161`、`import/index.ts:1-7`、`config/index.ts:288-412`。
- web：`db/platform.ts:52-67`、`data.ts:184`、`log.ts`、`notify.ts`；desktop：`lib.rs:2739-2769`；mobile：`widget-pin.ts`、`WidgetRenderer.kt`。

**文案资源位置**
- 无集中文案模块；界面文案散在组件内，领域映射表见 `settings-view.tsx:133-191`、`data.ts:40-46`，设置键清单在 `settings.ts:151-188`、`backup.ts:57-91`；web 中文行 2344（`apps/web/src` 的 `.ts/.tsx` 含 CJK 字符行），单文件最多为 `settings-view.tsx` 419 行。

**复用现状**
- UI 基元 14 个 760 行（`components/ui/*`）；卡片注册表 `cards/registry.ts:82-160` 已注册 10 张（日程 4/设置 6）；Storage 三实现（`storage.ts:88`、`sqlite-storage.ts:64`、`idb-storage.ts:67`）；导入解析 7 个文件。

**扩展点**
- 卡片 `cards/registry.ts:82-102`；导入 `import/index.ts:1-7` + `import-flow.tsx:48-56`；提醒 `notify.ts:25-86` + `useReminders.ts:112-136`；平台 `platform-detect.ts:3-10`；主题 `tokens.ts:84` + `settings.ts:5/11`；设置项 `settings.ts:37-188` + `backup.ts:8-44`。

**数据与存储**
- 8 张表（`schema/001_init.sql:5-163`）；6 个迁移（`migrate.ts:36-47` + `db/platform.ts:26-33`）；时间口径 `time.ts:104-133`；行级同步协议 `sync.ts:132-161`；WebDAV 整包 `webdav.ts:148-323`。

**验证入口**
- `pnpm test`（`package.json:12`）；`tools/verify/verify-all.ps1` 19 项 9 段（`:37-218`）；CI 三 job（`.github/workflows/ci.yml:19/35/45`）；冒烟 `tools/verify/smoke-ui.mjs` + `apps/web/smoke/entry.tsx`；a11y `tools/design/check-a11y.mjs`。

## 1. P0 任务

### [P0-01] 待办/作业/考试/实验没有删除入口
- 轨道：产品体验
- 类型：交互反馈
- 位置/证据：`packages/core/src/mutations.ts:825`（`deleteEvent` 已存在）；`apps/web/src` 全仓无 `deleteEvent` 调用；`apps/web/src/screens/todo-form.tsx:632`（详情仅「取消 / 复制一条 / 保存」）；`apps/web/src/screens/cards/schedule-cards.tsx:282-286`（仅对 `kind==='adjust'` 的调课记录做软删）
- 现状：日程时间线与倒计时卡里的待办只能改与勾完成，不能删除；误建一条考试无法清理，用户改用「勾完成」代替删除，已完成分组长期膨胀；core 层删除能力已具备但无人调用。
- 改法：`TodoForm` 编辑态 footer 左侧加 danger 按钮「删除这条」，点击弹全局确认框（组件与句式来自 P0-02）→ 调 `deleteEvent` + `onChanged()`；时间线列表行补滑出/长按删除作为第二入口；删除后与 P0-02 同口径提示。
- 路径调整：原无删除路径（只能勾完成或改日期，事实上的 ∞ 步）→ 新「点条目→删除→确认」3 步；不新增页面层级。
- 布局调整：详情 footer「取消 / 复制一条 / 保存」→「删除这条（danger，靠左） / 复制一条 / 取消 / 保存」；原因：删除与复制同为条目级操作，danger 靠左与主按钮拉开距离，降低误触。
- 文案调整：新增按钮 `删除这条`；确认句 `将删除「X」及关联提醒，不可撤销`；成功 toast `已删除「X」`。
- 复用方案：复用对象 `Dialog`、`toast`、P0-02 的 `ConfirmDialog` 与 `DELETE` 句式；抽象边界＝只做「删除单条待办」的确认与派发，不含批量与回收站；复用方式＝传入对象名、关联提醒数与回调；迁移步骤＝先接详情页，再接列表行；防过度抽象＝不为每类记录各写一套确认组件。
- 拓展方案：无
- 优先级：P0；ICE I9 / C9 / E7（=567）
- 依赖：前置 P0-02（确认组件与句式）；删除为硬删还是软删待 Q4。
- 验收指标：日程/作业/考试/实验四类均在 3 步内可删除并完成确认；删除后同一记录在时间线、倒计时卡、课表格子同时消失；冒烟用例「新增一条作业→打开详情→删除→确认→列表不存在」通过。
- 来源：主审+盲审；盲审未单列（盲审只覆盖旧 TODO 35 条）；分歧与裁决：无；本轮实现：`3483df4`（验证见 §10.7）。
- 状态：待验收

### [P0-02] 删除整门课/排课/提醒/快照与恢复快照无确认，删除句式缺数量
- 轨道：产品体验 + 文案
- 类型：交互反馈
- 位置/证据：`apps/web/src/components/lesson-detail.tsx:33-45`（`removeSchedule` / `removeCourse` 直接 `deleteSchedule` / `deleteCourse`，成功后才 toast，无确认）；`apps/web/src/components/reminder-form.tsx:77-88`（`remove()` 直接 `deleteReminder`，`:81` 调用、`:83` 提示）；`apps/web/src/screens/cards/schedule-cards.tsx:283-286`（`deleteAdjust` 直接 `updateEvent` 写 `deleted_at`）；`apps/web/src/screens/settings-view.tsx:1621-1638`（恢复快照 `:1626`、删除快照 `:1635` 均直接 `runBusy` 执行）；`apps/web/src/App.tsx:1403`（WebDAV「恢复全部」）；已有确认可复用结构：`apps/web/src/screens/settings-view.tsx:2116-2139`、`apps/web/src/screens/course-manager.tsx:280-303`；缺数量处：`apps/web/src/screens/course-manager.tsx:291`、`apps/web/src/screens/settings-view.tsx:2127`；`apps/web/src/screens/onboarding.tsx:80`（`mode:'overwrite'` 无后果说明）；`docs/04-界面与文案规范.md:108-109`（固定句式）
- 现状：删整门课、删排课、删提醒、删调课记录、删快照、恢复快照均一击生效，无二次确认；删学期/课程虽有确认，但句式写成「及其…本操作不可撤销」且不逐类给数量；全仓无撤销入口；引导页覆盖导入前无后果说明。
- 改法：新增全局 `ConfirmDialog`（基于 `Dialog`，统一 `danger` 主按钮、对象名、逐类数量、后果句），替换上述 4 处直接执行与 1 处 WebDAV 恢复；删除句式收口到 `copy/zh.ts` 的 `DELETE` 构造函数；删除类动作先软删并给 5 秒「撤销」toast，恢复快照在确认句里写明「恢复前会备份一份」。
- 路径调整：原 1 步执行（点即删）→ 新 2 步「操作→确认」；5 处（排课/整门课、提醒、调课记录、快照删除、快照恢复 + WebDAV 恢复全部）全部纳入，不新增页面。
- 布局调整：无（确认框沿用现有弹窗宽度与按钮位次，主按钮为 danger）。
- 文案调整：删课程 `将删除「X」及其 N 条排课与相关提醒，本操作不可撤销`→`将删除「X」及 N 条排课、M 条提醒，不可撤销`；删学期 `将删除「X」及课程、日程与提醒，不可撤销`→`将删除「X」及 A 门课程、B 条排课、C 条日程、D 条提醒，不可撤销`；删排课 `将删除周三 第 3–4 节的排课，不可撤销`；删提醒 `将删除这节课的课前提醒，不可撤销`；删快照 `将删除该快照，不可撤销`；恢复快照 `将用该快照覆盖本机数据，重启后生效，不可撤销`；WebDAV `将覆盖本机数据（下载前已备份本机），不可撤销`；引导页覆盖前补 `将覆盖设备上的现有数据，不可撤销`。
- 复用方案：复用对象 `Dialog`、`settings-view.tsx:2116` 已有确认结构、`course-manager.tsx` 删除确认、`DELETE` 构造函数；抽象边界＝「破坏性动作确认」的唯一入口，只接收对象名、数量清单、后果与回调；复用方式＝各调用点改为 `confirmDelete({...})`；迁移步骤＝先替换 4 处直接执行，再把已有两处确认改写成 `DELETE` 句式，最后接 5 秒撤销；防过度抽象＝不做通用「任意危险操作框架」，不引入命令模式或撤销栈。
- 拓展方案：无（全局撤销/操作历史列第 8 节）
- 优先级：P0；ICE I8 / C8 / E8（=512）
- 依赖：P0-01 依赖本条；软删/硬删与撤销保留时长待 Q4、Q7。
- 验收指标：上述 5 处删除/恢复 100% 弹确认且含对象名、逐类数量与「不可撤销」；冒烟断言「点删除但不确认，数据仍在」；删除后 5 秒内点「撤销」记录恢复；`grep` 全仓无 `deleteSchedule(` / `deleteCourse(` / `deleteReminder(` 的裸调用（除确认框回调内）。
- 来源：主审+盲审；分歧与裁决：无；本轮实现：`b38143a`（验证见 §10.7）。
- 状态：待验收

### [P0-03] 桌面课程详情没有关闭出口，三栏并排挤压课表
- 轨道：产品体验
- 类型：UI布局
- 位置/证据：`apps/web/src/App.tsx:1092-1096`（`isDesktop && detail !== null` 渲染 `w-96` aside，无关闭控件）；`apps/web/src/components/lesson-detail.tsx:16,29`（`onClose` 仅在 `:37/44/90` 删除或编辑时调用）；`apps/web/src/screens/week-view.tsx:360-363`（全仓唯一 Esc 只取消空白格占位）；`apps/web/src/components/nav.tsx:35`、`apps/web/src/lib/use-media.ts:23-26`（≥1024px 侧栏与详情同现）；`apps/web/src/screens/week-view.tsx:729-733`、`apps/web/src/components/course-card.tsx:61`（列宽等分、10px 字号）
- 现状：桌面打开课程详情后无 ✕、无 Esc、无点空白关闭；切到日程/设置页 `detail` 不重置，回到课表仍在；1024 宽下三栏并排把列宽压到约 51px，课程卡文字不可读。
- 改法：`LessonDetail` 顶部加图标按钮（`aria-label="关闭课程详情"`）调用现有 `onClose`；`App` 增加 Esc、主区空白点击关闭，并在 `setView` 时 `setDetail(null)`；1024–1439 详情改为右侧 `Sheet` 覆盖层，≥1440 才并排；侧栏在 240/64 间可折叠并持久化。
- 路径调整：原无关闭出口（视作 ∞）→ 新 Esc、✕、点空白任一 1 步；不新增层级。
- 布局调整：240 侧栏 + 主区 + 384 常驻详情 → 240/64 侧栏 + 主区 + 覆盖层（≥1440 并排）；原因：1024 宽下主区列宽约 51px，课程卡不可读。
- 文案调整：新增 `关闭课程详情`（图标按钮 aria-label 与提示）。
- 复用方案：复用 `apps/web/src/components/ui/sheet.tsx` 与移动端详情 Sheet 的关闭语义；抽象边界＝详情容器只换承载方式，内容组件不动；复用方式＝桌面 <1440 用 `Sheet` 包裹 `LessonDetail`；迁移步骤＝先加关闭按钮与 Esc，再切覆盖层，最后做侧栏折叠；防过度抽象＝不抽「通用三栏布局」组件。
- 拓展方案：无
- 优先级：P0；ICE I10 / C9 / E9（=810）
- 依赖：无
- 验收指标：1024/1280/1440+ 三档宽度下 ✕、Esc、点空白三种关闭方式均生效；切到日程或设置再回课表不残留详情；最小列宽 ≥90px；冒烟新增 3 条（关闭按钮存在、Esc 生效、切页清空）。
- 来源：主审；盲审未单列；分歧与裁决：无；本轮实现：`aa3b32c`（验证见 §10.7）。
- 状态：待验收

### [P0-04] 设置页两级折叠，导入课表埋在 4 层下，空态指向不存在的「导入页」
- 轨道：产品体验 + 文案
- 类型：信息架构
- 位置/证据：`apps/web/src/lib/collapse-store.ts:3`（默认收起 semesters/reminders/appearance/data）；`apps/web/src/screens/cards/settings-cards.tsx:14-21`（6 张卡）；`apps/web/src/screens/settings-view.tsx:1003-1016`（学期卡内再嵌 3 张折叠卡）；`apps/web/src/screens/course-manager.tsx:206-225`（「导入课表」为 `<details>`）；`apps/web/src/screens/import-flow.tsx:343-359`（4 步向导）；`apps/web/src/screens/week-view.tsx:718-726`、`apps/web/src/screens/course-manager.tsx:153`（空态写「导入页」且无 action）；`apps/web/src/components/app-toolbar.tsx:118-123`（「添加课程」仅 `!compact` 渲染）；`docs/01-产品与功能.md:66`（导入不占导航）
- 现状：首用核心任务「导入课表」位于 设置→学期设置(默认收起)→课程管理(默认收起)→导入课表(details) 之下，移动端到可操作需 7 次点击（设置→学期设置→课程管理→导入课表→选方式→选文件→确认）；课表与课程管理空态都让用户去不存在的「导入页」，课表空态还写「从右上角加课」而移动端该按钮不渲染。
- 改法：设置页顶部加一行 4 个快捷动作（导入课表/导出备份/恢复快照/检查更新），导入直接打开 `ImportFlow` 抽屉；学期卡内三张二级折叠改为分段标题；首屏默认展开「学期与课程」「提醒」；课表空态加主按钮「导入课表」并按 `compact` 切换文案；课程管理空态改为「可在下方导入课表」。
- 路径调整：原 7 步（允许课表页入口则 4 步）→ 新 5 步；空态到导入向导 ≤3 次点击。
- 布局调整：6 折叠卡 + 卡内 3 折叠 → 顶部动作条 + 6 卡（首组展开、卡内不折叠）；原因：核心任务不应藏在两级默认收起的折叠里。
- 文案调整：`从右上角加课，或到导入页导入`→`从右上角「添加课程」，或在设置里导入课表`（移动端 `点右下角「快速添加」，或在设置里导入课表`）；`当前学期没有课程，可在导入页添加或导入`→`当前学期没有课程，可在下方导入课表`；空态主按钮 `导入课表`；全仓删除「导入页」说法。
- 复用方案：复用对象 `ImportFlow`、`Dialog`/`Sheet`、`EmptyState` 的 `action`（`apps/web/src/components/ui/empty-state.tsx:9` 已支持）；抽象边界＝导入流程保持不变，只改入口与承载容器；复用方式＝顶部动作条直接挂 `ImportFlow` 抽屉；迁移步骤＝先加动作条，再改两处空态，最后调整默认展开与卡内折叠；防过度抽象＝不新建「快捷中心」页面。
- 拓展方案：无
- 优先级：P0；ICE I9 / C8 / E6（=432）
- 依赖：课表页能否放导入入口待 Q2；P0-05 依赖本条入口。
- 验收指标：空态到导入向导 ≤3 次点击；1280×800 与 390×844 首屏可见导入入口；文案中不再出现「导入页」，移动端不再出现「右上角」；冒烟断言空态主按钮存在且打开导入流程。
- 来源：主审+盲审；分歧与裁决：05 新文案未区分端，采用 03 的 `compact` 分支；本轮实现：`4b2ce8a`（验证见 §10.7）。
- 状态：待验收

### [P0-05] 导入向导第 4 步「确认」名不副实，「完成」在设置页无响应
- 轨道：产品体验 + 文案
- 类型：交互反馈
- 位置/证据：`apps/web/src/screens/import-flow.tsx:343-359,733-753`（步骤标签「选择方式/登录或上传/预览/确认」，第 4 步正文为「导入完成」）；`apps/web/src/screens/import-flow.tsx:748-750`（「完成」`onClick={onClose}`）；`apps/web/src/screens/course-manager.tsx:222`（`onClose={() => undefined}`）；`apps/web/src/screens/import-flow.tsx:536-552`（书签步骤只有「3. 回到本页粘贴」）
- 现状：导入成功后点「完成」无任何反应，用户被卡在折叠区需自己再收起；步骤 4 标签「确认」与内容「导入完成」不一致；书签步骤编号从 3 开始。
- 改法：`CourseManager` 用 `useState` 控制 `<details>` 的 `open`，`onClose` 收起并刷新列表；步骤标签改「选择方式/登录或上传/预览/完成」；书签步骤补「1. 安装书签 / 2. 在课表页执行 / 3. 回到本页粘贴」。
- 路径调整：原「确认导入→完成(无响应)→手动收起」3 步 → 新「确认导入→完成(自动收起并回课程列表)」2 步。
- 布局调整：无（折叠区与向导步骤条形态不变）。
- 文案调整：步骤 4 `确认`→`完成`；书签步骤由单条 `3. 回到本页粘贴…` 补齐 1/2/3 三步编号。
- 复用方案：复用 `CourseManager` 的折叠状态与 `ImportFlow` 步骤条；抽象边界＝只补状态回写与标签文案，不改导入逻辑；复用方式＝`onClose` 由父级注入收起回调；迁移步骤＝先修 `onClose`，再改标签与编号；防过度抽象＝不重写向导状态机。
- 拓展方案：无
- 优先级：P0；ICE I6 / C8 / E5（=240）
- 依赖：前置 P0-04（入口层级）。
- 验收指标：点「完成」后折叠区收起、课程列表显示新数据；4 个步骤标签与正文一一对应；冒烟断言「点完成后 `[data-role="course-import"]` 收起」。
- 来源：主审+盲审；分歧与裁决：与 P0-04 同批交付，同为 P0；本轮实现：`1c2bea8`（验证见 §10.7）。
- 状态：待验收

### [P0-06] 备份设置键清单收敛为单一来源，补齐两项丢失设置
- 轨道：技术演进
- 类型：重复代码（键清单手抄）+ 数据风险（配置丢失）
- 位置/证据：`packages/core/src/settings.ts:151-188`（36 个设置键 `KEYS`）；`packages/core/src/backup.ts:8-44`（`BACKUP_META_KEYS` 34 个，缺 `week_starts_today`、`hide_weekends`）；`packages/core/src/backup.ts:132-138,241-252`（导出/导入消费该清单）；`docs/02-数据与存储.md:43-53`（文档键清单同样不全）
- 现状：`week_starts_today`、`hide_weekends` 在设置中可读写，却不在备份键清单内；JSON 备份、WebDAV 同步包与快照恢复统一走 `BACKUP_META_KEYS`，换机恢复后这两项视图设置静默回默认值。两份清单靠手抄，无一致性校验，下一次增删设置键仍会漂移。
- 改法：`settings.ts` 导出 `SETTING_META_KEYS = Object.values(KEYS)` 与 `EXPORT_EXCLUDED_KEYS = ['webdav_password']`；`backup.ts` 的键清单改为「派生键 − 排除键 + `schema_version`」；新增键一致性单测与「导出→清空→导入」往返断言；旧备份缺键继续按跳过逻辑兼容。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`settings.ts:151-188` 的 `KEYS`（唯一键源）；抽象边界=键清单归设置模块所有，备份模块只消费、不反向依赖；复用方式=`import { SETTING_META_KEYS, EXPORT_EXCLUDED_KEYS }` 后在 `backup.ts` 派生，再拼 `schema_version`；迁移步骤=①`settings.ts` 增加两个导出 ②`backup.ts` 改为派生 ③`packages/core/test/backup.test.ts` 加「设置键全集 = 备份键 ∪ 排除集」用例 ④补 `backup.test.ts:212-225` 的导出/清空/导入往返断言 ⑤用旧备份验证缺键跳过 ⑥`docs/02-数据与存储.md:43-53` 键清单随派生逻辑更正；防过度抽象（不抽什么）=不建设置项注册表、不做设置 schema 化、不调整 `webdav_password` 的排除语义，本轮只消除键清单二次维护。
- 拓展方案：无
- 优先级：P0；ICE（I7/C10/E9=630）
- 依赖：无
- 验收指标：一致性单测「`SETTING_META_KEYS` 与 `BACKUP_META_KEYS` 之差等于 `EXPORT_EXCLUDED_KEYS`」通过；备份导出→清空→恢复往返后 `weekStartsToday`/`hideWeekends` 与导出前一致；`packages/core` 测试全绿。
- 来源：主审；分歧与裁决：无；本轮实现：`ac3fd31`（验证见 §10.7）。
- 状态：待验收

### [P0-07] 整包 zip 打包/解包收敛为一处，导入恢复预设与日志
- 轨道：技术演进
- 类型：重复代码 + 耦合（同一整包格式三处理解）
- 位置/证据：`apps/web/src/data-management.ts:104-140`（导出写 `backup.json`+`presets/*`+`logs/*`）、`:174-192`（导入只取 `backup.json`）；`apps/web/src/webdav.ts:148-164` `buildPackage`、`:245-293` `applyPackage`（会恢复 `presets/*`）；`tools/backup/export-anywhere.mjs:187`（脚本侧第三种实现）；`packages/core/src/backup.ts:24-245`（`exportBackup/importBackup/parseBackup`）
- 现状：应用内导出与导入不对称——导出含预设与日志，导入只读 `backup.json`，用户在同机「导出→导入」后丢预设；WebDAV 包与脚本包对同一格式各有一套读写，格式演进需改三处。
- 改法：新增 `apps/web/src/package.ts`（`buildPackageEntries / readPackageEntries / applyPackageEntries` 三个纯函数）；`data-management.ts` 与 `webdav.ts` 统一调用；应用内导入按勾选项恢复 `presets/*`，`logs/*` 默认不覆盖并在结果中明示。
- 路径调整：无
- 布局调整：无
- 文案调整：无（导入结果提示用词由文案轨另给）
- 复用方案：复用对象=`core/zip.ts`、`core/zip-read.ts`、`core/backup.ts:24-245` 的 `exportBackup/importBackup/parseBackup`，以及 `webdav.ts:148-164` 已验证的条目布局；抽象边界=只定义「整包 = `backup.json` + `presets/*` + `logs/*`」与打包/应用两个动作，不含 UI 勾选与 WebDAV 命名策略；复用方式=`webdav` 与 `data-management` 共同调用三个纯函数，勾选态作为 options 传入；迁移步骤=①照搬 `webdav.buildPackage` 建 `package.ts`（保持 WebDAV 现有语义）②`webdav.applyPackage` 改调用 ③`exportConfig/readImportFile` 改调用 ④补「导出→导入→预设恢复」单测 ⑤设置页导入结果提示接入新返回值；防过度抽象（不抽什么）=不新增格式版本号、不做制品类型注册表、不把 WebDAV 的命名与历史保留策略搬进 `package.ts`。
- 拓展方案：无
- 优先级：P0；ICE（I8/C8/E6=384）
- 依赖：P0-06（同属备份正确性，键清单先修）
- 验收指标：`apps/web/test/data-management.test.ts` 新增「整包导出后清空再导入，`presets_snapshot_v1`/`presets_content_v1` 与导出前相等」通过；`apps/web/test/webdav.test.ts` 全绿；`data-management.ts` 与 `webdav.ts` 不再各自出现 zip 条目拼接。
- 来源：主审+盲审；分歧与裁决：无；本轮实现：`c162b73`（验证见 §10.7）。
- 状态：待验收

### [P0-08] 手工排课补 `weeks_raw` 派生，详情页不再显示「未标注周次」
- 轨道：技术演进
- 类型：数据风险（字段不完整）+ 耦合（派生责任落在每个调用方）
- 位置/证据：`apps/web/src/screens/course-form.tsx:233-241`（构造 schedules 未传 `weeksRaw`）；`packages/core/src/mutations.ts:549,576`（支持 `weeksRaw`，`:517` 为 `weeksRaw ?? null`）；`apps/web/src/components/lesson-detail.tsx:81`（`row.weeks_raw ?? '未标注周次'`）；对照 `packages/core/src/import/apply.ts:99`（导入路径会写 `describeWeeks`）；`packages/core/src/search.ts:81`（搜索副标题读同一字段）
- 现状：导入课显示「1-16 周」，手工新建课显示「未标注周次」，搜索副标题缺周次文案；派生字段依赖每个写入方记得传，新增写入路径必然重犯。
- 改法：在写入层 `setSchedules` 内由 `weeks_mask` 派生 `weeks_raw`（`weeksRaw ?? describeWeeks(mask, totalWeeks)`）；`setSchedules` 增加可选 `totalWeeks` 参数，`course-form` 传入；历史数据回填单独评估，不纳入本次改动。
- 路径调整：无
- 布局调整：无
- 文案调整：无（「未标注周次」仅历史数据保留，不由本轮新增文案）
- 复用方案：复用对象=core `weeks.describeWeeks/weeksToMask`（已存在、web 未用）；抽象边界=派生在写入层完成，调用方不必知情，`weeks_raw` 成为写入层产物而非调用方责任；复用方式=`weeksRaw: input.weeksRaw ?? describeWeeks(weeksToMask(input.weeks), totalWeeks)`；迁移步骤=①`setSchedules` 加可选 `totalWeeks` ②补派生 ③`course-form.tsx:233-241` 传参 ④`packages/core/test/mutations.test.ts` 加「新建课程后 `weeks_raw` 非空」断言 ⑤历史数据回填另行评估；防过度抽象（不抽什么）=不做通用字段派生框架、不为 `weeks_raw` 建独立同步字段，只补这一个派生。
- 拓展方案：无
- 优先级：P0；ICE（I4/C9/E7=252）
- 依赖：无
- 验收指标：`packages/core/test/mutations.test.ts` 新增「`setSchedules` 后 `weeks_raw` 等于 `describeWeeks` 结果」通过；新建课程进详情不再出现「未标注周次」，`search.ts:81` 副标题带周次。
- 来源：主审；分歧与裁决：与 A-04 同一改法、同一验收点，合并为 P0；本轮实现：`1d4c252`（验证见 §10.7）。
- 状态：待验收

## 2. P1 任务

### [P1-01] 新增入口分散、加考试无显式入口、倒计时空态按钮名不副实
- 轨道：产品体验 + 文案
- 类型：信息架构
- 位置/证据：`apps/web/src/screens/cards/schedule-cards.tsx:184-191`（「添加」菜单仅「加待办 / 课程调整」）；`apps/web/src/App.tsx:960-969,1135-1158`（`onAddExam` 唯一消费点；移动端「快速添加」仅两项）；`apps/web/src/screens/cards/schedule-cards.tsx:600-608`（空态按钮写「加待办」而 `onClick` 为 `onAddExam`）；`apps/web/src/components/app-toolbar.tsx:118-123`、`apps/web/src/screens/week-view.tsx:906-909`（另两处新增入口）
- 现状：全应用唯一「加考试」动作藏在倒计时卡空态，且按钮写「加待办」；倒计时卡有条目时没有加考试入口；新增入口共五处、三套语义（工具栏添加课程 / 快速添加两项 / 日程添加菜单 / 空态按钮 / 空白格＋）。
- 改法：抽一个共用「＋」菜单组件，四项：加课程/加待办/加考试/导入课表；桌面为工具栏主按钮 + 下拉，移动为 FAB + 底部 Sheet；日程页「添加」菜单同源；空白格「＋」保留并预填加课程；倒计时空态按钮改「加考试」。
- 路径调整：原「日程→添加→加待办→改类型为考试→保存」5 步 → 新「日程→添加→加考试→保存」4 步；入口由五处三套语义收敛为一处菜单四类动作。
- 布局调整：工具栏「添加课程」单按钮 + 移动「快速添加」两项 + 日程「添加」菜单 → 统一「＋」菜单（桌面下拉、移动底部 Sheet）；原因：同一语义不应在不同页面给不同动作集。
- 文案调整：空态 `加待办`（实际打开考试表单）→`加考试`；`课程调整`→`调整课程`；菜单项 `加课程/加待办/加考试/导入课表`。
- 复用方案：复用 `TodoForm` 的 `kind` 预选（已支持）与 `Dialog`/`Sheet`，与 P1-12 日程命名一致；抽象边界＝「＋」菜单只做动作派发，不内嵌表单；复用方式＝四个触发点共用同一组件与同一动作枚举；迁移步骤＝先桌面工具栏，再移动 FAB，再日程菜单，最后统一空态；防过度抽象＝不做可配置菜单注册表。
- 拓展方案：无
- 优先级：P1；ICE I8 / C8 / E8（=512）
- 依赖：无（与 P0-04 的导入入口同批，避免两套「导入」入口）
- 验收指标：菜单含四项；移动端 FAB 含「加考试」；倒计时空态文案与打开的表单类型一致；冒烟断言「点加考试→类型按钮考试为选中」。
- 来源：主审；分歧与裁决：05 EMP-08 将现按钮判为正例，按 03 改为「加考试」；定级由 P0 调整为 P1 并随首批交付。
- 状态：待办

### [P1-02] 「我的」占位占导航位：隐藏或建成「设备与同步」
- 轨道：产品体验 + 文案
- 类型：信息架构
- 位置/证据：`apps/web/src/components/nav.tsx:14-21,35`（`DESKTOP_NAV` 四项，`mine` 第 4，移动端直接复用）；`apps/web/src/App.tsx:998-1003`（「我的 / 建设中」）；旧 TODO 条目 O-10（「我的」页面内容）；`docs/01-产品与功能.md` 全文无「我的」页定义（仅 `:66` 提到导入不占导航）
- 现状：桌面侧栏与移动底栏各 4 项，其中 1 项（25%）无内容；占位口吻制造「有功能但没做完」的印象，导航权重被稀释；旧 TODO O-10 与本条是同一对象，尚未定去向。
- 改法：二选一——①上线前从 `DESKTOP_NAV` 隐藏，只留课表/日程/设置，`NavId` 保留兼容；②建成「设备与同步」，承载存储位置、WebDAV、悬浮窗/小组件、更新，设置页只留偏好。
- 路径调整：不改任务步骤；消除每设备每会话至少 1 次无效点击。
- 布局调整：4 项（1 项空）→ 3 项，或 4 项全实；原因：导航项数应与有内容的域数一致。
- 文案调整：删除 `建设中`；若保留占位则改 `这里还没有内容`。
- 复用方案：方案②复用设置页设备类卡片（`apps/web/src/screens/settings-view.tsx:1444-2024`）；抽象边界＝只迁移「设备与数据」类卡片，偏好类留在设置；复用方式＝卡片组件原样挂到新页；迁移步骤＝先定页信息架构，再迁卡片，最后清设置页重复入口；防过度抽象＝不做通用「页面注册表」。
- 拓展方案：无
- 优先级：P1；ICE I6 / C7 / E9（=378）
- 依赖：产品定位决策待 Q1（决策前置，未定则本条不能开工）。
- 验收指标：导航项数＝有页面内容的域数；一级页面无「建设中」；移动底栏每项 1 秒内出内容。
- 来源：主审；分歧与裁决：定级随 Q1 结论回填；Q1 已定：建成「设备与同步」页（存储类型 / 渠道 / 版本 / 检查更新 / 同步入口 / 关于）。本轮实现：`40cb891`（已合入 dev）。
- 状态：待验收

### [P1-03] 搜索命中后不定位
- 轨道：产品体验
- 类型：交互反馈
- 位置/证据：`apps/web/src/App.tsx:871-887`（`pickSearchHit`：event 命中只切日程页；课程命中需在当前 `data.grid` 找到，否则只切课表页）；`apps/web/src/screens/schedule-view.tsx:42`（`viewDate` 是组件内 state，App 无法设置）
- 现状：搜一条下个月的考试落到「今天」；搜一门不在当前窗口的课只是停在当前窗口，无高亮、无翻页；用户只能自己再找一遍。
- 改法：`pickSearchHit` 携带命中日期，`ScheduleView` 改受控 `viewDate`（或加 `initialDate`）并滚动到该行高亮；课程命中按命中周 `setWindowStart(weekDateOf(...))` 后 `openLesson`。
- 路径调整：原「搜索→日程页(今天)→自己找日期→找到」4 步 → 新「搜索→直达并高亮」2 步。
- 布局调整：无（仅补高亮态，不改页面结构）。
- 文案调整：无
- 复用方案：复用 `openLesson`、`weekDateOf`；抽象边界＝定位能力只补「日期参数 + 高亮锚点」，不重写搜索；复用方式＝命中结果增加 `date` 字段，页面消费；迁移步骤＝先日程受控化，再课程翻窗，最后补高亮；防过度抽象＝不做通用「深链路由」。
- 拓展方案：无
- 优先级：P1；ICE I7 / C8 / E7（=392）
- 依赖：无
- 验收指标：非今日的考试命中后显示该日期并高亮该行；非当前窗口的课程命中后翻到该周并打开详情；各新增 1 条冒烟。
- 来源：主审；盲审未单列；分歧与裁决：无。
- 状态：待办

### [P1-04] 合并两个调课弹窗，统一调课语义与文案
- 轨道：产品体验 + 文案
- 类型：一致性
- 位置/证据：`apps/web/src/App.tsx:1160-1261`（拖拽后「调整课程时间」，4 个立即执行按钮，footer 只有取消）；`apps/web/src/components/adjust-dialog.tsx:222-451`（「课程调整」三模式，footer 取消/保存）；`apps/web/src/components/lesson-detail.tsx:123`、`apps/web/src/screens/cards/schedule-cards.tsx:189`（另两个入口）；`apps/web/src/components/adjust-dialog.tsx:246,278,316,360,368,401`（提问式标签）；`docs/01-产品与功能.md:38-40`（调课/停课/假期口径）
- 现状：同一件事两个界面共 7 个主操作按钮，「本周/每周/调到该周/调到该日期」与「调课/调休/临时加课」概念不可迁移；「保存」在停课场景字面错误；「性质：课程/实验」混入与调课无关的字段。
- 改法：保留一个「课程调整」弹窗，内部四选一：改期/停课/调休/临时加课；改期统一「这一次/每周/指定周/指定日期」单选 + 主按钮「应用调整」（停课为「确认停课」）；「性质」移回课程编辑；拖拽后打开同一弹窗并预填落点。
- 路径调整：详情进入调课 4 步 → 3 步；拖拽入口 3 步不变。
- 布局调整：两弹窗 7 个主操作 → 1 个弹窗 4 个范围单选 + 1 个主按钮 + 取消；原因：一间弹窗内只应有一个主操作。
- 文案调整：`调整课程时间`/`课程调整`/`调课`/`改期`→统一 `调课`；`哪门课`→`课程`；`原来哪一天`→`原日期`；`改到哪一天`→`调整后日期`；`把哪一天的课表`→`原日期课表`；`调到哪一天上`→`目标上课日`；`哪一天`→`加课日期`；`保存`→`应用调整`/`确认停课`。
- 复用方案：复用 `AdjustDialog` 为唯一实现，删除 `App.tsx:1160` 起的内联拖拽弹窗；抽象边界＝调课交互只有一处实现，三个入口只传预填参数；复用方式＝入口统一 `openAdjust({mode, date, lesson})`；迁移步骤＝先给 `AdjustDialog` 补四种模式，再接拖拽入口，最后删旧弹窗；防过度抽象＝不做可插拔「操作向导」。
- 拓展方案：无
- 优先级：P1；ICE I6 / C7 / E6（=252）
- 依赖：无
- 验收指标：全仓仅 1 个调课弹窗；三个入口的标题与范围选项一致；主按钮随模式变化；冒烟断言拖拽后打开的是同一 `data-role` 弹窗。
- 来源：主审；分歧与裁决：无。本轮实现：`e592f1c`（合入 `3d019ed`）。
- 状态：待验收

### [P1-05] 反馈双轨：toast、内联状态与待重启条的分工
- 轨道：产品体验
- 类型：交互反馈
- 位置/证据：`apps/web/src/components/ui/toaster.tsx:5-21`（sonner，顶部居中 4 秒，无 action）；`apps/web/src/screens/settings-view.tsx:1507,1602,1737,1779,1803,1915`（六处内联状态）；`apps/web/src/components/ui/busy-overlay.tsx:9`（全仓唯一 `aria-live`）；`apps/web/src/screens/settings-view.tsx:768-796`（`backupMessage` 同时承担导出/导入/日志等 4 种含义）
- 现状：动作结果有的走 toast（删课程 `apps/web/src/screens/course-manager.tsx:141`）、有的只写内联（导入 `apps/web/src/screens/settings-view.tsx:883`、备份 `:366-368`）；内联无 live region，读屏静默；toast 4 秒消失无法回看。
- 改法：定规则——动作结果一律 toast（成功/失败/撤销，失败带下一步），持续状态一律卡标题下固定状态行（`role="status" aria-live="polite"`，带上一次操作时间）；`backupMessage` 拆成导出/导入/日志三条或改 toast。
- 路径调整：不改步骤。
- 布局调整：5 类内联散落在 4 张卡 → 每卡一个固定状态行；原因：状态位置可预期才可回看。
- 文案调整：状态行统一 `已…` / `…时间 {t}`；错误统一 `xx失败：{原因}。{下一步}`。
- 复用方案：复用 `toast`、`Field` 状态行位、`busy-overlay` 的 live region 写法；抽象边界＝「结果 vs 状态」两类通道，不合并成一个；复用方式＝抽 `StatusLine` 与 `fail()`；迁移步骤＝先定规则，再改 `backupMessage`，最后逐卡补状态行；防过度抽象＝不做全局通知中心。
- 拓展方案：无
- 优先级：P1；ICE I6 / C8 / E7（=336）
- 依赖：无（与 P1-06 待重启条同批，避免重复占位）
- 验收指标：动作结果 100% 走 toast；持续状态 100% 在 live region；读屏可听到保存成功/失败；toast 不挡移动端工具栏。
- 来源：主审；分歧与裁决：无。
- 状态：待办

### [P1-06] 重启生效提示分散，无统一「待重启」状态
- 轨道：产品体验
- 类型：一致性
- 位置/证据：`apps/web/src/screens/settings-view.tsx:325-326,337,398-400,495,1512-1516,1643-1646`（5 条路径各写提示 + 2 处「立即重启」，三个互不相关 state）；`apps/web/src/App.tsx:1410-1421`（WebDAV 恢复后弹窗）
- 现状：同一全局状态分散在 4 张卡；关掉提示后无处看出还有待生效改动；两处「立即重启」易漏看。
- 改法：新增全局 `PendingRestart`（记录触发来源集合），设置页顶部与离开设置页后的主壳显示常驻条「N 项改动待重启 · 立即重启/稍后」；各路径只登记，不各自渲染。
- 路径调整：原「改设置→读提示→自己找重启按钮」→ 新「改设置→顶部常驻条→一次重启」。
- 布局调整：5 处提示 + 2 个按钮 → 1 条常驻条；原因：同一全局状态只应有一个呈现位置。
- 文案调整：新增 `N 项改动待重启`、`立即重启`、`稍后`。
- 复用方案：复用现有 `restartNow`（`apps/web/src/screens/settings-view.tsx:1513`）；抽象边界＝只做「待重启登记 + 一条呈现」，不接管重启实现；复用方式＝各路径调 `registerPendingRestart(source)`；迁移步骤＝先建状态，再接 5 条路径，最后删各自提示；防过度抽象＝不做通用「待生效设置总线」。
- 拓展方案：无
- 优先级：P1；ICE I7 / C7 / E5（=245）
- 依赖：无
- 验收指标：任意需重启操作后设置页与主壳均可见待重启条；重启后消失；条内含操作数。
- 来源：主审；分歧与裁决：无。
- 状态：待办

### [P1-07] SQLite 不可用时静默回退 IndexedDB
- 轨道：产品体验
- 类型：可访问性
- 位置/证据：`apps/web/src/db/platform.ts:52-66`（非损坏失败 `logWarn` 后回退 `openIndexedDbStorage()`）；`apps/web/src/App.tsx:404-413`（仅损坏走错误页）；`apps/web/src/App.tsx:76-80`（`STORAGE_LABEL` 仅设置页一处小字）；`apps/web/src/storage-config.ts:16-19`（`writable` 无 UI 消费）
- 现状：桌面/Android 原生库打不开时静默换浏览器存储，界面照常，用户以为数据全丢，会去恢复备份进而覆盖真实数据。
- 改法：回退时主壳顶部持久错误条「原生数据库不可用，已临时使用浏览器存储（本机数据未删除）」+ 重试/打开日志；设置页「同步与数据」首行显示真实存储类型并标「临时回退」；回退期间按 Q5 结论禁用写入或明确标记。
- 路径调整：不改步骤，把「静默」变「可见且可选择」。
- 布局调整：无提示 → 主壳常驻警告条 + 设置页状态行；原因：数据存储变化必须在首屏可见。
- 文案调整：新增 `临时回退`、`原生数据库不可用，已临时使用浏览器存储（本机数据未删除）`。
- 复用方案：复用错误页样式与日志导出入口；抽象边界＝只暴露存储状态，不改存储实现；复用方式＝`platform.ts` 回退分支在返回对象上带 `fallback: true`；迁移步骤＝先加标记，再挂主壳条，再补设置页状态行；防过度抽象＝不做存储健康度评分。
- 拓展方案：无
- 优先级：P1；ICE I9 / C6 / E5（=270）
- 依赖：回退期间是否允许写入待 Q5。
- 验收指标：模拟原生库失败时首屏 1 秒内出现警告条且含「重试」；设置页存储类型显示「临时回退」；冒烟断言失败分支渲染警告条。
- 来源：主审；分歧与裁决：无；Q5 已定：回退期间禁止写入，只读并引导修复或恢复快照。本轮实现：`fc7489d`（合入 `5962a0e`）。
- 状态：待验收

### [P1-08] 空态与状态覆盖：误报「没有课程」、空态无行动、倒计时卡缺态、日程页冗余刷新
- 轨道：产品体验 + 文案
- 类型：交互反馈
- 位置/证据：`apps/web/src/screens/week-view.tsx:718-726`（`!hasLessons` 空态无 action）；`apps/web/src/data.ts:560`（`hasLessons` 只统计 `cell.inWeek`）；`apps/web/src/screens/week-view.tsx:807-809`（非本周课程仍渲染虚线卡）；`apps/web/src/screens/today-view.tsx:74-75`、`apps/web/src/screens/cards/schedule-cards.tsx:291`（空态无按钮）；`apps/web/src/screens/cards/schedule-cards.tsx:596-608`（徽标存在时空态缺失）；`apps/web/src/screens/schedule-view.tsx:100-108`（页脚「刷新」+ 冗余统计）；`apps/web/src/components/ui/empty-state.tsx:9`（`action` 已支持）
- 现状：开启「显示非本周」时同一屏「没有课程」与虚线课卡并存；日视图、日程时间线、搜索、快照空态都无下一步；倒计时卡有徽标且无条目时下半区空白；日程页尾的手动「刷新」暗示数据可能不新。
- 改法：空态判据改为「窗口内无任何可见课程（含 ghost）」，分三态（真空课表 / 只有非本周 / 学期外）各给 1 个主行动；日视图、时间线、搜索、快照空态补 `action`；倒计时卡徽标区与条目区固定分区，空条目区给「加考试」；删除日程页「刷新」按钮，统计并入顶部日期行。
- 路径调整：原「空态→自己找入口」2+ 步 → 新「空态→主行动」1 步。
- 布局调整：空态纯文字 → 图标 + 事实 + 主按钮；页脚按钮与统计 → 顶部日期行；原因：空态必须给出唯一可执行动作。
- 文案调整：`X 没有课程`→`这段时间没有课程`；`今天没有课 / 可切换到周视图查看本周安排`→`今天没有课 / 切换周视图可看本周安排` + 按钮 `查看周视图`；`这一天没有安排 / 可切换日期查看其他日期`→`切换日期可看其他日期` + 按钮 `添加待办`；`没有匹配结果`→`没有匹配结果，换个关键词试试`；`暂无快照`→`暂无快照；点「立即备份」生成第一份`；`刷新`→删除（若保留则 `刷新数据`，按 Q 保留项处理）。
- 复用方案：复用 `EmptyState` 的 `action` 与「今天/本周」口径；抽象边界＝空态只补判据与主行动，不改各页面骨架；复用方式＝三态映射为 `EmptyState` 三个 props 组合；迁移步骤＝先修 `hasLessons` 判据，再补四处 action，最后删刷新按钮；防过度抽象＝不做全局空态路由表。
- 拓展方案：无
- 优先级：P1；ICE I6 / C8 / E8（=384）
- 依赖：无
- 验收指标：只有非本周课时不出现「没有课程」；每个空态有且仅有 1 个主行动；三态文案可区分；日程页无「刷新」；冒烟新增 3 条断言。
- 来源：主审+盲审；分歧与裁决：刷新按钮按「删除」执行；若复核保留则改为「刷新数据」。本轮实现：`d02f059`（已合入 dev）。
- 状态：待验收

### [P1-09] 错误页与加载页只有一行字，无行动；错误文案缺下一步
- 轨道：产品体验 + 文案
- 类型：交互反馈
- 位置/证据：`apps/web/src/App.tsx:889-895`（错误页仅 `<p>{error}</p>`）；`apps/web/src/App.tsx:897-903`（加载页仅「载入中」）；`apps/web/src/db/health.ts:20-24`（损坏文案无按钮）；`apps/web/src/screens/import-flow.tsx:311-313`、`apps/web/src/mini/main.tsx:221`、`apps/web/src/screens/school-timetable-card.tsx:121`（原始异常或校验器内部错误直接进界面）；`apps/web/src/App.tsx:201`（失败 toast 只有原因）
- 现状：存储初始化失败或数据库损坏时页面无任何按钮；冷启动白屏 +「载入中」；4 处把 `Error.message` 或校验器内部错误画到界面；9 处错误提示有事实无下一步。
- 改法：错误页改图标 + 标题 + 说明 + 按钮组（损坏→「从备份文件恢复」「打开备份目录」；其他→「重试」「打开日志」）；加载态给骨架或 3 秒后追加「仍在载入…」；错误文案统一 `fail(what, reason, next)` 句式；`import-flow`/`mini`/`school-timetable-card` 只显示用户语言，内部原因进日志。
- 路径调整：原「错误页→用户自行想办法」→ 新「错误页→1 个修复按钮」。
- 布局调整：单行文字 → 图标 + 标题 + 说明 + ≤2 个主按钮；原因：错误页唯一职责是把用户带回可用状态。
- 文案调整：`载入中`→`正在载入…`；新增 `载入失败` + `{原因}。请重启应用；仍失败请在「设置 → 同步与数据」导入备份，并附日志反馈。`；`识别失败：{原因}。请换一种导入方式，或手动添加课程。`；`打开教务窗口失败：{原因}`；`已关闭教务窗口，没有带回页面内容。请重新打开，并在窗口内点「导入到晓刻」`；`预设不可用，已改用内置作息`；`调课失败：{原因}；请重试，或查看「应用诊断日志」`。
- 复用方案：复用 `EmptyState`、`log.ts`、`withToast`（`apps/web/src/App.tsx:194-204`）；抽象边界＝错误呈现三层（页面级 / 卡级 / toast）共用 `fail()` 文案构造，不共用布局；复用方式＝`fail(what, reason, next)` 返回标题与正文；迁移步骤＝先建 `fail()`，再改错误页与加载页，最后清 4 处原始异常；防过度抽象＝不做全局错误码体系。
- 拓展方案：无
- 优先级：P1；ICE I7 / C8 / E6（=336）
- 依赖：无
- 验收指标：初始化失败页有「重试」「导入备份」；加载 3 秒后出现进度文案；4 处不再显示 `Error.message`；冒烟断言错误分支渲染按钮。
- 来源：主审；分歧与裁决：定级 P1，随首批文案修复执行。本轮实现：`e672e6c`（合入 `5962a0e`）。
- 状态：待验收

### [P1-10] 「课次」一词拆词：节次 / 排课 / 这节课
- 轨道：文案
- 类型：一致性
- 位置/证据：`apps/web/src/components/period-settings.tsx:581,629`（指节次）；`apps/web/src/components/adjust-dialog.tsx:261`（指排课）；`apps/web/src/screens/school-timetable-card.tsx:152`（「节课次」）；`apps/web/src/screens/course-form.tsx:83` 与 `apps/web/src/components/adjust-dialog.tsx:266`（「–」与「-」并存）；`apps/web/src/data.ts:88`（注释指某天一次课）；`docs/01-产品与功能.md:163`（文档只有「节次」）
- 现状：同一词「课次」同时指节次表行、排课记录与某天一次课；「3–4 节」与「3-4 节」并存；用户在「课程调整」里无法判断要选哪一层。
- 改法：按对象定词——时间表行＝节次/个，排课记录＝排课/条，某天一次课＝这节课；节次范围由 `periodRange()` 单点生成并统一 en dash「第 3–4 节」；文案落 `copy/zh.ts` 的 `COUNT`/`periodRange`。
- 路径调整：无
- 布局调整：无
- 文案调整：`自动生成课次`→`自动生成节次`；`还没有课次，请先生成课次`→`还没有节次，请先生成节次`；`已生成 N 节课次`→`已生成 N 个节次`；`要调整的课次`→`要调整的排课`；`当前 N 节课次`→`当前 N 个节次`；`已按 X 排好课次（N 节）`→`已按 X 排好节次（N 节）`；`第 3-4 节`→`第 3–4 节`。
- 复用方案：复用文案资源 `apps/web/src/copy/zh.ts`（`COUNT`、`periodRange`，见第 6 节）；抽象边界＝只做词形与连接符的单点生成，不改取值逻辑；复用方式＝所有节次范围改为 `periodRange(start, end)`；迁移步骤＝先建 `periodRange`，再逐处替换，最后 grep 校验；防过度抽象＝不建术语校验器。
- 拓展方案：无
- 优先级：P1；ICE I9 / C9 / E7（=567）
- 依赖：无（与 P1-12 同批执行）
- 验收指标：`grep 课次` 仅剩代码注释；节次/排课/这节课各指其物；范围连接符全仓统一为 en dash；typecheck 通过。
- 来源：主审；分歧与裁决：无。本轮实现：`cafa6fe`（已合入 dev）。
- 状态：待验收

### [P1-11] 通知权限两套词，桌面端恒显示「未申请」
- 轨道：文案 + 产品体验
- 类型：一致性
- 位置/证据：`apps/web/src/screens/settings-view.tsx:133-138`（`PERMISSION_LABEL`：未申请/已授权/已被拒绝）；`apps/web/src/screens/settings-view.tsx:152-167`（`notifyStateOf` 六态 + 动作）；`apps/web/src/screens/settings-view.tsx:1024`（非 Android 分支用 `PERMISSION_LABEL`）；`apps/web/src/notify.ts:81-85`（非 Web 平台恒返回 `default`）；`apps/web/src/App.tsx:265,461-471`（`permissionReport` 无界面消费）；`docs/01-产品与功能.md:79`（六态口径）
- 现状：Android 用 `notifyStateOf`、其他平台用 `PERMISSION_LABEL`，同一行「通知权限：」两端两套词；桌面即使系统已授权仍显示「未申请」；启动权限报告只进 state 与日志；提醒不响时界面无全局提示。
- 改法：删除 `PERMISSION_LABEL`，全平台共用 `notifyStateOf`；非 Web 平台改原生状态查询；权限异常时设置页顶部给一条状态横幅（`通知未授权，课前提醒不会弹出` + `去系统设置开启`）；`permissionReport` 要么上屏要么删除。
- 路径调整：原「提醒不响→自己猜→进设置→展开提醒卡才看到」4 步 → 新「状态行/横幅直达」1 步。
- 布局调整：权限异常时设置页顶部与提醒卡标题各一个状态点；原因：跨平台同一字段只能有一套呈现。
- 文案调整：`已授权`→`已允许`；`已被拒绝`→`已拒绝`；`已拒绝，不再弹窗`→`已拒绝且不再询问`；统一六态：未申请 / 已允许 / 已拒绝 / 已拒绝且不再询问 / 通知已关闭 / 通知渠道已静音。
- 复用方案：复用 `notifyStateOf`、`SettingCard` 状态行，删除 `PERMISSION_LABEL`；抽象边界＝状态查询与文案映射合一，界面只消费六态；复用方式＝`notifyStateOf` 返回 `{state, label, action}`；迁移步骤＝先删旧标签表，再补原生查询，最后加横幅；防过度抽象＝不做权限中心页。
- 拓展方案：无
- 优先级：P1；ICE I8 / C7 / E6（=336）
- 依赖：原生产状态查询能力待 Q3（不接受兜底则需原生侧补查询）。
- 验收指标：Windows 授权/拒绝/未申请三态与六态文案一一对应；异常首屏可见；`permissionReport` 有 UI 或删除；冒烟断言三态文案。
- 来源：主审；分歧与裁决：03 定 P1 / 05 定 P0，本表排 P1 并列入第一批文案修复；Q3 已定：非 Web 端补原生状态查询后再宣称六态。。
- 状态：待办

### [P1-12] 记录命名与量词：日程/待办/安排/条目与「其他」角标
- 轨道：文案
- 类型：一致性
- 位置/证据：`apps/web/src/screens/cards/timeline.ts:204`（日程类待办在时间线标「其他」）；`apps/web/src/components/nav.tsx:16`（导航「日程」）；`apps/web/src/screens/todo-form.tsx:370`（「待办详情」）；`apps/web/src/screens/cards/schedule-cards.tsx:188,291`（「加待办」「这一天没有安排」）；`docs/01-产品与功能.md:165`（术语「条目」）；`apps/web/src/screens/settings-view.tsx:758`（删除统计无单位）；`apps/web/src/screens/cards/schedule-cards.tsx:313`（「已完成 {n}」缺单位）
- 现状：同批记录被叫「日程/待办/安排/条目」，日程在时间线显示为「其他」；量词「门/条/节/个/项/分钟」混用（「节课次」「段排课」「条排课」）。
- 改法：页面名「日程页」、记录统称「待办」、类型名用具体类型；删「其他」角标并改「日程」；固定量词表（课程=门、排课=条、上课次数=节、时间表行=节次/个、待办=条、安排=项、时长=分钟）并由 `COUNT()` 生成。
- 路径调整：无
- 布局调整：无
- 文案调整：`其他`→`日程`；`这一天没有安排`→`这一天没有待办`；`加待办`→`添加待办`；`已完成 {n}`→`已完成 {n} 项`；`已删除「X」，连带清理课程 a · 排课 b · 节次 c · 日程 d · 提醒 e`→`已删除「X」：课程 a 门、排课 b 条、节次 c 个、日程 d 条、提醒 e 条`；`当前没有课次`→`当前没有节次`（与 P1-10 同批）。
- 复用方案：复用文案资源 `copy/zh.ts` 的 `COUNT`/`UNIT_LABEL`；抽象边界＝量词由一处表驱动，调用点只传数量与类别；复用方式＝`COUNT(type, n)`；迁移步骤＝先建表，再替换统计与删除句，最后清「其他」角标；防过度抽象＝不做复数规则引擎。
- 拓展方案：无
- 优先级：P1；ICE I7 / C8 / E7（=392）
- 依赖：无（与 P1-10 同批执行）
- 验收指标：同一实体在导航、按钮、弹窗标题、toast 中名称一致；量词逐类固定；`grep 其他` 在时间线无残留；冒烟断言「已完成 {n} 项」。
- 来源：主审；分歧与裁决：05 定 SCH-14 为 P0、03 定 U30 为 P2，合并按 P1 排并列入第一批。
- 状态：待办

### [P1-13] 更新兜底补齐 `version.json`，去掉指向 `beta-latest` 的取源
- 轨道：技术演进
- 类型：扩展困难
- 位置/证据：`apps/web/src/update.ts:10-14`（发布内 `version.json` 为网络异常时唯一兜底）、`:19`（`beta` 指向从未产出的滚动标签）、`.github/workflows/publish.yml:257-287`（产物无 `version.json`）、`tools/release/plan.mjs:6`（滚动标签只有 `dev-latest`）
- 现状：GitHub API 网络异常时没有第二取源；`beta` 渠道兜底恒 404，更新检查直接失败。
- 改法：`publish.yml` 的产物步骤生成并上传 `version.json`（版本 / 渠道 / 发布说明 / 产物名）；`UPDATE_API_FEEDS.beta` 改用发布列表接口，删除 `beta-latest` 常量与相关断言。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`tools/release/plan.mjs` 的渠道与标签计算、`update.ts` 的 `compareVersions`；抽象边界=只补兜底文件与取源常量，不改渠道判定；复用方式=发布脚本写 JSON、客户端读同一路径；迁移步骤=①发布产物加 `version.json` ②客户端去 `beta-latest` ③`update.test.ts` 改断言；防过度抽象=不引入制品索引服务、不做增量清单。
- 拓展方案：无
- 优先级：P1；ICE（I5/C8/E5=200）
- 依赖：Q11（已定）
- 验收指标：`publish.yml` 产物列表含 `version.json` 且内容与标签一致；`update.test.ts` 覆盖「API 失败回退 version.json」；`grep beta-latest` 无命中。
- 来源：主审；分歧与裁决：Q11 已定：生成并上传 `version.json`，同时去掉 `beta-latest`；本轮实现：`f120fdb`（已合入 dev）。
- 状态：待验收

## 3. P2 任务

### [P2-01] 表单标签未关联控件，周视图无表格语义
- 轨道：产品体验
- 类型：可访问性
- 位置/证据：`apps/web/src/components/ui/input.tsx:23-44`（`<Field>` 内 `<Label>` 无 `htmlFor`，控件也不在 label 内）；`apps/web/src/screens/week-view.tsx:699-701,729-733,802-834,988-1078`（CSS Grid 的 `<div>` + 绝对定位课程）；全仓无 `role="grid"/"row"/"gridcell"`
- 现状：全应用 `Field`（课程表单、任务表单、设置页、调整弹窗）的标签与控件无可访问性关联；周视图读屏只是一串 button/div，课程卡不播报星期与节次。
- 改法：`Field` 用 `useId()` 生成 id，`<Label htmlFor>` 并向 children 注入 `id`/`aria-describedby`；周视图短期给课程卡 `aria-label="周三 第 3–4 节 高等数学 第 5 周 A101"`、列加 `role="group" aria-label="周一 10/19"`、时间轴 `aria-hidden`。
- 路径调整：无（语义修复，不改操作步数）
- 布局调整：不改视觉；仅补 aria 属性与列分组语义。
- 文案调整：新增课程卡与列的 aria-label，节次范围复用 `periodRange()`。
- 复用方案：复用 `Field`、`periodRange`；抽象边界＝`Field` 只负责 label/控件关联，不接管校验展示；复用方式＝`Field` 内部生成 id 并克隆 children；迁移步骤＝先改 `Field`，再补周视图 aria-label；防过度抽象＝不建表单状态库。
- 拓展方案：无（完整 ARIA grid 列第 8 节）
- 优先级：P2；ICE I6 / C7 / E8（=336）
- 依赖：无
- 验收指标：读屏聚焦每个 Field 播报字段名；每张课程卡含「星期 + 节次 + 课程名」；每列有日期组标签；新增 2 条 a11y 断言。
- 来源：主审；分歧与裁决：08b 原列 P1，本表按 P2 排，执行时随 P1 批次收尾；无实质分歧；本轮实现：`a985b10`（已合入 dev）。
- 状态：待验收

### [P2-02] 导入识别失败无直达手动映射，预览无批操作
- 轨道：产品体验
- 类型：交互反馈
- 位置/证据：`apps/web/src/screens/import-flow.tsx:242-262`（`runPage` 失败仅 `setError`）；`:755`（错误渲染在组件最底部）；`:126-148,569-649`（手动映射藏在 `<details>`）；`:536-552`（编号断裂）；`:673-731`（步骤 3 逐条勾选）；`:658-666`（裸 `<input type="file">`）
- 现状：识别失败时错误出现在页面底部，当前视野看不到；「手动指定表格」无指引；几十条排课时要逐条取消。
- 改法：失败时在粘贴框下方就地渲染错误 +「改用手动指定表格」按钮（展开并聚焦表头行输入）；步骤 3 加全选/清空/反选/只看冲突项；文件选择改按钮样式。
- 路径调整：原「失败→滚到底读错误→上翻找折叠→展开」4 步 → 新「就地错误 + 按钮」1 步。
- 布局调整：错误渲染位置由组件底部 → 紧贴操作按钮；手动映射由错误按钮展开；原因：错误必须出现在用户当前视野。
- 文案调整：`识别失败：{原因}。请换一种导入方式，或手动添加课程。`；`打开教务窗口失败：{原因}`；按钮 `改用手动指定表格`。
- 复用方案：复用 `Button`、`CollapsibleCard` 样式；抽象边界＝错误就近呈现 + 手动映射入口，不改识别逻辑；复用方式＝错误块接收 `{reason, action}`；迁移步骤＝先移错误位置，再挂按钮，最后补批操作；防过度抽象＝不做通用导入器框架。
- 拓展方案：无
- 优先级：P2；ICE I5 / C8 / E6（=240）
- 依赖：P0-04 提供入口后同批
- 验收指标：错误与「手动指定表格」同屏；步骤 3 支持全选/清空/反选；文件选择样式与设置页一致。
- 来源：主审；分歧与裁决：无；本轮实现：`a222bdd`（已合入 dev）。
- 状态：待验收

### [P2-03] 首启引导导入格式与设置页不一致，覆盖无确认
- 轨道：产品体验 + 文案
- 类型：交互反馈
- 位置/证据：`apps/web/src/screens/onboarding.tsx:234-247`（`accept="application/json,.json"` 只收 JSON）；`:75-88`（`mode:'overwrite'` 固定覆盖）；`:256-257`（「确认导入」无后果说明）；`apps/web/src/screens/settings-view.tsx:2309-2338`（设置页支持 JSON/Base64/整包 zip）
- 现状：换设备时手上的 zip 或 Base64 在引导页无法导入，只能跳过再进设置；引导页覆盖前无任何后果说明。
- 改法：引导页复用设置页 `parseImportText`/`readImportFile`（或直接复用导入弹窗），支持 zip 与文本；覆盖前加一行 `将覆盖设备上的现有数据，不可撤销`。
- 路径调整：原「引导页→跳过→应用→设置→同步与数据→导入配置→选文件」7 步 → 新「引导页→选备份→确认」3 步。
- 布局调整：沿用「已有数据：直接导入」分区，不新增页面。
- 文案调整：新增 `将覆盖设备上的现有数据，不可撤销`；`已导入 {n} 条数据`→`已导入 {n} 条记录`。
- 复用方案：复用 `apps/web/src/data-management.ts` 的 `parseImportText`/`readImportFile`；抽象边界＝导入解析只有一份实现，向导与设置页共用；复用方式＝引导页调用同一函数并给同一错误文案；迁移步骤＝先放开 `accept`，再接解析，最后补确认行；防过度抽象＝不抽「导入向导复用框架」。
- 拓展方案：无
- 优先级：P2；ICE I5 / C7 / E6（=210）
- 依赖：无
- 验收指标：引导页可导入 zip/Base64/JSON；覆盖前有确认；导入后直接进已建学期的课表。
- 来源：主审；分歧与裁决：无；本轮实现：`19062ae`（已合入 dev）。
- 状态：待验收

### [P2-04] 表单校验、忙碌态与移动端弹层形态
- 轨道：产品体验
- 类型：交互反馈
- 位置/证据：`apps/web/src/screens/course-form.tsx:220-232`（`name` 允许空串）、`:493`（错误只在 catch 展示）；`packages/core/src/mutations.ts:442-464`（`createCourse` 不校验名称）；`apps/web/src/components/ui/button.tsx:36-38,55-58`（`loading` 支持）、全仓仅 `apps/web/src/screens/settings-view.tsx:1280` 使用 `loading=`；`apps/web/src/lib/busy.ts:51-72`（`useBusyAction` 未被使用）；`apps/web/src/App.tsx:1111`、`apps/web/src/components/ui/sheet.tsx:26-35`（全仓唯一 Sheet）
- 现状：课程名留空可保存出空白课卡；保存类按钮 busy 时只变灰无转圈；移动端 24 处表单弹层为居中 Dialog，仅课程详情用底部 Sheet。
- 改法：`name.trim()` 为空时禁用保存并给字段错误，core 侧补 `RangeError`；提交按钮统一 `loading={busy}`（或改用 `useBusyAction`）并带 `aria-busy`；移动端短表单分批改底部 Sheet（本轮 2–3 个高频：加课、加待办、课程调整）。
- 路径调整：不增步骤。
- 布局调整：24 处居中 Dialog → 高频短表单底部 Sheet（桌面仍 Dialog）；原因：移动端底部 Sheet 手指可达、键盘避让更好。
- 文案调整：新增 `课程名不能为空`。
- 复用方案：复用 `Button loading`、`Sheet`、`useBusyAction`（未用则删）；抽象边界＝表单提交态与容器形态两件事分开复用；复用方式＝提交按钮统一 `loading`，容器按端切换；迁移步骤＝先补校验，再接 loading，最后改 2–3 个 Sheet；防过度抽象＝不做表单框架。
- 拓展方案：无
- 优先级：P2；ICE I4 / C8 / E8（=256）
- 依赖：无
- 验收指标：空名保存按钮禁用且 core 拒绝；提交按钮 busy 有转圈与 `aria-busy`；移动端 2–3 个表单为底部 Sheet。
- 来源：主审；分歧与裁决：无。本轮实现：`5d88f75`（合入 `dc898d8`）。
- 状态：待验收

### [P2-05] 键盘与触控可达性
- 轨道：产品体验
- 类型：可访问性
- 位置/证据：`apps/web/src/screens/week-view.tsx:605-637,1014-1017`（拖拽只有 Pointer）；`:954-971`（`role="spinbutton"` 无 `onKeyDown`）；`apps/web/src/App.tsx:499-518`（全局快捷键只排除 INPUT/TEXTAREA/SELECT）；`apps/web/src/screens/week-view.tsx:941-953`（`size-4`=16px）、`:906-909`（`size-5`=20px）；`apps/web/src/screens/cards/schedule-cards.tsx:395-401`（勾选 16px）；`apps/web/src/mini/shell.tsx:29`（关闭按钮无最小尺寸）；`docs/04-界面与文案规范.md:54`（44px 触控口径）
- 现状：键盘用户无法拖拽调课，声明的 spinbutton 不响应方向键；弹窗打开时 ←/→/T 仍改背景、`/` 可叠出第二层搜索；多个高频控件命中区 16–20px。
- 改法：spinbutton 补 ↑/↓/Enter/Esc（或改为两个按钮）；课程卡键盘「移动模式」后续，先保留详情→调课等价路径；全局 keydown 增加弹窗守卫（存在 `[role="dialog"]` 时只处理 Esc）；16–20px 控件加透明外扩到 44px。
- 路径调整：无（键盘路径与指针路径等价，不加步骤）
- 布局调整：16–20px 命中区 → 44px 命中区（视觉尺寸不变，padding 外扩）；原因：触控与运动障碍用户可达。
- 文案调整：无
- 复用方案：复用 `Button` 的 tap 尺寸令牌与 `--dt-tap`；抽象边界＝命中区只外扩不改视觉；复用方式＝统一 `min-h-tap min-w-tap`；迁移步骤＝先补 keydown 守卫，再改 spinbutton，最后逐控件外扩；防过度抽象＝不做全局焦点管理框架。
- 拓展方案：无
- 优先级：P2；ICE I6 / C7 / E6（=252）
- 依赖：无
- 验收指标：spinbutton 可键盘操作且 `aria-valuenow` 更新；弹窗打开时背景不动且 `/` 不叠层；全部可点控件 ≥44px。
- 来源：主审；分歧与裁决：无。
- 状态：待办

### [P2-06] 周视图/日视图边界与日视图不可交互
- 轨道：产品体验
- 类型：一致性
- 位置/证据：`apps/web/src/App.tsx:1063-1064,948-949`（周翻屏无边界判断）、`apps/web/src/data.ts:245`（标题周次夹在学期内而窗口继续）；`apps/web/src/components/app-toolbar.tsx:76-87`（周翻页无 `disabled`）；`:90,96`（日模式有 `canPrev/canNext`）；`apps/web/src/screens/today-view.tsx:84-118`（课节 `<li>` 无 `onClick`）、`apps/web/src/screens/week-view.tsx:1019-1075`（课程卡为 button 可点）
- 现状：周模式可翻到学期外，标题仍显示边界周；两种模式边界处理不一致；日视图同一节课不可点开详情与调课。
- 改法：周模式计算可翻范围、边界禁用 ‹ ›、学期外显示「学期外」水印与「回到学期内」；日视图课程行改为可点（`role="button"` + Enter/Space）并复用 `openLesson`/调课入口。
- 路径调整：原「日视图看课→切周视图→找课→点开→调课」5 步 → 新「日视图点课→调课」2 步。
- 布局调整：周翻页加禁用态与学期外水印；原因：边界状态必须可见且不可越过。
- 文案调整：新增 `学期外`、`回到学期内`。
- 复用方案：复用 `openLesson`/`openAdjustForLesson`、日模式 `canPrev/canNext` 口径；抽象边界＝两种模式的翻页边界判定合一；复用方式＝抽 `canStep()` 供两个工具栏共用；迁移步骤＝先统一边界判定，再补日视图可点；防过度抽象＝不做视图配置表。
- 拓展方案：无
- 优先级：P2；ICE I5 / C7 / E6（=210）
- 依赖：学期边界口径待 Q6
- 验收指标：第 1 周与最后一周 ‹ › 正确禁用；学期外不显示「第 N 周」；日视图课程行可键盘打开详情。
- 来源：主审；分歧与裁决：无；Q6 已定：停在学期边界，边界 ‹ › 置灰，不加学期外水印。。
- 状态：待办

### [P2-07] 卡片布局「侧列」对设置页不生效，布局入口重复
- 轨道：产品体验
- 类型：一致性
- 位置/证据：`apps/web/src/screens/cards/layout-panel.tsx:165-176`（主列/侧列切换按钮两页共用）；`apps/web/src/screens/settings-view.tsx:2045-2060`（设置页忽略 `card.zone`，全部单列）；`apps/web/src/screens/settings-view.tsx:2032-2043`（顶部布局入口）、`:1345-1349`（外观卡内重复入口）
- 现状：用户把设置页卡片切到「侧列」无任何变化；外观卡内入口在卡片被隐藏时消失，用户不确定「卡片布局」到底在哪。
- 改法：设置页实现两列（`desktop:grid-cols-[2fr_1fr]`）或从设置卡行移除区域按钮（只留显隐与顺序）；删除外观卡内入口，保留顶部入口并在外观卡写明 `卡片显隐在顶部「卡片布局」`。
- 路径调整：原「外观→打开卡片布局」3 步 → 新「设置→卡片布局」2 步（入口唯一）。
- 布局调整：单列 + 无效侧列控件 → 两列生效，或控件不出现；原因：可见控件必须有效。
- 文案调整：新增 `卡片显隐在顶部「卡片布局」`。
- 复用方案：复用 `layout-panel.tsx` 与 `registry.ts` 的 `setCardZone` 纯函数；抽象边界＝布局面板唯一，两页只决定是否显示；复用方式＝设置页消费 `card.zone`；迁移步骤＝先删重复入口，再实现两列或移除控件；防过度抽象＝不做每页独立布局引擎。
- 拓展方案：无
- 优先级：P2；ICE I4 / C8 / E8（=256）
- 依赖：无
- 验收指标：侧列切换要么生效要么不出现；布局入口全仓唯一；隐藏外观卡后仍可进入卡片布局。
- 来源：主审；分歧与裁决：无。
- 状态：待办

### [P2-08] 三端悬浮窗与小组件：点不开主窗口、描述与渲染不符、空态错位
- 轨道：产品体验 + 文案
- 类型：一致性
- 位置/证据：`apps/web/src/mini/shell.tsx:14-35`（整窗拖拽区，只有关闭按钮）、`apps/desktop/src-tauri/src/lib.rs:1385-1400`（`show_widget`/`hide_widget`，无打开主窗口命令）；`apps/web/src/widget-pin.ts:12-17`（`week` 描述「整周的课表格子」）、`apps/mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetRenderer.kt:191-239`（文本列表，最多 7 行，放不下整行不渲染）；`apps/web/src/mini/main.tsx:250-261,197-202`（`showTomorrow` 时仍写「今天没有课啦」）
- 现状：Windows 悬浮窗只能看、拖、关，想打开应用要去找托盘，Android 小组件点一下即开应用；4×4 宣传为课表格子实为文本列表；明日预告区仍显示「今天没有课啦」。
- 改法：Windows 悬浮窗双击打开主窗口（新增 `show_main` 命令）；4×4 文案改「一周课程清单」并补「还有 N 节」；空态按 `showTomorrow` 分支「今天没有课了 / 明天也没有课」。
- 路径调整：原「悬浮窗→找托盘/开始菜单」2–3 步 → 新「双击悬浮窗」1 步。
- 布局调整：悬浮窗标题栏加「打开」或整窗双击语义；原因：悬浮窗是常用入口，不应只出不进。
- 文案调整：`整周的课表格子`→`一周课程清单`；`今天没有课啦`→`今天没有课了`/`明天也没有课`；`余 {remaining}`→`剩余 {remaining}`。
- 复用方案：复用窗口命令与 `previewLabel`；抽象边界＝桌面唤醒走一个命令，三端呈现各自实现；复用方式＝`show_main` 命令复用现有窗口句柄；迁移步骤＝先加命令，再接双击，最后改文案；防过度抽象＝不做多窗口管理器。
- 拓展方案：无（完整多窗口焦点列第 8 节）
- 优先级：P2；ICE I4 / C7 / E6（=168）
- 依赖：无
- 验收指标：Windows 双击 1 秒内主窗口前置；关闭按钮仍只隐藏；小组件描述与内容一致且溢出显示「还有 N 节」；四种组合空态文案正确。
- 来源：主审；分歧与裁决：无。本轮实现：`42552a3`（合入 `53146b9`）。
- 状态：待验收

### [P2-09] 数据、平台与渠道名词统一
- 轨道：文案
- 类型：一致性
- 位置/证据：`apps/web/src/screens/settings-view.tsx:446-449`（远端「已有备份/还没有备份」）；`apps/web/src/screens/settings-view.tsx:1609,1628`（快照与恢复）；`apps/web/src/screens/settings-view.tsx:1545,1599,2233`（预设/整包/快照混用）；`apps/web/src/screens/settings-view.tsx:1244,1246,1385`（桌面小组件/小组件背景）；`apps/web/src/channel.ts:14-17`、`apps/web/src/screens/settings-view.tsx:1810,1820`（渠道多套写法）；`apps/web/src/screens/settings-view.tsx:129-130`（实现接口名进正文）；`apps/mobile/android/app/src/main/res/values/strings.xml:11,14-15`（尚未同步数据/本周课表）；`apps/web/src/widget-pin.ts:12-17`（一周概览）
- 现状：本地自动份、远端包、导出文件都叫「备份」；「整包/快照/预设/作息/时间表」交叉；Android 叫「本周课表」而 Web 叫「一周概览」；渠道出现「测试版/beta 版/dev 构建/公测版/正式版」；接口名与目录名进用户界面。
- 改法：本地自动份一律「快照」，导出文件与远端包一律「备份」，覆盖动作一律「恢复」；数据包＝预设，一天的节次安排＝作息；Android 统一「主屏小组件」及尺寸名并与 Web 对齐；渠道只用开发版/公测版/正式版；接口名与 `backups` 目录改中文表述并进日志。
- 路径调整：无
- 布局调整：无
- 文案调整：`远端还没有备份`→`远端暂无备份`；`整库文件快照（数据目录 backups）`→`整库文件快照（保存在数据目录）`；`桌面小组件`→`主屏小组件`；`默认关闭；开启后才会收到 beta 版`→`默认关闭；开启后还会收到公测版`；`开发渠道：只接收 dev 构建，不参与测试版开关`→`开发版只接收开发构建，不受此开关影响`；`测试版提示`→`公测版提示`；`尚未同步数据`→`尚未创建学期`；`本周课表`→`一周概览`；`GitHub contents 接口`/`raw.githubusercontent.com`→`预设仓库（GitHub）`。
- 复用方案：复用 `CHANNEL_LABEL`、`WIDGET_LABEL`、`BACKUP_MODULE_LABEL`，原生侧保留 `strings.xml` 原位；抽象边界＝标签映射单点，渲染不动；复用方式＝调用点只取映射值；迁移步骤＝先建三张标签表，再逐区域替换，最后改 `strings.xml`；防过度抽象＝不做术语词典校验工具。
- 拓展方案：无
- 优先级：P2；ICE I7 / C8 / E6（=336）
- 依赖：无
- 验收指标：同一对象全仓一词；渠道只用三词；小组件尺寸名两端一致；`grep beta`/`grep dev 构建` 在界面文案中无残留。
- 来源：主审；分歧与裁决：08b 原列 P1，本表按 P2 排；无实质分歧。
- 状态：待办

### [P2-10] 文风与重复清理：口语、解释式长句、`title`、快捷键事实
- 轨道：文案
- 类型：文案文风
- 位置/证据：`apps/web/src/components/nav.tsx:63`（「← → 切周」事实错误）；`apps/web/src/screens/settings-view.tsx:1965`（关于页重复快捷键且说法不同）；`apps/web/src/screens/settings-view.tsx:1139`（与 `:1096` 重复）；`apps/web/src/screens/settings-view.tsx:1884`（日志级别说明与下拉项重复）；`apps/web/src/screens/settings-view.tsx:1355-1356`（明日预告标签与 hint 同义）；`apps/web/src/screens/settings-view.tsx:1545`（与 `:1888` 重复）；`apps/web/src/components/app-toolbar.tsx:115`、`apps/web/src/screens/week-view.tsx:962`、`apps/web/src/mini/shell.tsx:29`、`apps/web/src/screens/import-flow.tsx:595`（`title` 承载说明）；`apps/web/src/mini/main.tsx:261`（「今天没有课啦」）；`apps/web/src/screens/onboarding.tsx:193`、`apps/web/src/screens/settings-view.tsx:1967-1969`、`apps/web/src/components/adjust-dialog.tsx:372`、`apps/web/src/screens/todo-form.tsx:533`、`apps/web/src/screens/settings-view.tsx:1651`（长说明无出口）
- 现状：侧栏与关于页两处快捷键且对 ← → 说法不同；同一说明重复 4 组；4 处 `title` 承载操作说明（触屏不可见、读屏不稳）；35+ 汉字解释句留在正文；全站 `HelpHint` 仅 4 处使用。
- 改法：快捷键只在侧栏保留一处并改对事实；删重复句；`title` 改 `aria-label` + `HelpHint`；长说明按「hint ≤20 汉字 + help」拆分；口语尾字改正式语气。
- 路径调整：无
- 布局调整：无
- 文案调整：`快捷键 ← → 切周，T 回今天，/ 搜索`→`快捷键：/ 搜索 · ← → 平移一屏 · T 回到今天`；删除关于页快捷键行；`今天没有课啦`→`今天没有课`；跳过说明改正文 `跳过会建一个「我的学期」（本周一开学、20 周）` + help；`学校适配与作息在独立仓库…维护，缺适配时可提交学校信息。`→`缺少学校适配？提交学校信息` + help；调休示例改 help `调休后，目标日按原日课表上课`；重复选周说明改 hint `每周重复按上面的「星期」` + help；WebDAV hint 改 `WebDAV 目录 URL` + help 示例；删除日志级别说明行、`预设来源：dawn-tick-presets` 与重复的课前提醒说明；`无课时显示明日课程`/`空日程提示明日预告`→标签 `明日课程预告` + hint `当天没课或课上完时显示`。
- 复用方案：复用 `HelpHint`（`apps/web/src/components/ui/help-hint.tsx:9`）、`Field help`；抽象边界＝短提示与长帮助两个承载位，不新增第三种；复用方式＝所有 `title` 改为 hint + help；迁移步骤＝先改快捷键事实，再清重复，最后批量迁 `title`；防过度抽象＝不做文档内嵌帮助系统。
- 拓展方案：无
- 优先级：P2；ICE I5 / C8 / E7（=280）
- 依赖：无（P2-09 完成后统一收口）
- 验收指标：交互控件无 `title`；同一说明全仓只出现一次；正文说明 ≤20 汉字或进 help；`grep title=` 在交互组件上为 0。
- 来源：主审；分歧与裁决：`title` 计数 03 记 4 处、05 §4.8 记 3 处，按并集 4 处执行；08b 原列 P1，本表按 P2 排。
- 状态：待办

### 3.1 待验收项（5 条）

#### [P2-11] Windows 便携版与安装版启动回归
- 轨道：技术演进
- 类型：一致性
- 位置/证据：`apps/desktop/src-tauri/Cargo.toml:22-29`（http 插件只启 rustls-tls/http2/charset/system-proxy，去掉 cookies）、`apps/web/src/webdav.ts:67`（Windows 仍走该插件 fetch）
- 现状：特性已裁剪，仓库内没有启动日志或断言证明不再出现 `failed to initialize plugin http: 拒绝访问`，`cargo check` 覆盖不到运行期初始化。
- 改法：便携版（`DawnTick.exe` 放普通目录）与安装版各启动一次，各取 `dawn-tick.log` 首 20 行，两段日志作为发布验收附件。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：无（纯验收项）
- 拓展方案：无
- 优先级：P2；ICE（I3/C8/E9=216）
- 依赖：无
- 验收指标：两版启动日志均无 `failed to initialize plugin http`，主窗口出现，WebDAV 探测一次成功。
- 来源：主审+盲审；分歧与裁决：主审与体验盲审判待验收，技术盲审判已验收（代码可复核），按删除准入硬规则保留为待验收。
- 状态：待验收

#### [P2-12] 诊断日志验收：布局自检字段与日志级别透传
- 轨道：技术演进
- 类型：一致性
- 位置/证据：`apps/web/src/App.tsx:586-621`、`apps/web/src/screens/week-view.tsx:333-347`（`layout: 视口变化` / `行高自适应` / `行高自检`）；`apps/web/src/App.tsx:442-445`、`apps/web/src/log.ts:31-43`、`apps/desktop/src-tauri/src/lib.rs:897-915`（级别同步原生）
- 现状：日志已写，仓库内无断言，也没有实机日志片段；级别透传调用已补，缺运行期证据。
- 改法：①冒烟 stub 日志并断言 resize 后出现 `layout: 视口变化`，`navHeight`/`mainPadBottom` 为数字 ②单测断言级别变化后门槛按新级别过滤 ③Windows 取一段含 `[debug]`/`[trace]` 的 `dawn-tick.log`。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：无（验收项；断言复用现有冒烟日志 stub）
- 拓展方案：无
- 优先级：P2；ICE（I3/C8/E8=192）
- 依赖：无
- 验收指标：新增 ≥2 条冒烟断言 + 1 条单测用例 + 一段 Windows 实机日志；`layout: 行高已到上限仍有内容被裁` 的告警分支有对应用例。
- 来源：主审+盲审；分歧与裁决：主审与体验盲审判待验收；技术盲审对 O-15 判已验收，按硬规则保留为待验收。
- 状态：待验收

#### [P2-13] EBWebView 目录搬迁与窗口几何恢复
- 轨道：技术演进
- 类型：一致性
- 位置/证据：`apps/desktop/src-tauri/src/lib.rs:1186-1221`（WebView2 目录）、`:2558-2650`（窗口几何存取）、`:2702-2706`（启动时清理 `window.json`）
- 现状：几何解析有 Rust 用例，EBWebView 搬迁（首次把旧 `<数据目录>\EBWebView` 搬到 `%LOCALAPPDATA%`、目标已有数据清残留、搬迁失败继续用旧位置）没有用例，也没有实机记录。
- 改法：补 `ensure_webview_folder_writable` 相关用例（搬迁成功 / 目标已有 / 失败回退），再实机确认便携目录无 `EBWebView` 与 `window.json`、启动按上次几何恢复。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：无（验收项）
- 拓展方案：无
- 优先级：P2；ICE（I3/C7/E7=147）
- 依赖：无
- 验收指标：3 条 Rust 用例通过；实机启动无窗口跳动、便携目录干净。
- 来源：主审+盲审；分歧与裁决：技术盲审判已验收，主审与体验盲审判待验收，按硬规则保留。
- 状态：待验收

#### [P2-14] Android 真机验收：明文 http、外部链接、通知与精确闹钟
- 轨道：技术演进
- 类型：一致性
- 位置/证据：`apps/mobile/android/app/src/main/AndroidManifest.xml:11/107-118`（`usesCleartextTraffic`、`<queries>`）、`:123-130`（通知与精确闹钟）、`SystemActionsPlugin.java:31-54`（外部链接走 `ACTION_VIEW`）、`apps/web/src/permissions.ts:96-113`、`apps/web/src/App.tsx:461-471`、`apps/web/src/screens/settings-view.tsx:1049-1091`
- 现状：清单、插件与界面链路齐全，缺 Android 11+/13+ 真机记录。
- 改法：真机一次走完：导入 http 教务站点、点击外部链接、首启通知弹窗、拒绝后的「申请通知权限 / 去系统设置」、精确闹钟未授权跳转、电池优化白名单入口。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：无（验收项）
- 拓展方案：无
- 优先级：P2；ICE（I4/C8/E6=192）
- 依赖：无
- 验收指标：导入无 `ERR_CLEARTEXT_NOT_PERMITTED`；外部链接由系统浏览器打开；通知六态至少三态在界面可见；精确闹钟未授权时跳一次系统页。
- 来源：主审+盲审；分歧与裁决：O-26 技术盲审判已验收，主审与体验盲审判待验收，按硬规则保留。
- 状态：待验收

#### [P2-15] 倒计时 15 秒节拍刷新
- 轨道：技术演进
- 类型：一致性
- 位置/证据：`apps/web/src/screens/cards/schedule-cards.tsx:555-558`、`apps/web/src/lib/use-now.ts:1-11`
- 现状：实现存在，冒烟没有时间流逝断言，无法阻止回归为「等别处数据刷新」。
- 改法：用 fake timers 推进 15 秒，断言剩余天数文本重渲染且不触发整页数据重载。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：无（验收项）
- 拓展方案：无
- 优先级：P2；ICE（I3/C8/E8=192）
- 依赖：无
- 验收指标：新增用例推进 15s 后倒计时文本变化；数据层调用次数不变。
- 来源：主审+盲审；分歧与裁决：三路一致判待验收。
- 状态：待验收

### [P2-16] 导入预览支持只看冲突项
- 轨道：产品体验
- 类型：交互反馈
- 位置/证据：`apps/web/src/screens/import-flow.tsx`（预览已有全选/清空/反选，无冲突筛选）；`packages/core/src/import/apply.ts`（重复判定只在写入阶段发生）
- 现状：预览看不到哪些条目会因重复被跳过，用户只能在导入后看「跳过 N 条」。
- 改法：把 `applyImport` 的重复判定抽成可预览的纯函数（或先读现有课程与排课做预检），预览页增加「只看冲突」筛选并逐条标注「重复，将被跳过」。
- 路径调整：无
- 布局调整：预览列表上方加筛选开关；原因：冲突项通常占少数，默认仍显示全量。
- 文案调整：`跳过 N 条`→冲突条目标「重复，将被跳过」；筛选按钮「只看冲突」。
- 复用方案：复用对象=`packages/core/src/import/apply.ts` 的重复判定、`import-flow.tsx` 的预览勾选逻辑；抽象边界=只读预检，不改变写入策略；复用方式=导出 `previewDuplicates(storage, semesterId, schedules)` 纯函数；迁移步骤=①抽纯函数 ②预览标注 ③筛选开关 ④补单测；防过度抽象=不建导入规则引擎。
- 拓展方案：无
- 优先级：P2；ICE（I4/C6/E5=120）
- 依赖：P2-02（已合入）
- 验收指标：预览标出将被跳过的条目；「只看冲突」过滤正确；core 单测覆盖「预检结果与写入跳过一致」。
- 来源：主审；分歧与裁决：P2-02 实现时验收指标只要求全选/清空/反选，冲突筛选单列本条。本轮实现：`72d8c05`（已合入 dev）。
- 状态：待验收

### [P2-17] 移动端高频短表单改底部 Sheet

- 轨道：产品体验
- 类型：交互反馈
- 位置/证据：`apps/web/src/screens/course-form.tsx`、`apps/web/src/screens/todo-form.tsx`、`apps/web/src/components/adjust-dialog.tsx`、`apps/web/src/components/ui/sheet.tsx`（现只有 mini 与课程详情用 Sheet）
- 现状：P2-04 本轮只交付课程名校验与提交忙碌态，移动端 24 处表单弹层仍是居中 Dialog。
- 改法：加课、加待办、调课三个高频短表单在移动端（宽度断点判断）换成底部 Sheet，桌面仍用 Dialog；容器切换集中在 App 的挂载处，表单组件只换容器不重写逻辑。
- 路径调整：不增步骤。
- 布局调整：移动端居中 Dialog → 底部 Sheet；原因：手指可达、键盘避让更好。
- 文案调整：无
- 复用方案：复用 `components/ui/sheet.tsx` 的 bottom 形态与 `useMediaQuery`；抽象边界＝容器形态与表单逻辑分开；防过度抽象＝不做表单框架。
- 拓展方案：无
- 优先级：P2；ICE（I4/C7/E7=196）
- 依赖：P2-04（已合入校验与 busy 部分）
- 验收指标：移动视口下三个表单位为底部 Sheet、键盘不挡提交按钮；冒烟新增 1 条移动视口断言。
- 来源：P2-04 拆分；分歧与裁决：本轮因 App.tsx 被并行任务占用而顺延。
- 状态：待办

## 4. 功能拓展路线

### 4.1 低成本快赢（R-01…R-04）

#### [R-01] ICS 课表导出入口
- 轨道：功能拓展
- 类型：能力补全（core 已实现、缺 UI）
- 位置/证据：`docs/01-产品与功能.md:60` 写明 ICS「导入与导出」；`packages/core/src/import/ics.ts:122` 的 `exportIcs` 在 `apps/` 无生产调用（仅 `packages/core/test/import-ics.test.ts:73`）；导入侧已有 `import-flow.tsx:12/280` 的 `icsToSchedules`
- 现状：能导入不能导出；core 导出函数与测试已就绪，缺设置页入口与文件保存。
- 改法：设置页「同步与数据」卡加「导出课表（ICS）」，读取当前学期、课程/排课与节次后调 `exportIcs`，用 `saveTextFile`（`system-actions.ts:205`）保存 `.ics`。
- 路径调整：设置→同步与数据→导出配置，改为设置→同步与数据→导出课表（ICS）
- 布局调整：导出按钮组增加 1 个按钮
- 文案调整：新增「导出课表（ICS）」「已导出 N 门课程」
- 复用方案：复用对象=`exportIcs`（`ics.ts:122`）与 `import-ics.test.ts:73` 的往返样例；抽象边界=core 只生成文本、web 只取数与保存，不建导出格式框架；复用方式=按钮 → 取 `AppData` → `exportIcs` → `saveTextFile`；迁移步骤=①按钮 ②取数 ③生成 ④保存 ⑤冒烟 1 条；防过度抽象（不抽什么）=不建导出器注册表、不引入第三方日历库。
- 拓展方案：阶段=快赢；场景=换日历与交接课表；价值=补齐文档承诺；复杂度=低（1–2 天）；扩展点=`exportIcs` 已存在；风险=导出范围（调课/放假/自定义时间）需先定义。
- 优先级：P1；ICE（I4/C9/E9=324）
- 依赖：无
- 验收指标：可导出 `.ics`；再导入后课程/排课/周次与导出前一致；冒烟新增 1 条。
- 来源：主审；分歧与裁决：无
- 状态：待办

#### [R-02] 「我的」页面上线
- 轨道：功能拓展
- 类型：占位补全
- 位置/证据：`apps/web/src/App.tsx:998-1003` 只有「我的」「建设中」；旧 TODO 条目 O-10 待办；`AppData` 已含课程/待办/考试/学期（`data.ts:111-153`）
- 现状：导航第四项无内容，数据入口全挤在设置页。
- 改法：新建 `apps/web/src/screens/mine-view.tsx`，复用 App 已加载的 `AppData` 渲染学期与周次、本周课次/待办/考试计数、数据与关于快捷入口。
- 路径调整：底栏「我的」由空白占位改为概览与快捷入口
- 布局调整：占位两行改为概览卡 + 入口列表（复用 `Card`/`CollapsibleCard`）
- 文案调整：「建设中」改为区块标题，入口名沿用设置页现有词
- 复用方案：复用对象=`AppData`（`data.ts:111-153`）、`Card`/`EmptyState`、`channel.ts:32` 的 `appVersion`；抽象边界=只做展示与跳转，不新增数据加载、不复制设置页逻辑；复用方式=路由分支渲染 `MineView`，props 只传 `data` 与 `onNavigate`；迁移步骤=①`App.tsx:998` 分支 ②组件 ③入口跳转 ④冒烟覆盖四页切换；防过度抽象（不抽什么）=不建个人中心框架、不做权限/账号区块（留待 R-08）。
- 拓展方案：阶段=快赢；场景=查看概览、找数据入口；价值=补齐导航空位、少一层设置；复杂度=低（1–2 天）；扩展点=`App.tsx:998` 分支；风险=与设置页职责重叠。
- 优先级：P1；ICE（I4/C9/E9=324）
- 依赖：无
- 验收指标：四页导航无占位；概览数字与课表/日程页一致；冒烟覆盖切换。
- 来源：主审；分歧与裁决：无
- 状态：待办

#### [R-03] Windows 悬浮窗增加考试倒计时样式
- 轨道：功能拓展
- 类型：端能力对齐
- 位置/证据：`packages/core/src/settings.ts:8-9` 四种 Windows 样式无考试；`apps/web/src/mini/main.tsx:227-343` 只有 minimal/today/combo 分支；`apps/desktop/src-tauri/src/lib.rs:1373-1383` 为尺寸表；Android 已有考试组件（`widget-pin.ts:16-17`），快照已含 `exams`（`widget-snapshot.ts:25-44`）
- 现状：Windows 用户要看考试倒计时必须打开主窗。
- 改法：`WidgetVariant` 增加 `exam`（或在 combo 中增加考试行），`mini/main.tsx` 用 `WidgetExam` 渲染最近考试与剩余天数，Rust `widget_size` 增加尺寸，设置页加标签。
- 路径调整：设置→外观→悬浮窗样式新增「考试倒计时」
- 布局调整：新增一种悬浮窗尺寸
- 文案调整：「考试倒计时」「距考试 N 天」
- 复用方案：复用对象=`widget-snapshot.ts:25-44` 的 `exams`、`lib/format.ts:30` 的 `formatDayCountdown`、`WIDGET_VARIANTS` 与 `lib.rs:1373-1383` 尺寸表；抽象边界=只加一个 variant 与一条渲染分支，不新建桌面组件框架；复用方式=variant 枚举 + 渲染分支 + Rust 尺寸表三处同步；迁移步骤=①确认快照有 `exams` ②`mini/main.tsx` 渲染 ③Rust 尺寸 ④设置项 ⑤冒烟；防过度抽象（不抽什么）=不做通用卡片布局引擎、不为悬浮窗建主题系统（主题联动见 R-04）。
- 拓展方案：阶段=快赢；场景=不打开主窗看考试；价值=与 Android 对齐；复杂度=低（1–2 天，含 Rust 重编译）；扩展点=variant 枚举；风险=多屏缩放需验证。
- 优先级：P1；ICE（I3/C8/E8=192）
- 依赖：无
- 验收指标：切换后悬浮窗显示最近考试与剩余天数；无考试时给空态。
- 来源：主审；分歧与裁决：无
- 状态：待办

#### [R-04] 主题预设联动悬浮窗与 Android 小组件
- 轨道：功能拓展
- 类型：视觉一致性
- 位置/证据：`WidgetRenderer.kt:35-50` 颜色为固定常量；快照只带 `background` 三值（`widget-snapshot.ts:35`、`WidgetStore.kt:32-38`）；悬浮窗只用 `mini-bg-${background}`（`mini/shell.tsx:23`）
- 现状：切换 vivid/fresh/mono/muted 不影响小组件与悬浮窗，只受「小组件背景」深浅/透明影响。
- 改法：快照新增可选 `theme` 与 3–4 个语义色（web 从 `design/tokens.ts:251` 取值），Kotlin `applyTheme` 优先快照色、旧快照回退常量；悬浮窗读当前主题。
- 路径调整：无
- 布局调整：无
- 文案调整：「小组件背景」补「颜色跟随主题，背景仍可选」
- 复用方案：复用对象=`design/tokens.ts:251` 主题色、`widget-snapshot.ts` 契约；抽象边界=只放 3–4 个颜色，不搬运整套语义色；复用方式=快照可选字段 + Kotlin 优先读取 + 常量回退；迁移步骤=①快照字段 ②Kotlin 读取 ③回退 ④真机验证；防过度抽象（不抽什么）=不把 20 个语义色全塞快照、不建跨端主题引擎（配色契约检查见 A-15）。
- 拓展方案：阶段=中期快赢；场景=换主题后组件一致；价值=视觉一致性；复杂度=中（含真机）；扩展点=快照契约；风险=旧快照兼容与设备验证。
- 优先级：P2；ICE（I3/C7/E6=126）
- 依赖：A-15（原 PLT-03/PLT-04，快照契约与配色对齐同源，先有检查脚本再改字段）
- 验收指标：切主题后小组件颜色变化；旧快照不报错。
- 来源：主审；分歧与裁决：无
- 状态：待办

### 4.2 中期增强（R-05…R-07）

#### [R-05] 教务系统在线抓取（D30）
- 轨道：功能拓展
- 类型：导入链路增强
- 位置/证据：`docs/01-产品与功能.md:151` 未完成 D30；现状只有内嵌窗口手动流程（`import-window.ts:37/82`、`lib.rs:962`），页面识别 `page-tables.ts:333`，注入协议 `import-injection.js:1-122`；无登录/抓取模块
- 现状：用户需在窗口内登录后自己复制页面或走通用识别，步骤多、成功率依赖页面形态。
- 改法：一期在内嵌窗口加「抓取本页」按钮，复用注入协议回传 HTML 交给 `extractTimetableFromHtml` 预览导入；凭据仍由用户在窗口内输入，应用不保存。
- 路径调整：导入→网页课表→内嵌窗口→登录→抓取本页→预览，比现状少「复制/粘贴」两步
- 布局调整：步骤 1 加按钮
- 文案调整：「抓取本页」「登录在窗口内完成，应用不保存密码」
- 复用方案：复用对象=`import-injection.js`、`page-tables.ts:333` 页面识别、`import-submit.ts` 回传通道；抽象边界=只加「抓取本页」动作，协议与解析沿用，不建通用爬虫框架；复用方式=按钮触发注入脚本采集 → 回传 → 现有解析 → 预览；迁移步骤=①协议复用验证 ②按钮 ③回传 ④解析 ⑤预览；防过度抽象（不抽什么）=不做站点适配器注册表、不做会话持久化。
- 拓展方案：阶段=中期；场景=教务课表导入；价值=减少手工复制；复杂度=中高（站点差异/登录态）；扩展点=页面识别器；风险=验证码与隐私合规。
- 优先级：P1；ICE（I5/C5/E4=100）
- 依赖：抓取凭据与合规（Q15）
- 验收指标：至少 1 个内置学校可在窗口内一键抓取并预览导入；失败给下一步提示。
- 来源：主审；分歧与裁决：无
- 状态：待确认

#### [R-06] 调课实时推送（M10）
- 轨道：功能拓展
- 类型：多端一致性
- 位置/证据：`docs/01-产品与功能.md:150` 未完成 M10；当前无推送通道（`package.json` 无 WebSocket/推送依赖），只有本地刷新（`App.tsx:520-526`）与 WebDAV 定时同步（`App.tsx:421-440`、`webdav.ts:326`）
- 现状：一端调课后，另一端要等下次启动或手动刷新。
- 改法：服务端就绪后由事件推送；过渡期用 WebDAV `Last-Modified` 轮询（`webdav.ts:101`）降级。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`sync.ts` 游标与 `webdav.ts:101` 的远端时间戳；抽象边界=只做「检查远端是否变化→触发拉取」，不先建消息总线；复用方式=定时器 + 远端时间戳比较 + 复用现有同步入口；迁移步骤=①轮询降级 ②服务端事件替换；防过度抽象（不抽什么）=不建推送网关/消息总线、不引入 WebSocket 依赖。
- 拓展方案：阶段=中期（依赖服务端）；场景=多设备课表同步；价值=减少信息滞后；复杂度=高；扩展点=服务端事件；风险=无服务端时无法验收。
- 优先级：P2；ICE（I4/C4/E3=48）
- 依赖：R-08（当前暂不做）
- 验收指标：一端调课后另一端 1 分钟内可见（或明确降级为轮询）。
- 来源：主审；分歧与裁决：无
- 状态：暂不做

#### [R-07] 提醒动作与投递链（贪睡/完成/勿扰）
- 轨道：功能拓展
- 类型：提醒闭环
- 位置/证据：`docs/01-产品与功能.md:76-78` 声称贪睡、勿扰分级、声音与震动；实际 `notify.ts:49-86` 只传 title/body，`useReminders.ts:130/134` 只调 `notifyNow`/`scheduleNotify`，`packages/core/src/reminders.ts:133-137` 的 `snoozeUntil` 0 调用，`reminder-form.tsx:66/165-173` 只有固定 5 分钟开关
- 现状：用户勾选「允许贪睡 5 分钟」后无任何再次提醒，开关与实现不一致；`snooze_minutes` 能写入但不触发，`sound/vibrate/dnd` 无 UI 也无投递，用户以为贪睡生效。
- 改法：先做减法——移除无投递链的贪睡开关，`sound/vibrate/dnd` 保持隐藏并在 `reminders.ts` 注释标注预留；再实现通知动作：Android action「完成」「稍后 5 分钟」，点击直达对应课程/待办。若产品确认保留贪睡，则按本条目实现投递链并补测试。
- 路径调整：提醒通知→操作→直达详情（现状仅打开应用）
- 布局调整：系统通知动作按钮；提醒表单去掉「允许贪睡 5 分钟」
- 文案调整：「完成」「稍后 5 分钟」；删除贪睡开关文案，保留「放假当天不提醒」
- 复用方案：复用对象=`useReminders` 投递循环、`snoozeUntil`（`reminders.ts:133-137`）、`App.tsx:684-706` 的详情打开逻辑；抽象边界=先做减法不动 schema，投递链只扩展通知 payload 与动作回调，不建渠道抽象层；复用方式=减法删开关；实现时通知 payload 携带 `reminderId` 与目标路由，动作回调调现有详情打开；迁移步骤=①产品确认 ②减法或实现 ③测试；防过度抽象（不抽什么）=不建通知渠道抽象层、不做外部渠道（邮件/Webhook）、不引通知调度框架。
- 拓展方案：阶段=中期；场景=提醒后一键处理；价值=提醒闭环；复杂度=中高（原生动作）；扩展点=通知 payload；风险=平台能力差异（Android action / 桌面通知能力）。
- 优先级：P1；ICE（I5/C8/E5=200）
- 依赖：无（原依赖 D-03，已并入本条）
- 验收指标：通知操作后待办状态变化；若保留贪睡则 5 分钟后再次提醒，否则 UI 不再暴露；`snooze_minutes`/`sound/vibrate/dnd` 要么有投递链、要么 UI 不再出现。
- 来源：主审；分歧与裁决：D-03 与 R-07 合并（先减法上线，动作能力随 Android 通知动作一并评估）。
- 状态：待办

### 4.3 长期平台化（R-08…R-12）

#### [R-08] 服务端、账号登录、多端同步（D3/D5）
- 轨道：功能拓展
- 类型：平台能力
- 位置/证据：`docs/01-产品与功能.md:148` 未完成 D3/D5；`sync.ts:132-184` 只有协议与 `MemoryRemote`，仓库无服务端包；README 平台表无服务端
- 现状：三端各自本地库，跨设备靠导出/导入与 WebDAV 整包。
- 改法：建服务端 MVP（账号、设备、同步 API），客户端按 `RemoteStore` 实现接入，先手动同步后自动；WebDAV 保留为离线通道。
- 路径调整：我的→账号登录→同步开关（入口依赖 R-02）
- 布局调整：「我的」新增账号区块
- 文案调整：「登录」「立即同步」「上次同步 …」
- 复用方案：复用对象=`sync.ts:132-184` 的 `SyncRow/RemoteStore/syncAll`；抽象边界=服务端只实现 `RemoteStore`，客户端不感知存储细节；复用方式=新增一个 `RemoteStore` 实现替换 `MemoryRemote`；迁移步骤=①服务端 ②客户端接入 ③灰度；防过度抽象（不抽什么）=不做通用后端平台、不建多租户抽象。
- 拓展方案：阶段=长期；场景=多设备同账号；价值=跨设备一致；复杂度=极高（服务端+运维+隐私）；扩展点=`RemoteStore`；风险=账号与数据合规、运维成本。
- 优先级：P2；ICE（I6/C4/E2=48）
- 依赖：无（需产品立项）
- 验收指标：两设备登录同账号后课程一致；退出登录不残留他人数据。
- 来源：主审；分歧与裁决：无
- 状态：暂不做

#### [R-09] 增量同步与字段级冲突解决（M8/M9）
- 轨道：功能拓展
- 类型：同步语义
- 位置/证据：`docs/01-产品与功能.md:149` 未完成 M8/M9；`sync.ts:68-122` 的 `applyRemoteRows` 已记录 `ConflictRecord`（`:29-35`），但无 UI、无删除标记语义、无服务端
- 现状：整行按 `rev/updated_at` 覆盖，用户看不到冲突，删除与字段级修改无法裁决。
- 改法：在 R-08 基础上把冲突列表呈现给用户逐条选择，补删除 tombstone 与字段级合并规则。
- 路径调整：我的→同步详情→冲突列表（依赖 R-08）
- 布局调整：新增冲突处理列表
- 文案调整：「保留本机」「使用远端」「冲突 N 条」
- 复用方案：复用对象=`sync.ts:29-35` 的 `ConflictRecord` 与 `sync.ts:68-122` 的 `applyRemoteRows`；抽象边界=冲突裁决停留在整行级，不做 CRDT；复用方式=现有冲突记录上叠加选择 UI 与结果写日志；迁移步骤=①服务端 ②冲突 UI ③字段级规则；防过度抽象（不抽什么）=先整行冲突不做 CRDT、不建冲突策略插件体系。
- 拓展方案：阶段=长期；场景=两端同改一条数据；价值=同步可信；复杂度=高；扩展点=冲突策略；风险=规则复杂、用户理解成本。
- 优先级：P2；ICE（I5/C4/E3=60）
- 依赖：R-08
- 验收指标：冲突逐条可裁决，结果与选择写日志。
- 来源：主审；分歧与裁决：无
- 状态：暂不做

#### [R-10] iOS 端（D7）
- 轨道：功能拓展
- 类型：新平台
- 位置/证据：`docs/01-产品与功能.md:153` 未完成 D7；`apps/mobile/android` 为唯一原生工程，`capacitor.config.ts:1-19` 无 ios 段；需改 12–13 个 TS 文件（平台分支清单见 A-09）
- 现状：iOS 无任何产物；平台能力分散在 13 个模块。
- 改法：先做平台能力抽象（A-09），再建 Capacitor iOS 工程、Swift 小组件与通知权限，UI 复用 web。
- 路径调整：无（新端沿用现有导航）
- 布局调整：桌面/移动断点沿用
- 文案调整：沿用
- 复用方案：复用对象=`capacitor-driver.ts`、`widget-snapshot.ts`、`platform-detect.ts`；抽象边界=平台能力层统一后新端只补原生壳；复用方式=能力查询 + 快照契约 + 现有 web UI；迁移步骤=①能力抽象 ②iOS 工程 ③通知 ④小组件 ⑤审核；防过度抽象（不抽什么）=不复制第三套 UI、不为 iOS 另建状态层。
- 拓展方案：阶段=长期；场景=iPhone/iPad 用户；价值=覆盖 iOS；复杂度=极高（Swift 小组件+签名+审核）；扩展点=平台能力层；风险=第三端维护成本。
- 优先级：P2；ICE（I5/C4/E2=40）
- 依赖：A-09（原 CAP-12/BND-06，平台能力收口）
- 验收指标：TestFlight 可安装，课表/提醒/小组件可用。
- 来源：主审；分歧与裁决：无
- 状态：暂不做

#### [R-11] Windows 11 小组件面板（D28）
- 轨道：功能拓展
- 类型：系统集成
- 位置/证据：`docs/01-产品与功能.md:152` 未完成 D28；现状只有托盘与悬浮窗（`lib.rs:1336-1690`），`Cargo.toml:35-44` 已有 `windows-sys` 的 Shell/WindowsAndMessaging 特性；无 Widgets provider
- 现状：Windows 只有应用内悬浮窗，未进系统组件面板。
- 改法：技术验证 Windows Widgets Board 接入（COM/WinRT provider + 打包方式），先只读快照，交互留到二期。
- 路径调整：无应用内入口
- 布局调整：系统组件面板卡片
- 文案调整：组件名称/描述
- 复用方案：复用对象=`widget-snapshot` 契约、`widget-window.ts:4-22` 的能力探测；抽象边界=只读快照，不做双向交互；复用方式=provider 读现有快照 JSON；迁移步骤=①技术验证 ②provider ③打包 ④发布；防过度抽象（不抽什么）=不做多平台卡片框架、不把悬浮窗渲染代码搬进 provider。
- 拓展方案：阶段=长期；场景=Win11 组件面板；价值=桌面常驻；复杂度=极高（MSIX/WinRT/审核）；扩展点=快照契约；风险=仅 Win11 22H2+ 可用、系统接口可能变动。
- 优先级：P2；ICE（I3/C3/E2=18）
- 依赖：无
- 验收指标：Win11 组件面板可添加并显示下一节课。
- 来源：主审；分歧与裁决：无
- 状态：暂不做

#### [R-12] 局域网配对同步一期
- 轨道：功能拓展
- 类型：功能拓展
- 位置/证据：`packages/core/src/sync.ts:24-184`（只有 `RemoteStore`/`MemoryRemote` 与 pull→push→pull 原语）、`docs/01:148-149`（多端同步列为未完成 D3/D5）
- 现状：产品只有 WebDAV 整库快照；没有设备发现、配对、信任与传输层。
- 改法：一期「一端生成配对码 → 另一端输码建立信任 → 按范围（课表/待办/设置）与覆盖方向互传」，复用 `syncAll`；后台自动同步与字段级冲突合并留二期。
- 路径调整：无应用内入口，一期从「设置 → 同步与数据」底部进入
- 布局调整：设置页「同步与数据」增加「局域网同步」折叠区；原因=与 WebDAV 同属数据迁移，不新增导航
- 文案调整：新增「生成配对码」「输入配对码」「本次传输：课表 / 待办 / 设置」；「同步」→「云端同步」以区分
- 复用方案：复用对象=`sync.ts` 的 `collectDirty`/`applyRemote`/`syncAll`；抽象边界=只加传输与配对，不改冲突规则；复用方式=实现 `RemoteStore` 的局域网适配器；迁移步骤=①配对协议 ②传输与广播发现 ③范围与方向 UI ④幂等与隔离测试；防过度抽象（不抽什么）=不做通用 P2P 框架、不做多设备拓扑管理、不引入服务端
- 拓展方案：阶段=长期一期；场景=同宿舍/同办公室多端；价值=免云免账号同步；复杂度=高（Windows 防火墙、Android 后台与 mDNS 权限）；扩展点=`RemoteStore` 适配器；风险=与 WebDAV 整包路线重叠、跨平台发现协议差异、配对信任的失败恢复
- 优先级：P2；ICE（I4/C4/E2=32）
- 依赖：A-09（平台能力收口）、A-12（`app_meta` 读写收敛）
- 验收指标：两台同网设备配对后按范围互传 14 行记录，重复执行幂等，不串数据，断网后可重试。
- 来源：主审+盲审；分歧与裁决：三路均判未完成；技术盲审建议先做平台收口再评估，采纳并标「暂不做」，原因见 §8 第 9 条。
- 状态：暂不做

## 5. 代码复用与架构演进

### [A-05] 统一动作、错误与异步状态处理
- 轨道：技术演进
- 类型：复用缺失 + 耦合
- 位置/证据：`apps/web/src/lib/busy.ts:51-72`（`useBusyAction` 全仓 0 使用）、`:26-34`（`runBusy` 12 处，全在 `settings-view.tsx:1473-2166`）；`components/ui/button.tsx:36-38,54-58`（`loading` 仅 `settings-view.tsx:1280` 一处）；13 处手写 busy：`course-form.tsx:150`、`todo-form.tsx:135`、`adjust-dialog.tsx:48`、`period-settings.tsx:181`、`reminder-form.tsx:27`、`startup-settings.tsx:19`、`course-manager.tsx:81`、`import-flow.tsx:91`、`onboarding.tsx:38`、`school-timetable-card.tsx:45`、`layout-panel.tsx:21`、`external-link.tsx:72`、`settings-view.tsx:615`；`App.tsx:194-204` `withToast`（3 处）；错误转文案 63 处内联 + 5 个 `describe()`（`backup.ts:37`、`mini/main.tsx:58`、`storage-config.ts:40`、`system-actions.ts:4`、`webdav.ts:83`）；toast 附近有日志 24 处；`apps/web/package.json:10` 的 test 脚本未列 `test/busy.test.ts`
- 现状：防重复触发三套机制并存（整页蒙版、手写 disabled、未使用的 hook），行为不一致；错误提示与日志口径各写一遍；`busy.test.ts` 从未在测试脚本执行。
- 改法：新增 `apps/web/src/lib/errors.ts`（`errorMessage`）与 `apps/web/src/lib/action.ts`（`useAction`：busy + 错误归一 + 可选 toast/日志 + 可选 confirm），内部复用 `useBusyAction`；表单按钮统一 `<Button loading={busy}>`；`busy.test.ts` 纳入测试脚本。
- 路径调整：无
- 布局调整：无
- 文案调整：无（失败/成功提示用词由文案轨定，技术侧只保证可配置）
- 复用方案：复用对象=`lib/busy.ts`（`runBusy/useBusy` 保留为底层）、`Button.loading`；抽象边界=hook 只管进行中状态、重复触发保护、错误归一，toast/日志为可选参数，不接管校验与回滚；复用方式=`const { busy, run } = useAction(); await run({scope,label,ok,fail,task})`；迁移步骤=①`errorMessage` + 单测，先替换 5 个 `describe` ②`busy.test.ts` 进脚本 ③`useAction` 在 `course-form`/`todo-form` 落地 ④逐组件替换手写 busy ⑤`withToast` 3 处与 24 处 toast+log 收编；防过度抽象（不抽什么）=不做全局 mutation 队列、不做 `AppError` 类层次或错误码表、不接管表单校验；`useBusyAction` 若 2 周内仍无真实调用则删除。
- 拓展方案：无
- 优先级：P1；ICE（I6/C8/E7=336）
- 依赖：无
- 验收指标：`grep -rn "useBusyAction" apps/web/src` 至少 1 处真实调用或删为 0；`busy.test.ts` 出现在测试脚本输出；手写 `useState(false)` busy 从 13 处降到 ≤4。
- 来源：主审+盲审；分歧与裁决：`useBusyAction` 0 调用为盲审同向发现；`busy.test.ts` 未进 `apps/web/package.json:10` 为主审核实。
- 状态：待办

### [A-06] 时间与日期常量单源：WEEKDAYS、节次文案、日期戳、倒计时、周序号→日期
- 轨道：技术演进
- 类型：重复代码（已语义漂移）
- 位置/证据：`WEEKDAYS` 12 份：`App.tsx:72`、`components/adjust-dialog.tsx:21`、`components/app-toolbar.tsx:7`、`components/lesson-detail.tsx:8`、`mini/main.tsx:30`、`screens/cards/timeline.ts:6`、`screens/course-form.tsx:22`、`screens/course-manager.tsx:21`、`screens/todo-form.tsx:49`、`screens/week-view.tsx:15`、`packages/core/src/search.ts:35`、`WidgetRenderer.kt:31`；节次文案 6 份：`App.tsx:131-134`（`>=`）、`course-form.tsx:81-84`（`>=`）、`week-view.tsx:42-44`（`===`，倒序输出「第 5–3 节」）、`cards/timeline.ts:239`、`lesson-detail.tsx:79`（用 `-` 而非 `–`）、`adjust-dialog.tsx:266,271`；日期区间/戳：`App.tsx:117-129`、`week-view.tsx:27-40`、`backup.ts:213-223`（本地时区）、`data-management.ts:58-60`（UTC）、`data.ts:612`（`formatDate(...,'UTC').slice`）；倒计时 `lib/format.ts:1-34` vs `mini/main.tsx:38-56`；`weekDateOf` 重复 `data.ts:164-166` / `App.tsx:103-105`；`allWeeks/oddWeeks/evenWeeks`（`course-form.tsx:24-33`）vs core `parityMask`（`weeks.ts:39-45`，仅测试调用）
- 现状：同一文案/常量多份，`>=` 与 `===` 已漂移；日期戳两种时分/UTC 口径；节次连字符不统一。
- 改法：core 增 `WEEKDAY_LABELS`；`lib/format.ts` 增 `formatPeriodRange`；web 增 `lib/dates.ts`（`dayStampLocal/dayStampUtc/formatMonthDayRange`）；`mini` 复用 `lib/format`；`App.tsx` 改用 `data.ts` 的 `weekDateOf`；`week-view` 快捷周改为 `parityMask`。
- 路径调整：无
- 布局调整：无
- 文案调整：无（仅统一「–」连字符属技术一致性，用词待文案轨确认）
- 复用方案：复用对象=`packages/core/src/time.ts`、`weeks.ts`、`apps/web/src/lib/format.ts`；抽象边界=纯展示/纯日期函数，入参只接受字符串或 epoch，不读设置、不碰业务类型；复用方式=core 常量 + web 工具函数具名导入，删除各本地定义；迁移步骤=①core 加 `WEEKDAY_LABELS` 并替换 11 处 TS ②`formatPeriodRange` 替换 6 处 ③`lib/dates.ts` 替换 4 处日期戳 ④mini 删本地 `span/countdown/remaining` ⑤删 `App.tsx` 的 `weekDateOf` ⑥补齐 `apps/web/test/format.test.ts`；防过度抽象（不抽什么）=不引 dayjs/date-fns、不做 i18n 占位参数、不把「星期/节次」合并成通用区间函数、不为 Kotlin 生成代码（仅标注规格同源）。
- 拓展方案：无
- 优先级：P1；ICE（I6/C9/E8=432）
- 依赖：无
- 验收指标：`grep -rn "周一', '周二'" apps packages` 仅 core 1 处 + Kotlin 1 处；`grep -rn "第 \${.*} 节"` 仅 `lib/format.ts` 1 处；倒序输入归一化为「第 3–5 节」；`format.test.ts` 通过。
- 来源：主审+盲审；分歧与裁决：无
- 状态：待办

### [A-07] 课表规则纯函数化：重叠检测与「钟点→节次」换算
- 轨道：技术演进
- 类型：重复代码（业务规则三份）
- 位置/证据：重叠 `App.tsx:169-192` `overlapAt`、`screens/course-form.tsx:93-111` `findOverlap`、`screens/week-view.tsx:73-106` `clashingLessons/firstClash`；钟点→节次 `data.ts:48-72` `periodAtClock`、`screens/todo-form.tsx:71-95` `periodsForClock`（返回范围，语义不同）
- 现状：同一「同一天/同周次/节次区间相交」规则按三种数据形状各写一遍；换算逻辑两份，输出单节与范围不一致。
- 改法：core 增 `rangesOverlap(aStart,aEnd,bStart,bEnd)`、`weeksIntersect(a,b)`、`periodAtClock(slots,clock)`、`periodsForClockRange(slots,start,end)`；`plusMinutesText` 移入 `core/time.ts`；三处调用点只做数据映射。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`packages/core/src/timetable.ts`（已承载节次逻辑）；抽象边界=纯判定/换算函数，输入节次数字或 `{period_no,start_time,end_time}` 数组，不依赖 `LessonCell/ManagedCourse` 全字段；复用方式=三处内联比较替换为函数调用；迁移步骤=①core 加 4 个函数 + 单测 ②替换 `App/course-form/week-view` 三处重叠比较 ③替换 `data.ts`/`todo-form` 换算 ④冒烟「重叠提示」「自定义时间回填节次」断言通过；防过度抽象（不抽什么）=不建 `OverlapService`、不合并「单节 vs 范围」两种返回值为联合类型 API、不为三种数据形状统一接口。
- 拓展方案：无
- 优先级：P1；ICE（I4/C8/E7=224）
- 依赖：A-06（同批工具归位，可先后）
- 验收指标：core 新增边界单测（相邻不重叠/跨周同节次不重叠/无重叠取最近节次）通过；三处内联 `periodEnd < start || periodStart > end` 归零。
- 来源：主审；分歧与裁决：无
- 状态：待办

### [A-08] 课程色与周次选择器单源
- 轨道：技术演进
- 类型：重复代码（色板漂移风险 + 表单渲染重复）
- 位置/证据：色板 `packages/core/src/import/apply.ts:16-20` `DEFAULT_COURSE_COLORS` 与 `apps/web/src/design/tokens.ts:107-110` `PRESETS.vivid.courses` 逐字相同；默认色 `#4F8DFD` 5 处：`core/import/apply.ts:68`、`core/mutations.ts:455`、`core/repository.ts:74`、`apps/web/src/screens/course-form.tsx:229`、`apps/web/src/theme.ts:14`；语义色 `apps/web/src/data.ts:456`、`screens/cards/timeline.ts:250`；死函数 `theme.ts:12-15` `courseColor`（0 调用）；周次选择器 `course-form.tsx:400-452`（原生 button + 4 个快捷按钮）vs `todo-form.tsx:514-531`（Button + 无快捷按钮）；`course-form.tsx:24-33` `allWeeks/oddWeeks/evenWeeks` 与 core `weeks.ts:39-45 parityMask` 重叠
- 现状：改主题或默认色需动 2 个包 7 个文件；同一「选周次」交互有两种无障碍写法与两套快捷操作；死函数与未复用能力并存。
- 改法：core 增 `colors.ts`（色板 + `DEFAULT_COURSE_COLOR/LAB_COLOR/EXAM_COLOR`），`tokens.ts` 引用 core 色板；删 `theme.ts:courseColor`；新增 `apps/web/src/components/week-picker.tsx` 受控组件，两表单复用，快捷按钮用 `parityMask`。
- 路径调整：无
- 布局调整：无
- 文案调整：无（快捷按钮「全部/单周/双周/清空」沿用现文案）
- 复用方案：复用对象=core 新 `colors.ts`、`weeks.ts:39-45` 的 `parityMask`；抽象边界=颜色值单源；`WeekPicker` 只负责「周次集合选择」，不提交、不读 storage、不接受自定义渲染；复用方式=`<WeekPicker totalWeeks value onValueChange showShortcuts />`；迁移步骤=①core 建颜色模块 ②`tokens.ts` 与 5 处默认色替换 ③删死函数 ④先把 `course-form` 的 DOM 原样搬进 `WeekPicker` ⑤`todo-form` 接入（`showShortcuts={false}`）⑥冒烟周次按钮断言同步定位；防过度抽象（不抽什么）=不做主题→色板映射层（`tokens.ts` 已承担）、`WeekPicker` 不做 i18n 插槽/自定义渲染、不合并两张表单的其余字段。
- 拓展方案：无
- 优先级：P1；ICE（I6/C8/E7=336）
- 依赖：A-06（文案函数归位后可共用）
- 验收指标：`grep -rn "#4F8DFD" apps/web/src` 除 tokens 语义色定义为 0；`DEFAULT_COURSE_COLORS` 仅 1 处定义；两表单周次按钮 DOM 结构一致（冒烟断言）。
- 来源：主审；分歧与裁决：无
- 状态：待办

### [A-09] 原生桥与平台能力收口
- 轨道：技术演进
- 类型：边界不清 + 复用缺失
- 位置/证据：3 个本地包装 `autostart.ts:13-16`、`backup.ts:32-35`、`storage-config.ts:35-38`；19 处 `import('@tauri-apps/api/core')`：`App.tsx:452`、`import-submit.ts:57`、`import-window.ts:41,74`、`log.ts:37,68`、`settings-view.tsx:508,519,565`、`system-actions.ts:13,185,222,276`、`widget-window.ts:12,25`、`db/tauri-driver.ts:6`；Rust 命令 29 个（`lib.rs`，裸字符串调用）；平台分支散落 13 模块 26 处（`autostart.ts:10`、`backup.ts:29,111`、`import-window.ts:9,38,72,83`、`log.ts:35,62,66`、`notify.ts:26,50,73,82`、`permissions.ts:66,81,97`、`settings-view.tsx:293,650`、`storage-config.ts:32`、`system-actions.ts:10,106,183`、`widget-snapshot.ts:97,112`、`widget-pin.ts:28`）；Capacitor 插件加载模板 4 份 `system-actions.ts:105-114`、`widget-pin.ts:65-74`、`import-window.ts:54-56`、`widget-snapshot.ts:99-101`
- 现状：命令名/参数形状两端各写一遍，拼错只在运行时失败；视图直接调原生（`settings-view.tsx:508-570`）；新增平台需逐文件加分支。
- 改法：新增 `apps/web/src/lib/native.ts`（`invokeNative` + 命令名常量联合类型 + `loadCapacitorPlugin<T>`）与 `lib/capabilities.ts`（`canConfigureStorage/supportsImportWindow/hasMobileWidgets/supportsBackgroundReminders` 等，收编已有 3 个 can* 函数）；视图层禁止 import tauri；elevation/tray 调用移入 `autostart.ts`/`storage-config.ts`。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`platform-detect.ts`（保留为唯一探测点）、已有 `canConfigureStorage/canOpenImportWindow/hasMobileWidgets`；抽象边界=`invokeNative` 只做 invoke + 平台可用性 + 错误归一，`capabilities` 只做能力布尔查询，均不持有状态；复用方式=`invokeNative('tray_status', {})`、`if (!supportsImportWindow()) return`；迁移步骤=①建两个模块并收编 3 个 can* ②替换 3 个本地包装与 19 处动态 import（`log/system-actions/widget-window` 优先）③视图调用下沉 ④`detectPlatform()` 调用点压到 ≤10；防过度抽象（不抽什么）=不做每命令一个函数的薄壳（29 个命令会膨胀）、不做插件注册表/DI 容器、不做运行时命令校验。
- 拓展方案：无
- 优先级：P1；ICE（I6/C8/E7=336）
- 依赖：A-05（错误归一先落地，桥内错误文案复用 `errorMessage`）
- 验收指标：`grep -rn "import('@tauri-apps/api/core')" apps/web/src` ≤2；`screens/`、`components/` 下为 0；`detectPlatform()` 调用点 ≤10；`typecheck` 通过（命令名常量必填）。
- 来源：主审+盲审；分歧与裁决：无
- 状态：待办

### [A-10] 大文件按职责拆分：App 壳、日程卡片、周视图、数据加载、作息设置
- 轨道：技术演进
- 类型：边界不清（上帝组件/大函数）
- 位置/证据：`apps/web/src/App.tsx` 1428 行（32 个 useState/14 个 useEffect，职责 9 类：`:237-242` 路由、`:281-304` 加载、`:336-418` 启动编排、`:421-440` 定时备份、`:461-471` 权限、`:474-497` 主题、`:499-518` 键盘、`:730-856` 调课业务、`:1135-1421` 6 个内联弹窗）；`screens/cards/schedule-cards.tsx` 725 行，卡片内直接写库 `:16-20,61-154,277-286,688-690`；`screens/week-view.tsx` 1106 行含 3 套拖动状态机与碰撞规则 `:63-205`；`components/period-settings.tsx` 688 行含「顺延重排」算法 `:380-470`；`data.ts:184-576` `loadAppData` 单函数 393 行，每次写操作全量重载（`App.tsx:541-543`）
- 现状：跨页能力都往 `App.tsx` 堆；卡片既是展示又写库且无错误处理；周视图规则与 DOM 混写；`loadAppData` 无法单测内部步骤。
- 改法：①`app/bootstrap.ts`（启动编排）②`screens/timetable/move-controller.ts`（`resolveMove/applyMove/overlapAt`）③`components/app-dialogs.tsx`（5 个只读弹窗）④`useScheduleActions`（卡片写库上移）⑤`data.ts` 拆 `loadSemesterContext/buildGrid/buildTimelineData/loadHolidays` 纯函数 ⑥`week-view` 拖动状态机抽 `drag-session.ts`（缺陷驱动才做）⑦`period-settings` 顺延算法移 `core/timetable.ts`。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`data.ts`（加载）、`lib/day-nav.ts`（日模式）、`useAction`（A-05）、`grid-metrics.ts`；抽象边界=每个新模块单一职责：bootstrap 只做一次性启动副作用、move-controller 只处理调课业务、卡片 actions 只写库 + 提示、纯函数不读 storage；复用方式=App 只留视图状态，卡片只发 intent，视图只渲染；迁移步骤=①`move-controller`（最易单测）②卡片写库上移 ③5 个弹窗组件化 ④`loadAppData` 拆纯函数 ⑤周视图拖动状态机 ⑥bootstrap（最后，涉及启动顺序）⑦作息顺延算法；每步跑冒烟 235 项；防过度抽象（不抽什么）=不引状态管理库/路由框架、不做事件总线、不做通用手势库、`loadAppData` 不做分页/缓存层。
- 拓展方案：无
- 优先级：P1；ICE（I6/C7/E4=168）
- 依赖：A-05、A-08（动作与周次组件先归位）
- 验收指标：`App.tsx` ≤700 行；`schedule-cards.tsx` 不再 import `@dawn-tick/core` mutations；`loadAppData` ≤120 行且拆出的 4 个纯函数有单测（`app-data.test.ts`）；冒烟 235 项全绿。
- 来源：主审+盲审；分歧与裁决：周视图拖动状态机拆分
- 状态：待办

### [A-11] 设置页按卡片拆分（6 张卡独立组件）
- 轨道：技术演进
- 类型：边界不清（单文件承载全部设置逻辑）
- 位置/证据：`apps/web/src/screens/settings-view.tsx` 2397 行，唯一组件 `SettingsView`（`:252` 起），51 个 useState/8 个 useEffect；6 卡内容为同函数内 `bodies` JSX：`semesters` `:934-1019`、`reminders` `:1020-1144`、`appearance` `:1145-1443`、`data` `:1444-1782`、`maintenance` `:1783-1939`、`about` `:1940-2024`；7 个内联 Dialog；5 套并行 busy+message：`:274-275,277-278,282-284,288-289,290-291`；直接调原生 `:508,519,565`
- 现状：新增一个设置项要同时改状态、handler 与某张卡的 JSX；卡片注册表（`cards/settings-cards.tsx`）只登记标题/顺序，卡内容仍全在主文件。
- 改法：按卡拆 `settings/` 下 6 个组件（`semesters-card/reminders-card/appearance-card/data-card/maintenance-card/about-card`），各自持有 busy 与消息；`settings-view` 只保留布局、注册表、弹窗外壳（目标 ≤400 行）；`data-card` 再拆备份/WebDAV/导出导入三块。
- 路径调整：无
- 布局调整：无（卡片显隐/顺序仍由 registry 决定）
- 文案调整：无
- 复用方案：复用对象=`CollapsibleCard`、`SETTINGS_SECTIONS` 注册表、`Field/Input/Switch`、`useAction`（A-05）、确认组件（产品轨 P0-02）；抽象边界=每张卡组件只依赖 `settings + onPatch + storage` 三个 props，互不引用；复用方式=`bodies[id] = <XxxCard .../>`；迁移步骤=①先拆 `about`（85 行、零状态）②`maintenance`（157 行）③`reminders`（125 行）④`appearance` ⑤`data`（339 行，含 3 个子块）⑥`semesters`（86 行但依赖增删学期回调）；每步保持 `data-role` 与 DOM 不变；防过度抽象（不抽什么）=不做「设置项 schema 驱动表单」、不建通用设置卡框架，卡内继续写显式 JSX。
- 拓展方案：无
- 优先级：P1；ICE（I6/C8/E4=192）
- 依赖：A-05、A-14（组件基元就位后拆分不返工）
- 验收指标：`settings-view.tsx` ≤400 行且 6 个卡组件文件存在；`grep -c "useState" settings-view.tsx` ≤10；冒烟设置页断言（预设版本、作息套用、学期编辑/删除）全绿。
- 来源：主审+盲审；分歧与裁决：无
- 状态：待办

### [A-12] `app_meta` 读写收敛：JSON 访问助手、键清单、快照读取性能
- 轨道：技术演进
- 类型：重复代码 + 数据层性能
- 位置/证据：7 处手写 parse/校验/兜底：`App.tsx:216-231`、`log.ts:101-111`、`backup.ts:41-52`、`preset-update.ts:512-538,592-620`、`school-recent.ts:13-34`、`layout-store.ts:7-38`、`webdav.ts:336-353`；键命名三套（snake_case 见 `App.tsx:207,209`、`log.ts:19`、`notify.ts:7`、`school-recent.ts:4`、`webdav.ts:23,25`、`widget-snapshot.ts:5`；版本后缀见 `preset-update.ts:51,567`、`layout-store.ts:5`；`dt.` 前缀 localStorage 见 `import-window.ts:5,88`、`collapse-store.ts:1`）；热路径 `backup.ts:41-52` `listJsonSnapshots` 用 `app_meta` 全表 `getAll`，由 `:72-74` `listSnapshots` → `:233` `maybeAutoBackup` 调用，`App.tsx:421-440` 每 10 分钟一次、`settings-view.tsx:350-352` 打开设置页一次；三端 `readMeta/writeMeta` 各一份：`core/sqlite-storage.ts:77-83`、`db/idb-storage.ts:91-97`、`core/storage.ts:100-107`
- 现状：同一 JSON 读写模式 7 份、失败语义各异；`app_meta` 16 个键无清单；Web/Android 每次备份检查把全部快照正文与日志 JSON 读进内存再过滤（保留 10 份时读取量≈10× 整库）。
- 改法：新增 `apps/web/src/lib/meta.ts`（`readMetaJson/writeMetaJson`）+ `lib/meta-keys.ts`（集中键常量、命名空间注释，存量键名不改）；快照列表增加轻量索引键 `backup_index`（`{id,createdAt,bytes}`）替代全表扫描；core 增 `createMetaAccessors(collection)` 供三端复用。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=core `storage.ts` 的 `Collection`、现有 `app_meta` 键常量；抽象边界=`readMetaJson` 只管字符串↔对象 + 失败兜底 + 日志，不集中管理键名语义；`meta-keys.ts` 只声明「哪个键属于哪个模块」，不承载读写；`createMetaAccessors` 只抽 `app_meta` 的 kv 访问；复用方式=`await readMetaJson(storage, LAYOUT_META_KEY, parseLayoutConfig)`；迁移步骤=①建 `meta.ts` 与键清单 ②先迁 `layout-store`/`school-recent`（校验最完整）③再迁 `log`/`backup` ④`preset-update` 保留（schemaVersion 语义特殊）⑤快照索引键先兼容无索引旧库（回退全表一次并建索引）⑥三端替换 `readMeta/writeMeta`；防过度抽象（不抽什么）=不建 `MetaStore` 类、不引 zod/schema 库、不做独立 KV 存储、不合并 `Collection` 语义（IDB 与 SQL 差异真实）。
- 拓展方案：无
- 优先级：P1；ICE（I5/C7/E6=210）
- 依赖：A-01（键清单派生思路一致）
- 验收指标：`grep -rn "JSON.parse(await storage.readMeta" apps/web/src` 为 0；`listSnapshots` 不再读取快照正文（存储桩断言读取值体积下降）；`readMeta` 实现从 3 份降到 1 份。
- 来源：主审；分歧与裁决：无
- 状态：待办

### [A-13] CI 纳入界面冒烟与 a11y，修复 `busy.test.ts` 未运行
- 轨道：技术演进
- 类型：验证缺口（流程债务）
- 位置/证据：`.github/workflows/ci.yml:18-50`（node / schema / rust 三 job）；`apps/web/package.json:10` 的 test 脚本列出 24 个测试文件，`apps/web/test/busy.test.ts` 实有但未列入（web test 目录 25 个文件）；`apps/web/smoke/entry.tsx`（235 个 `check()`；`docs/05:30` 旧口径 216），冒烟固定时钟 2026-10-18T18:30+08:00；`tools/design/check-a11y.mjs:101`（遍历 `PRESETS` 的 120 项对比度检查）；`docs/05:54-73,103-113`
- 现状：235 项界面冒烟与 120 项对比度检查只能在本地 `pnpm ui:smoke` 或手动跑；`busy.test.ts` 从未在 CI 执行；无 lint 步骤。
- 改法：`apps/web/package.json:10` 的 test 脚本补 `test/busy.test.ts`；CI node job 增加 `pnpm ui:smoke` 与 `node tools/design/check-a11y.mjs`（冒烟所需 jsdom 已在 web devDeps）；评估将冒烟拆为独立 job 以缩短反馈时间。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=现有 `smoke-ui.mjs`/`check-a11y.mjs` 脚本与 pnpm cache；抽象边界=不在 CI 里重写检查逻辑，只做调用与失败退出；复用方式=新增 step 直接调脚本；迁移步骤=①补 test 脚本 ②本地干净环境验证 `pnpm ui:smoke` ③加 CI step ④观察一次 CI 时长（估算 +2–4 分钟）；防过度抽象（不抽什么）=不引 turbo/nx 任务编排、不把冒烟改造成 e2e 框架、不加 lint 工具链（无既有配置）。
- 拓展方案：无
- 优先级：P1；ICE（I5/C8/E9=360）
- 依赖：A-05（`busy.test.ts` 的 3 个用例依赖 `lib/busy.ts` 行为不改）
- 验收指标：CI 日志出现 `[PASS]` 汇总行且无 `[FAIL]`；`busy.test.ts` 出现在 node job 输出；a11y 脚本退出码 0。
- 来源：主审；分歧与裁决：`busy.test.ts` 未进 test 脚本为主审核实；本条目只做纳入与接线、不改用例语义。本轮实现：`c933759`（已合入 dev）。
- 状态：待验收

### [A-14] 补齐组件基元：FormDialog、InlineError/EmptyState 扩展、SwitchField、Field.error
- 轨道：技术演进
- 类型：复用缺失（高频重复）
- 位置/证据：`ui/` 14 文件 35 个导出中被绕开：`inputs.tsx` 的 `Textarea` 仅 1 用、`Checkbox` 0 用；手写开关行 28 处（`settings-view.tsx` 20、`todo-form.tsx` 5、`startup-settings.tsx` 2、`reminder-form.tsx` 1，模板串 `min-h-tap items-center justify-between gap-3 text-sm text-ink`）；手写空态 10+ 处（`App.tsx:1001`、`adjust-dialog.tsx:259`、`period-settings.tsx:629`、`settings-view.tsx:447,1609`、`mini/main.tsx:243,302,324,360`）而 `EmptyState` 仅 4 文件 5 处使用；错误块 3 种写法（`course-form.tsx:493`、`App.tsx:892`、`period-settings.tsx:588`）；`type="date"` 13 处、`type="time"` 8 处、`type="number"` 21 处无统一错误展示；表单弹窗骨架手写 12 处
- 现状：`Field` 已是最好用的基元（77 处），但开关、空态、错误、弹窗底部、字段错误展示均未沉淀。
- 改法：`ui/controls.tsx` 增 `SwitchField`；`ui/input.tsx` 的 `Field` 增 `error?: string`；新增 `ui/inline-error.tsx`；`ui/dialog.tsx` 增 `FormDialog`/`DangerDialog`；`EmptyState` 增 `size/tone`。
- 路径调整：无
- 布局调整：无
- 文案调整：无（新增组件默认文案由文案轨给）
- 复用方案：复用对象=`Field`、`Switch`、`Dialog`、`EmptyState`；抽象边界=展示组件，无业务文案、无数据依赖；`FormDialog` 只统一壳 + 底部按钮 + 提交挂起态；复用方式=`<SwitchField label=... />`、`<Field error=...>`、`<FormDialog onSubmit={...} submitting={busy}>`；迁移步骤=①`SwitchField` 替换 `settings-view` 20 处（机械）②`Field.error` 接 3 个表单 ③`InlineError` 替换 3 类错误块 ④`FormDialog` 先在「编辑学期」「删除课程」验证形状 ⑤空态替换；防过度抽象（不抽什么）=不做设置项 schema DSL、不把 `Field`/`SwitchField` 合并、不做自定义日期/时间选择器。
- 拓展方案：无
- 优先级：P2；ICE（I4/C9/E8=288）
- 依赖：A-03（DangerDialog 与确认组件共用危险按钮语义；A-03 已并入产品轨 P0-02）
- 验收指标：28 处开关行模板 ≤2；`text-danger-strong">{error}` 内联写法 ≤2；`EmptyState` 使用文件数 ≥8；`FormDialog` 覆盖 ≥4 个表单弹窗。
- 来源：主审；分歧与裁决：无
- 状态：待办

### [A-15] 小组件快照契约与配色对齐（TS↔Kotlin）
- 轨道：技术演进
- 类型：重复代码（跨语言契约漂移）
- 位置/证据：`apps/web/src/widget-snapshot.ts:7-42`（`WidgetLesson/WidgetGridLesson/WidgetExam/WidgetSnapshot`）vs `apps/mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetStore.kt:8-42`（同名 data class 手抄，已漂移：缺 `timeZone`、字段顺序不同）、`WidgetStore.kt:60-108`（JSON 键名再手写）；渲染规则 `WidgetRenderer.kt:30-50`（weekdays、`–`、INK/MUTED/DANGER 常量）、`:271-338`（lessonLine/examLine/timeText/countdown/remaining/daysLeft）与 web `lib/format.ts`/`tokens.ts` 同源；配色三处同义：`WidgetRenderer.kt:45-50` 常量、`res/values/dimens.xml`、`design/tokens.ts`
- 现状：快照是跨语言契约但只由 TS 定义，Kotlin 手抄；改字段无任何检查能发现漂移（Kotlin 用 `optString` 兜底，缺字段表现为空白）；小组件配色不跟主题。
- 改法：新增 `tools/verify/check-widget-contract.mjs`（正则解析 TS 接口字段与 Kotlin `opt*` 键名做差集，缺失报警）并接入 `verify-all.ps1`；快照可选携带 `colors:{ink,muted,danger}`，Kotlin `applyTheme` 优先用快照色、缺失回退常量。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=TS 类型作为契约源、`design/tokens.ts` 作为配色源；抽象边界=只共享数据结构与文案规则，不共享渲染代码（RemoteViews 与 DOM 无共享可能）；复用方式=契约检查脚本 + 快照可选字段；迁移步骤=①写字段差集检查脚本（约 60 行）②接入 verify-all ③快照加可选 `colors` ④Kotlin 优先读快照色 ⑤真机验证；防过度抽象（不抽什么）=不做 JSON Schema 代码生成、不试图跨语言复用代码、不为尺寸做快照化（XML/Kotlin 同步保留注释）。
- 拓展方案：无
- 优先级：P2；ICE（I5/C8/E6=240）
- 依赖：无
- 验收指标：契约检查脚本在字段不一致时退出码非 0；修改 `WidgetSnapshot` 字段后本地 verify 可报出 Kotlin 未同步；Android 小组件颜色随主题变化（真机）。
- 来源：主审+盲审；分歧与裁决：无
- 状态：待办

### [A-16] 远端制品拉取/校验共享（更新检查与预设更新）
- 轨道：技术演进
- 类型：重复代码（部分重合，差异真实）
- 位置/证据：`apps/web/src/update.ts:10-27`（双源 feeds）、`:268-340` `checkForUpdate`（raw 失败回退 api）、`:126-134` `isUpdateManifest`、`:220-243` `manifestFromRelease`；`apps/web/src/preset-update.ts:22-35`（双源 URL）、`:217-280` `readPresetJson`（raw→api 逐源）、`:281-360` `fetchSnapshot`、`:111-119` `verifySnapshot`、`:512-538` 缓存；已共享的部分：`comparePresetVersions` → `update.ts:98` `compareVersions`
- 现状：两条「远端制品拉取 + 校验 + 缓存」管线各自成长（345 + 675 行），源选择与网络错误文案分叉；版本比较已共享，说明共享路径可行。
- 改法：新增 `apps/web/src/lib/remote-artifact.ts`：`fetchFirstAvailable(sources, parse)` + 统一网络错误描述；两条管线改调用；缓存与清单校验留在各自模块。
- 路径调整：无
- 布局调整：无
- 文案调整：无（保留各自错误前缀）
- 复用方案：复用对象=`update.ts:98 compareVersions`、双源 Fetch 模式；抽象边界=只抽「多源取一个文本/JSON + 网络错误归一」，不抽清单结构校验（更新清单与预设快照差异大）；复用方式=注入 `sources` 与 `parse`；迁移步骤=①用 update 现有逻辑实现并迁入 ②`update.test.ts` 验证 ③迁 `readPresetJson` ④两套测试全绿；防过度抽象（不抽什么）=不做重试/退避框架、不抽「制品类型」枚举、不统一两类错误用户文案。
- 拓展方案：无
- 优先级：P2；ICE（I4/C7/E5=140）
- 依赖：无
- 验收指标：两管线「raw 失败→api 成功」「双源失败」用例保持通过；共享函数新增单测。
- 来源：主审+盲审；分歧与裁决：盲审技术独立记录 `beta` 兜底指向未产出的 `beta-latest`，属取源事实错误，已进第 7 节待确认；本条只抽共享取源函数、不改变取源顺序与渠道判定；Q14 已定：先量重合度，本轮不做；重合低则关闭本条。。
- 状态：待办

### [A-17] 学校检索入口收编（`filterSchools` 退场）
- 轨道：技术演进
- 类型：重复代码（领域模型分裂）
- 位置/证据：`packages/core/src/schools/index.ts:216` `searchSchools`；`packages/core/src/import/school-list.ts:134` `matchSchools`、`:180` `suggestSchools`；`apps/web/src/screens/school-picker-model.ts:88` `filterSchools`（`searchSchools` 的薄包装）、`:73` `primarySchoolTags`、`:386-398` `matchingEntrySchools`；使用点 `apps/web/src/components/school-picker.tsx:71` 与 `import-flow.tsx:161,177`
- 现状：「学校」有 `School`/`SchoolEntry` 两个类型与三条检索路径；`filterSchools` 只转发 `searchSchools`，`matchingEntrySchools` 另用 `matchSchools`，同校名在两处匹配规则不同。
- 改法：目录检索只留 `searchSchools`（options 已支持 tags/province/limit）；web 删除 `filterSchools` 改传 options；`SchoolEntry` 退化为教务入口数据，只做入口匹配与 URL 构造。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`searchSchools`（`schools/index.ts:216`）、`entryUrlFor/systemEntry`；抽象边界=目录检索（名字/拼音/标签/省份）与入口构造分离；复用方式=`searchSchools(query, {tags, province, limit})`；迁移步骤=①对齐三套排序权重（以 `searchSchools` 为准）②web 改调用 ③`school-picker.test.ts` 对齐 ④三页同关键词首条一致断言；防过度抽象（不抽什么）=不合并 `School` 与 `SchoolEntry`（数据性质不同，合并会让 system/url 永远可空）、不做统一搜索索引。
- 拓展方案：无
- 优先级：P2；ICE（I4/C7/E5=140）
- 依赖：无（名录数据合并列入「不建议现在做」）
- 验收指标：`filterSchools` 删除后 `apps/web/test/school-picker.test.ts` 全绿；三处入口同关键词首条结果一致。
- 来源：主审；分歧与裁决：无
- 状态：待办

### [A-18] 页面导入协议与原生插件契约对齐
- 轨道：技术演进
- 类型：重复代码（跨语言）+ 契约分散
- 位置/证据：协议两端 `packages/core/src/import/page-tables.ts:458`（`PAGE_FRAME_SEPARATOR`）、`:485` `PAGE_BOOKMARKLET`（含 `walk/scan/ready`）、`:489-507`（`parsePageDiagnostics/stripPageMarkers/countPastedFrames`）vs `apps/desktop/src-tauri/src/import-injection.js:1-122`（`collect` 生成 `<<<DAWNTICK>>>…<<<FRAME>>>…<<<END>>>`、`MAX_PAYLOAD`、降级面板）；两端诊断字段已不一致（bookmarklet 报 tables/kbTables/gridCells，注入脚本只报 frames）；使用点 `apps/web/src/screens/import-flow.tsx:150-158,209-226`；Java/Kotlin 插件契约手写同构：`system-actions.ts:42-54` vs `SystemActionsPlugin.java`、`widget-pin.ts:57-63` vs `WidgetPinPlugin.kt`、`import-window.ts:54-56` vs `SchoolWindowPlugin.kt`
- 现状：同一协议两套实现、诊断字段漂移；插件方法名/返回字段在 TS 与 Java/Kotlin 各写一份，改名会静默失效。
- 改法：对齐两端诊断字段；Rust 侧脚本继续 `include_str!` 加载但字段清单与 TS 注释互指；web 侧新增 `apps/web/src/lib/plugins.ts` 集中插件接口定义（方法名/参数/返回字段），Java/Kotlin 侧配一份 `plugins.contract.md`。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`page-tables.ts` 协议常量与 `lib/native.ts`（A-09）的插件加载；抽象边界=协议（分隔符/诊断字段）唯一，两端各自实现运行环境差异，不做跨语言代码共享；复用方式=字段清单同源 + 契约文档；迁移步骤=①注入脚本补 `tables/gridCells` ②两端共用一组样例期望（`import-injection.test.ts`、`page-tables.test.ts`）③web 插件接口集中 ④补 `plugins.contract.md`；防过度抽象（不抽什么）=不引模板引擎、不做 TS→JS 注入脚本代码生成（协议演进时再评估）、不合并 Tauri/Capacitor 插件体系。
- 拓展方案：无
- 优先级：P2；ICE（I3/C7/E6=126）
- 依赖：A-09（插件加载统一后可集中接口）
- 验收指标：两端诊断字段一致（共用样例断言）；`registerPlugin(` 调用点从 4 降到 1；插件契约文档存在。
- 来源：主审；分歧与裁决：无
- 状态：待办

### [A-19] 依赖与构建清理（未用依赖、manualChunks、冒烟入口拆分）
- 轨道：技术演进
- 类型：依赖卫生 + 可维护性
- 位置/证据：`apps/web/package.json` 声明 35 个运行时依赖（另 7 个 devDependencies），`src` 零 import 的 6 个 Radix 包（`@radix-ui/react-dropdown-menu/label/radio-group/scroll-area/separator/tooltip`，仅命中 `apps/web/src/legal/credits.generated.ts:16,17,19,20,22,26`）；`exceljs` 已懒加载（`import-flow.tsx:69`）但 `vite.config.ts:24-32` 无 `manualChunks`；`apps/web/smoke/entry.tsx` 2938 行；`core/zip.ts`（自研 store-only zip）与 `zip-read.ts` 维持现状
- 现状：未用依赖增加安装体积并虚增第三方声明；exceljs 虽在首包外但未独立成 chunk，缓存粒度粗；冒烟入口与主应用并行演进，diff 噪声大。
- 改法：删 6 个依赖并重跑 `tools/legal/collect-licenses.mjs`；`vite.config.ts` 增 `manualChunks` 把 `exceljs` 独立；冒烟文件按领域拆 `smoke/bootstrap.ts` + `smoke/cases/*`。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`vite` 内置 `manualChunks`、现有 licenses 生成脚本；抽象边界=只做依赖清单与打包配置，不动业务代码；复用方式=配置与脚本；迁移步骤=①删依赖 ②`pnpm install` ③重跑 licenses ④加 manualChunks 并确认首包不含 exceljs ⑤拆冒烟（可选，最后做）；防过度抽象（不抽什么）=不引 depcheck 工具链、不做打包体积门禁、不重写自研 zip。
- 拓展方案：无
- 优先级：P2；ICE（I2/C9/E9=162）
- 依赖：A-13（CI 先纳入冒烟，拆冒烟才有回归保护）
- 验收指标：`credits.generated.ts` 条目减少 6；构建产物存在独立 exceljs chunk 且主 chunk 不含它；`pnpm ui:smoke` 的 `[PASS]` 数不变。
- 来源：主审；分歧与裁决：无
- 状态：待办

**来源到去向映射**

| 来源 ID | 去向 | 说明 |
|---|---|---|
| A-01 | P0-06 | 与 D-01 合并为「备份设置键清单单一来源」 |
| A-02 | P0-07 | 整包 zip 打包/解包收敛为一处 |
| A-03 | P0-02（产品轨） | 危险操作二次确认并入产品轨，本稿不再重复 |
| A-04 | P0-08 | 与 D-02 合并为「`weeks_raw` 派生」 |
| A-05…A-22 | 第 5 节本节 | 18 条按 P1（A-05…A-13）/P2（A-14…A-22）全量保留 |
| D-01 | P0-06 | 数据层缺陷（键清单漂移）并入技术轨 P0 |
| D-02 | P0-08 | 数据层缺陷（`weeks_raw` 缺失）并入技术轨 P0 |
| D-03 | R-07 | 并入「提醒动作与投递链」，第 4.2 节 |

### [A-20] 启动兼容自检：识别缺 `_sqlx_migrations` 的旧库
- 轨道：技术演进
- 类型：边界不清
- 位置/证据：`apps/desktop/src-tauri/src/lib.rs:2770-2813`（插件迁移 1–6）、`apps/web/src/db/platform.ts:52-66`（原生失败静默回退 IndexedDB）、`packages/core/src/migrate.ts:11-18`（只按 `app_meta.schema_version` 跳过）、`packages/core/src/schema/001_init.sql:5`（`CREATE TABLE` 无 `IF NOT EXISTS`）
- 现状：若库由早期纯 JS 迁移建立、缺 `_sqlx_migrations`，插件会从 001 重跑并因「表已存在」失败，表现是回退 IndexedDB；仓库无检测代码，也无可复现样本（Q13）。
- 改法：开库前检测「`sqlite_master` 有 `users` 但无 `_sqlx_migrations`」→ 写 `logWarn` 给出数据目录与手动恢复指引，并按 `app_meta.schema_version` 补写基线；不做自动迁移。
- 路径调整：无
- 布局调整：无
- 文案调整：`原生 SQLite 不可用，回退到 IndexedDB`→说明原因与恢复入口（库缺少迁移记录，已回退；数据未丢失，可在设置恢复快照），最终措辞由文案轨定
- 复用方案：复用对象=`apps/web/src/db/health.ts` 的自检结论与 `recovery_notice`；抽象边界=只检测与提示，不改表、不重放迁移；复用方式=启动健康检查增加一项判定；迁移步骤=①健康检查加判定 ②Rust 用例造该形状库 ③界面复用恢复入口；防过度抽象（不抽什么）=不做自动迁移脚本、不做版本嗅探表、不合并到 schema 迁移链
- 拓展方案：无
- 优先级：P1；ICE（I4/C8/E6=192）
- 依赖：Q13（需要可复现的存量库样本）
- 验收指标：Rust 用例构造「有 `users` 无 `_sqlx_migrations`」的库，启动仍读到原数据、日志含明确原因、不再静默回退；正常库行为不变。
- 来源：主审+盲审；分歧与裁决：三路均判未完成仍有效；技术盲审建议只做检测不做自动迁移，采纳；Q13 已定：只做检测与提示，不写 Rust 用例。；本轮实现：`85a460f`（已合入 dev）。
- 状态：待验收

### [A-21] 视图进入过渡接线：`dt-view-enter` 全仓未使用
- 轨道：技术演进
- 类型：一致性
- 位置/证据：`apps/web/src/styles.css:336-395`（`.dt-view-enter` 定义在 `:369`）、`apps/web/src/App.tsx:473-476`（`data-motion` 落到根节点）；全仓无 `dt-view-enter` 使用点
- 现状：动效设置与停用规则已实现，视图切换没有实际过渡，与 0.2.0 文案「视图进入走 150–200ms 过渡」不一致。
- 改法：在课表/日程/设置视图根节点挂 `dt-view-enter`（key 随 view 变化）；若产品确认不做，则同步撤回文案与设置项说明。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`styles.css` 既有 `dt-view-enter` 与 `[data-motion]` 停用规则；抽象边界=只在视图根节点加 class，不改动效框架；复用方式=视图容器统一加类；迁移步骤=①三个视图挂类 ②冒烟断言 ③检查 `data-motion=off` 时压到 1ms；防过度抽象（不抽什么）=不引入动画库、不做每元素过渡配置
- 拓展方案：无
- 优先级：P2；ICE（I3/C8/E8=192）
- 依赖：无
- 验收指标：切换视图时过渡类出现且时长 150–200ms；`data-motion=off` 时压到 1ms；冒烟断言过渡类与 `data-motion` 同时存在。
- 来源：主审+盲审；分歧与裁决：盲审技术独立发现未接线；主审判待验收，按「未完成仍有效（部分）」保留为任务；本轮实现：`b28f23a`（已合入 dev）。
- 状态：待验收

### [A-22] 加载态接线：`useBusyAction` 零调用、`busy.test.ts` 未纳入
- 轨道：技术演进
- 类型：复用缺失
- 位置/证据：`apps/web/src/lib/busy.ts:51-72`（`useBusyAction` 全仓 0 调用）、`apps/web/test/busy.test.ts`（3 条用例）、`apps/web/package.json:10`（test 脚本未列该文件）、`apps/web/src/components/ui/button.tsx:36-58`（`loading` 仅 `settings-view.tsx:1280` 一处）
- 现状：整页蒙版、手写 disabled、未使用的 hook 三套机制并存；`busy.test.ts` 从未在 `pnpm test` 与 verify-all 执行（web 静态 174、运行 171，差值即这 3 条）。
- 改法：①`package.json` test 脚本纳入 `test/busy.test.ts` ②课程/待办/调课表单接 `useBusyAction`（或删除 hook 并改条目）③补慢操作蒙版断言。
- 路径调整：无
- 布局调整：无
- 文案调整：无
- 复用方案：复用对象=`lib/busy.ts` 的 `useBusyAction` 与 `Button.loading`；抽象边界=hook 只管进行中与重复触发，不接管校验；复用方式=`const { busy, run } = useBusyAction(); await run(task)`；迁移步骤=①纳入测试脚本 ②表单替换手写 busy ③蒙版断言；防过度抽象（不抽什么）=不建全局 mutation 队列、不做错误码体系
- 拓展方案：无
- 优先级：P2；ICE（I3/C8/E8=192）
- 依赖：A-05（统一动作底座）、A-13（CI 纳入冒烟）
- 验收指标：`pnpm test` 执行 web 用例 171→174；重复触发返回 `undefined`；慢操作出现 `.dt-busy-mask` 且按钮带 `aria-busy`。
- 来源：主审+盲审；分歧与裁决：盲审技术独立发现未接线；体验盲审判已验收，主审判待验收，按硬规则保留为任务。
- 状态：待办

## 6. 文案与术语表

说明：本节为可直接替换的文案资产，动态部分保留 `${…}`；行号会漂移，替换前按原文案与 `data-role` 锚点复核；原生侧（`strings.xml`、Tauri 托盘与错误框）与本表同批但按平台文案位置落地。

### 6.1 术语（12 条）
| 术语 | 规范写法 | 定义（用户视角）与首现位置 |
|---|---|---|
| 节次 | 节次；第 3 节；第 3–4 节；N 个节次 | 一天里的第几节，起止由作息决定；`period-settings.tsx:593`、docs/01:163 |
| 排课 | 排课；N 条排课 | 「哪天第几节上什么课」的一条记录，属于某门课程；`course-manager.tsx:43` |
| 课次 | 界面优先「这节课」，不指节次与排课 | 只在必要时指「某天实际要上的那一次」；`data.ts:88` |
| 待办 | 待办；N 条待办 | 带时间与完成状态的记录，类型含日程/作业/考试/实验；`todo-form.tsx:370`、docs/01:165 |
| 日程 | 日程页；类型名「日程」 | 发生在某天的一件事，也作页面名；`nav.tsx:16` |
| 放假/假日/假期 | 状态「放假」；某天「假日」；区间「假期」 | 某天不上课 / 具体某天 / 连续区间；`week-view.tsx:752`、`schedule-cards.tsx:198,100` |
| 调休/临时加课 | 调休；临时加课；某天设为「上课日」 | 把某天课表挪到另一天 / 临时补上一节；`adjust-dialog.tsx:229`、`schedule-cards.tsx:199` |
| 快照/备份/恢复 | 快照 / 备份 / 恢复 | 本地自动副本 / 导出文件或远端包 / 用其一覆盖当前数据；`settings-view.tsx:1609,446,1628` |
| 预设/作息 | 预设；作息 | 学校作息与教务入口的数据包 / 一天中节次的起止安排；`settings-view.tsx:1545`、`period-settings.tsx:479` |
| 渠道 | 开发版 / 公测版 / 正式版 | 构建来源；`channel.ts:14` |
| 通知权限 | 未申请/已允许/已拒绝/已拒绝且不再询问/通知已关闭/通知渠道已静音 | 系统是否允许弹通知；`settings-view.tsx:152-167`、docs/01:79 |
| 悬浮窗/主屏小组件 | 悬浮窗；主屏小组件（下一节课/今日课表/一周概览/考试倒计时） | Windows 置顶小窗 / Android 主屏组件；`widget-pin.ts:12-17`、docs/01:102 |

### 6.2 术语不一致 T1–T12
| 组 | 不一致 | 统一口径与证据 |
|---|---|---|
| T1 | 课次＝节次/排课/某天一次课 | 拆词：节次、排课、这节课（`period-settings.tsx:581`、`adjust-dialog.tsx:261`、`data.ts:88`），见 P1-10 |
| T2 | 日程/待办/安排/条目；日程显示为「其他」 | 页面「日程页」、记录「待办」、删「其他」（`nav.tsx:16`、`schedule-cards.tsx:188,291`、`timeline.ts:204`），见 P1-12 |
| T3 | 调课/改期/顺延/调整/改到 | 动作统一「调课」（`adjust-dialog.tsx:228,288`、`schedule-cards.tsx:202`、`App.tsx:1170,827`），见 P1-04 |
| T4 | 放假/假日/假期/法定假日 | 状态「放假」、某天「假日」、区间「假期」、法律用语「法定节假日」（`week-view.tsx:752`、`schedule-cards.tsx:198`、`settings-view.tsx:1376-1377`） |
| T5 | 调休/非假日/补课/临时加课 | 「设为上课日」「临时加课」，补课只留示例（`adjust-dialog.tsx:229,397`、`schedule-cards.tsx:199`），见 P1-04 |
| T6 | 备份/快照/整包/恢复/导入混用 | 自动份「快照」、导出/远端「备份」、覆盖「恢复」、格式「整包 zip」（`settings-view.tsx:1609,446,2233,1628,2309`），见 P2-09 |
| T7 | 预设/作息/时间表/节次交叉 | 数据包「预设」、一天安排「作息」；卡片名「时间表」正文统一「作息」（`settings-view.tsx:1545`、`period-settings.tsx:479,504`），见 P2-09 |
| T8 | 小组件称谓与尺寸名不一致 | Android 统一「主屏小组件」，尺寸名两端对齐（`settings-view.tsx:1244`、`strings.xml:14`、`widget-pin.ts:15`），见 P2-09 |
| T9 | 渠道五套写法 | 只用开发版/公测版/正式版，beta/dev 只进日志（`channel.ts:15-17`、`settings-view.tsx:1810,1820`），见 P2-09 |
| T10 | 通知权限三套词，且偏离六态 | 删 `PERMISSION_LABEL`，共用 `notifyStateOf` 六态（`settings-view.tsx:133-138,152-167`、docs/01:79），见 P1-11 |
| T11 | 今天/今日、明天/明日、剩余/余 | 句中「今天/明天」，专名「今日课表/明日预告」，倒计时「剩余」（`widget-pin.ts:14`、`settings-view.tsx:1355`、`schedule-cards.tsx:354,356`、`mini/main.tsx:277`） |
| T12 | 量词、单位与连接符不统一 | 课程=门、排课=条、上课次数=节、节次=个、待办=条、安排=项、时长=分钟、区间用 –（`school-timetable-card.tsx:152`、`course-manager.tsx:125`、`import-flow.tsx:676`、`lib/format.ts:27`），见 P1-12 |

### 6.3 可替换文案（按区域，「原文案→新文案」）
| 区域 | 位置 | 原文案 → 新文案 | 级别 |
|---|---|---|---|
| 导航 | `App.tsx:1000-1001`、`nav.tsx:63` | `我的`/`建设中` → 删除导航项（或页面改 `这里还没有内容`）；`快捷键 ← → 切周，T 回今天，/ 搜索`→`快捷键：/ 搜索 · ← → 平移一屏 · T 回到今天` | P1/P2 |
| 课表 | `week-view.tsx:721-724` | `…没有课程`→`这段时间没有课程`；`从右上角加课，或到导入页导入`→`从右上角「添加课程」，或在设置里导入课表`（移动端 `点右下角「快速添加」，或在设置里导入课表`） | P0 |
| 课表 | `app-toolbar.tsx:104,109-110` | `今天`/`周`/`日` → `回到今天`/`周视图`/`日视图` | P2 |
| 日程 | `timeline.ts:204`、`schedule-cards.tsx:188-189,199,202,291,313,354,356` | `其他`→`日程`；`加待办`→`添加待办`；`课程调整`→`调整课程`；`设为非假日`→`设为上课日`；`当天顺延到次日`→`课表顺延到次日`；`这一天没有安排`→`这一天没有待办`；`已完成 {n}`→`已完成 {n} 项`；`看明天`→`查看明天` | P1/P2 |
| 设置 | `settings-view.tsx:1024,133-138,164,1139,1244,1810,1820,129-130` | 非 Android 改用六态；`已授权`→`已允许`；`已被拒绝`→`已拒绝`；`已拒绝，不再弹窗`→`已拒绝且不再询问`；删与 `:1096` 重复句；`桌面小组件`→`主屏小组件`；`beta 版`→`公测版`；`dev 构建`→`开发构建`；`GitHub contents 接口`/`raw.githubusercontent.com`→`预设仓库（GitHub）` | P1 |
| 表单 | `adjust-dialog.tsx:246,261,278,316,360,368,401`、`todo-form.tsx:42`、`course-form.tsx:319,466` | `哪门课`→`课程`；`要调整的课次`→`要调整的排课`；`原来哪一天`→`原日期`；`改到哪一天`→`调整后日期`；`把哪一天的课表`→`原日期课表`；`调到哪一天上`→`目标上课日`；`哪一天`→`加课日期`；`当天提醒`→`开始时提醒`；`增加时段`→`添加时段`；`删除此时段`→`删除时段` | P0/P1 |
| 确认弹窗 | `course-manager.tsx:291`、`settings-view.tsx:2127`、`lesson-detail.tsx:100,139`、`settings-view.tsx:1626,1637`、`App.tsx:1403` | `将删除「X」及其 N 条排课与相关提醒，本操作不可撤销`→`将删除「X」及 N 条排课、M 条提醒，不可撤销`；`将删除「X」及课程、日程与提醒，不可撤销`→逐类数量；`点击即删`→`将删除周三 第 3–4 节的排课，不可撤销`；`恢复/删除快照直接执行`→`将用该快照覆盖本机数据，重启后生效，不可撤销`/`将删除该快照，不可撤销`；`将覆盖本机数据（下载前已备份本机），不可撤销` | P0 |
| 空态与错误 | `today-view.tsx:74-75`、`course-manager.tsx:153`、`search-dialog.tsx:68`、`App.tsx:889-895`、`import-flow.tsx:311,508`、`settings-view.tsx:440` | `可切换到周视图查看本周安排`→`切换周视图可看本周安排` + `查看周视图`；`当前学期没有课程，可在导入页添加或导入`→`当前学期没有课程，可在下方导入课表`；`没有匹配结果`→`没有匹配结果，换个关键词试试`；错误页补 `载入失败` + `{原因}。请重启应用；仍失败请在「设置 → 同步与数据」导入备份，并附日志反馈。` + 「重试」「导入备份」；`识别失败：{原因}。请换一种导入方式，或手动添加课程。`；`打开教务窗口失败：{原因}`；`连接失败：{原因}。请检查地址、用户名与密码` | P0/P1 |
| 引导与小组件 | `onboarding.tsx:175,193,256-257`、`mini/main.tsx:261,277`、`strings.xml:11,14-15` | `创建并开始`→`创建学期并设为当前`；跳过说明正文一句 + help；`确认导入`前加 `将覆盖设备上的现有数据，不可撤销`；`今天没有课啦`→`今天没有课了`/`明天也没有课`；`余`→`剩余`；`尚未同步数据`→`尚未创建学期`；`本周课表`→`一周概览` | P1 |

### 6.4 文案资源小集中
- 新建 `apps/web/src/copy/zh.ts`：纯数据 + 构造函数，不引入 i18n 框架与运行时；键为 `ACTION`、`STATE`、`COUNT`、`periodRange()`、`DELETE`、`fail()`、`NOTIFY`、`CHANNEL`、`UNIT_LABEL`，合计 ≤60 键。
- 执行顺序：第一批（P0 同批）`ACTION`/`STATE`/`COUNT`/`periodRange`；第二批（P1 同批）`DELETE`/`fail`/`NOTIFY`/`CHANNEL`；第三批（P2 同批）`UNIT_LABEL` 与 CP-06 剩余 P2 文案。
- CP-06（原 88 条 P2 打磨）不单独成条，随第三批逐区域替换：口语、标点、单位、日期格式、重复句与安装包说明；每 PR 用 `grep` 校验同一字面量不再出现第二次；被测试断言的文案（`test/channel.test.ts:7`、`test/health.test.ts:30-32`、`test/data-management.test.ts:156`、`test/import-injection.test.ts:69/91`）保持字面量或在同 PR 改断言；安装包补 `shortDescription`/`longDescription`（`tauri.conf.json:27-31`）。
- 不做什么：不做多语言切换与翻译后台；不迁插值与日志 message（`log.ts` 原位）；不迁原生侧文案（`strings.xml`、Tauri 托盘与错误框原位）；不迁被测试断言的导出；不建 ICU 复数与日期库，量词用 `COUNT()` 表驱动。

## 7. 待确认问题

| 编号 | 事实 | 双方口径 | 需谁决策 | 影响任务 |
|---|---|---|---|---|
| Q1 | `App.tsx:998-1003` 为「我的/建设中」占位，旧 TODO 条目 O-10 记「内容待定」，`docs/01` 全文无该页定义（仅 `:66` 提导航） | 03 给「隐藏」或「建成设备与同步」两方案并定 P1；05 NAV-01 定 P0、建议直接删除入口 | 产品负责人 | P1-02（定级与改法随结论回填） |
| Q2 | `docs/01:66` 写「导入在设置页内，不单独占导航」；`week-view.tsx:718-726` 空态当前无 action | 03 U05 在坚持不占导航下仍给课表空态主按钮（跳设置并自动展开），导入路径 5 步；05 EMP-01 给空态 action「去导入」，允许课表页入口则 4 步 | 产品负责人 + 交互 | P0-04（路径步数与空态按钮） |
| Q3 | `notify.ts:81-85` 非 Web 平台恒返回 `default`，界面显示「未申请」；`docs/01:79` 承诺六态 | 一方接受「跳系统通知设置」兜底；另一方要求原生侧补状态查询后才算完成六态 | 桌面端负责人 | P1-11（验收口径） |
| Q4 | `mutations.ts:825` 现为硬删；`docs/02` 未定义软删字段 | 一方本轮只做硬删 + 确认；一方要求软删以支撑 5 秒撤销/回收站，需动 `dirty/rev` 与快照恢复 | 技术负责人 + 产品 | P0-01、P0-02 |
| Q5 | `db/platform.ts:52-66` 静默回退 IndexedDB | 一方回退期间继续允许写入（简单但恢复原生库后写入会丢）；一方要求禁用写入或明确标记 | 技术负责人 | P1-07（警告条与写入策略） |
| Q6 | 周模式可翻到学期外且标题仍显示边界周（`App.tsx:1063-1064`、`data.ts:245`）；日模式现为「停在边界」（`app-toolbar.tsx:90,96`） | 03 U23 主张边界禁用 ‹ › + 学期外水印；另一方要与 `TODO.md:44`「从今天开始的 N 天窗口」口径统一后再定 | 交互 + 技术 | P2-06 |
| Q7 | 全仓 `toast(` 调用无 `{ action }` 选项（grep 0 处），无撤销实现 | 03 U08 给「5 秒撤销」；另一方主张本轮只做「确认 + 软删」，撤销列下一阶段 | 产品负责人 | P0-02（撤销是否本轮交付） |
| Q8 | `docs/01:3` 写「离线优先」（`README.md` 无此表述），但 `index.html` 无 manifest、`main.tsx` 无 Service Worker | 补 PWA；或文档改为「本地优先、外壳需联网加载」（倾向后者，待定） | 产品 + 文档维护者 | 第 6 节口径与 `docs/01`（无任务条目） |
| Q9 | 旧 TODO O-25：`v0.1.0-beta.1` 标签指向 `819b3e3`，条目写 `1aac20a`；`publish.yml:257-287` 可核，Release 四类产物与 `.sha256` 在仓库外不可核 | 主审判已验收；两路盲审证据不足（08a 记「证据不足待确认」） | 发布维护者 | 无本稿任务；与 Q10 同批核对，核对后可移入 CHANGELOG |
| Q10 | 旧 TODO O-35：`publish.yml:154-158`、`tools/release/set-github-secrets.ps1`、`docs/06:120/144-145` 可核，四项 secret 的写入状态在 GitHub 远端不可核 | 主审/体验待验收；技术判证据不足（08a 记「仓库外状态」） | 发布维护者（`gh secret list` + 一次 beta 发布核验签名 APK） | 无本稿任务；与 Q9 同批核对 |
| Q11 | `apps/web/src/update.ts:10-14` 把发布内 `version.json` 作为网络异常时的唯一兜底取源，`UPDATE_API_FEEDS.beta`（`:19`）指向从未产出的滚动标签 `beta-latest`；`.github/workflows/publish.yml:257-287` 只产出安装包、便携包、APK、Web 包与 `.sha256`，无 `version.json` 生成；滚动标签只有 `dev-latest`（`tools/release/plan.mjs:6`） | 让 `publish.yml` 产出 `version.json` 并去掉 `beta-latest`；或删兜底与相关断言 | 发布维护者 | A-16；修复前 GitHub API 网络异常时无第二取源，beta 兜底恒 404 |
| Q12 | `CHANGELOG.md:26` 标 `[0.2.0] - 2026-10-17`，`:95-96` 比较链接指向 `v0.2.0`；本地与远端标签只有 `v0.1.0`、`v0.1.0-beta.1`、`v0.2.0-beta.1`、`dev-latest` | 补打 `v0.2.0` 标签并发布；或把该段退回「未发布」 | 发布负责人 | 发布验收清单；O-25 的资产核对基准 |
| Q13 | `apps/desktop/src-tauri/src/lib.rs:2770-2813`、`apps/web/src/db/platform.ts:52-66`、`packages/core/src/migrate.ts:11-18` 无 `_sqlx_migrations` 检测；插件初始化失败即整体回退 IndexedDB | 造出该形状旧库需要真实存量库样本，样本不在仓库内 | 桌面端负责人 + 存量库样本提供者 | A-20 的 Rust 用例无法先写，待样本到位后排期 |
| Q14 | A-16 远端双管线（`update.ts` 345 行、`preset-update.ts` 675 行）仅共享 `compareVersions`（`update.ts:98`），共享收益未实测 | 先量重合代码比例与错误文案分歧再决定是否排期；重合低则 A-16 不做 | 技术负责人 | A-16 |
| Q15 | 教务在线抓取（R-05/D30）的登录凭据保存方式与抓取合规边界未定 | 存本机加密设置；或复用内嵌窗口会话、不落盘凭据 | 产品 + 法务/合规 | R-05 |
| Q16 | 调课实时推送（R-06/M10）依赖服务端与账号，而 R-08 当前暂不做 | 先做轮询降级；或等服务端立项后再做推送 | 产品 + 技术负责人 | R-06、R-09 |
| Q17 | ICS 导出范围（个人课表 / 含日程）与外部提醒渠道（邮件、IM）未定 | 先只导课表；外部渠道暂不接 | 产品负责人 | R-01、R-07 |
| Q18 | 社交/班级共享课表、成绩与作业管理、收费内购 | docs/01:154-156 明确「需求未提及」，不立项 | 产品负责人 | 无（不进路线图） |

### 7.1 已定结论（Q1–Q19）

| 编号 | 结论 | 去向 |
|---|---|---|
| Q1 | 建成「设备与同步」页（存储类型 / 渠道 / 版本 / 检查更新 / 同步入口 / 关于） | P1-02 |
| Q2 | 保持不占导航；空态按钮跳设置并自动展开导入 | P0-04（已实现） |
| Q3 | 非 Web 端补原生状态查询后再宣称六态 | P1-11 |
| Q4 | 硬删 + 二次确认，不做软删 | P0-01、P0-02（已实现） |
| Q5 | 回退期间禁止写入，只读并引导修复或恢复快照 | P1-07 |
| Q6 | 停在学期边界，边界 ‹ › 置灰，不加学期外水印 | P2-06 |
| Q7 | 本轮不做撤销，靠确认与快照恢复兜底 | P0-02（已实现） |
| Q8 | 文档改「本地优先、外壳需联网加载」，不做 PWA | `docs/01-产品与功能.md`、`README.md` |
| Q9 | 你核对 Release 页面与 `.sha256` 后回填 | 待你执行 |
| Q10 | 你执行 `gh secret list` 核对四项 | 待你执行 |
| Q11 | 发布产物生成 `version.json`，去掉 `beta-latest` | P1-13 |
| Q12 | `[0.2.0]` 段改为 `[0.2.0-beta.1]` 并修比较链接 | 已完成（`1d5c819`） |
| Q13 | 只做检测与提示，不写 Rust 用例 | A-20 |
| Q14 | 先量重合度，本轮不做 A-16 | A-16（暂不做） |
| Q15 | 只用内嵌窗口会话，不落盘凭据 | R-05 |
| Q16 | 只做轮询降级，推送等服务端 | R-06（暂不做） |
| Q17 | ICS 导出时让用户勾选模块 | R-01 |
| Q18 | 社交共享课表、成绩管理、收费内购只评估不排期 | §8 |
| Q19 | 顺序按数据风险优先 | 已执行（P0-06→07→08→03→05→02→01→04） |

## 8. 不建议现在做

1. 全局撤销与操作历史：需要事件溯源、逆向 patch 与操作台账，本轮先以 P0-02 的「确认 + 软删 + 快照兜底」覆盖。
2. 周视图改真 ARIA grid/table：会动绝对定位渲染、行高自适应与拖拽命中（`week-view.tsx:988-1078`），本轮只做 P2-01 的短期语义。
3. 完整键盘拖拽调课：方向键移动、落点预览与读屏播报是一套新交互，先用「详情→调课」等价路径补齐 P2-05 的 spinbutton 键盘。
4. 移动端 24 处 Dialog 全改底部 Sheet：手势、键盘避让、安全区与焦点回归成本高，P2-04 只改 2–3 个高频表单。
5. PWA / Service Worker 与 Web mini 入口裁剪：涉及缓存策略、版本更新与多入口构建，本轮只改文档口径（Q8）。
6. 四套主题间距与密度重做、账号与社交体系：与当前可用性问题无关，P0 收敛前做会放大回归。
7. 悬浮窗完整体验（主窗口唤起、最小化恢复、多窗口焦点）：需 Rust 侧配合，P2-08 只做「双击打开」最小版。
8. Rust `lib.rs`（3562 行）拆模块：89 处 `#[cfg]` 与平台专用代码的纯移动回归风险大于维护收益，等必须改壳时一并做。
9. `core/sync.ts` 行级同步接线、局域网同步一期、删除 `rev`/`dirty` 三合一：与 WebDAV 整包路线冲突、服务端身份与冲突语义未定、删列需新迁移，接一套就会造出第二套冲突处理。
10. 学校名录双数据源合并（DUP-17）：依赖 `out-local/colleage` 生成链（不在仓库内），当前不可复现，容易把 2631 条名单改坏。
11. 自研日期与时间选择器：原生 `input[type=date/time]` 在移动端与无障碍上更可靠，缺的只是字段级错误展示（A-14 覆盖）。
12. 全局 i18n 与 1285 条文案全量 `t()` 化（CAP-11）：无多语言需求，改造触碰几乎所有组件且收益不可验证；术语与高频文案由文案轨覆盖。
13. 卡片注册表插件化或动态注册：会让「卡片不出现」更难排查，静态注册可预测；只把 `void [...]` 改为显式数组即可。
14. 引入状态管理库或请求缓存层：与 `loadAppData` 全量刷新模型冲突，属架构级改动，当前数据量下无收益。
15. 拆 `week-view.tsx` 拖动状态机（BND-07）：当前无拖动缺陷驱动且冒烟依赖其行为，等真有缺陷时随修复一起抽。
16. Windows 11 小组件面板（R-11/D28）立即开工：依赖 WinRT/MSIX 原生实现，投入产出比未验证，先做 R-03 的悬浮窗考试倒计时。
17. iOS 端（R-10/D7）立即开工：先补平台能力抽象（A-09），否则第三端维护成本指数上升。

## 9. Agent 分派与盲审覆盖

### 9.1 分派与执行记录

| 角色 | 执行者 | 任务 | 输入 | 输出 | 依赖 | 验收标准 |
|---|---|---|---|---|---|---|
| 事实 Agent | `fact-agent` | 项目事实清单与证据索引 | 仓库、README、docs/01–06、CHANGELOG、git log | `tmp/todo-rebuild/01-facts.md`（678 行、392 处 path:line） | 无 | 页面、路径、模块、复用、扩展点、技术债、文案位置均带证据 |
| TODO 审计 Agent | `todo-audit` | 旧 35 条逐条核验 | TODO.md、源码、测试、docs、git | `02-todo-audit.md`（519 行） | 无 | 五类判定齐全，每条给代码或测试证据；过时口径与缺口单列 |
| 体验 Agent | `ux-review` | 体验审查 | `apps/web/src`、docs/01、docs/04 | `03-ux.md`（39 条，P0 4/P1 15/P2 20） | 无 | 每条含位置、路径与布局前后、验收指标 |
| 技术 Agent | `tech-review` | 技术审查 | 三端源码、tools、docs | `04-tech.md`（71 条，P0 4/P1 21/P2 38） | 无 | 每条含复用五要素与扩展改动面 |
| 文案 Agent | `copy-review` | 文案与术语 | `apps/web/src`、Android `strings.xml`、Rust 托盘 | `05-copy.md`（159 条替换、31 条术语、12 组不一致） | 无 | 「原文案→新文案」可直接替换 |
| 盲审 Agent A（体验） | `blind-ux` | 独立盲审 | 仓库、原始 TODO.md | `blind/06-blind-ux.md`（18 条问题、35 条独立判定） | 与主审并行 | 35/35 判定带证据；删除建议附代码或测试依据 |
| 盲审 Agent B（技术） | `blind-tech` | 独立盲审 | 仓库、原始 TODO.md | `blind/07-blind-tech.md`（16 条问题、35 条独立判定） | 与主审并行 | 35/35 判定带证据；三端扩展改动面独立评估 |
| 汇总 Agent（裁决） | `todo-audit` | 三方判定矩阵、删除准入、保留项改写 | `02`、两份盲审 | `08a-judgment.md`（131 行） | 审计与两份盲审完成 | 删除同时满足主审判定、盲审同向、代码/测试证据；分歧逐条裁决 |
| 汇总 Agent（产品/文案） | `synth-product` | 合并去重、术语表 | `03`、`05` | `08b-product.md`（288 行、28 条） | 体验与文案完成 | 同位置同问题合并；字段齐全 |
| 汇总 Agent（技术） | `tech-review` | 合并去重 | `04` | `08c-tech-tasks.md`（277 行、19 条） | 技术审查完成 | 48 条原始项合并为 19 条且映射可追溯 |
| 汇总 Agent（拓展/事实） | `fact-agent` | 拓展路线、事实索引、数据层任务 | `04`、`01`、docs/01 | `08c-roadmap.md`（254 行；R 11、D 3、索引 29 行） | 事实与技术完成 | 每条拓展有 docs 编号或代码缺口依据 |
| 组装 Agent（产品/文案） | 独立会话 | 最终章节 | `08a`、`08b` | `10a-product.md`（631 行） | 01/02/03/05 与裁决完成 | 字段齐全、编号连续 |
| 组装 Agent（技术/拓展） | 独立会话 | 最终章节 | `08a`、`08c` 两份 | `10b-tech.md`（600 行） | 01/02/04 与裁决完成 | 字段齐全、A/D 去向单一 |
| 核验 Agent | 独立会话 ×2 | 路径、行号、数量、删除准入、盲审覆盖核对 | 最终稿、源码 | `09a-verify.md`、`09b-verify.md` | 组装完成 | 逐项 PASS/FAIL，FAIL 给修正建议 |
| 定稿 Agent（Lead） | 本次会话 | 按核验修正并写入工作区 | 最终稿、`09a/09b-verify.md` | 工作区 `TODO.md` | 核验完成 | 核验问题闭环、编号与字段自检通过 |
| Lead | 本次会话 | 合并排序、第 9/10 节、写入工作区 | 全部产物 | 工作区 `TODO.md` | 全部完成 | 编号连续、优先级分布达标、证据可复核 |

### 9.2 执行方式与隔离

- 主审五路（事实、审计、体验、技术、文案）并行启动，互不等待；盲审两路与主审同时启动。
- 盲审指令只允许读取仓库本身与原始 `TODO.md`，禁止读取 `tmp/todo-rebuild/` 任何文件；两个盲审在 `08a` 裁决形成之前已独立完成判定。同一文件系统无法做物理隔离，隔离由会话上下文与读取约束保证，未在盲审会话中提供主审结论、重构方案与删除清单。
- 裁决、合成、组装按依赖串行：裁决需要两份盲审；合成需要三轨主审；组装需要裁决与三份合成稿；核验需要最终稿；定稿需要核验报告。
- 同一成员复用其上一阶段上下文完成后续阶段（`todo-audit` 复核裁决、`tech-review` 技术合成、`fact-agent` 拓展合成），其余阶段由独立会话执行，避免上下文串扰。
- 核验阶段以代码为准纠正：`apps/web/package.json` test 脚本在 `:10`、冒烟断言 235 项、`components/school-timetable-card.tsx` 应为 `screens/`。

### 9.3 盲审覆盖

| 范围 | 覆盖情况 |
|---|---|
| 旧 `TODO.md` 35 条 | 体验盲审 35/35、技术盲审 35/35；每条判定附代码或测试证据 |
| 删除 21 条 | 每条同时有主审判定与至少一路盲审同向判定及代码/测试证据；被驳回的 7 条候选见 §10.4 |
| 新增任务 | 由主审三轨产生；盲审独立报出同一问题的标「主审+盲审」：P0-01、P0-02、P0-04、P0-05、P0-07、P1-08、P2-11、P2-12、P2-13、P2-14、P2-15、R-12、A-05、A-06、A-09、A-10、A-11、A-15、A-16、A-20、A-21、A-22；其余标「主审」，盲审未对新增任务排序 |
| 分歧 | 35 条中三方不一致 11 条，裁决见 `08a`；其中 O-25、O-35 未达删除准入，降为 Q14、Q15 |
| 盲审未覆盖 | 无旧条目未被盲审覆盖；新增任务中盲审未独立报出的项（如 P0-03 之外的布局细节、A-07、A-08、A-12、A-17、A-18、A-19）按「主审」标注，未用盲审数量替代证据 |

## 10. 变更记录

### 10.1 删除项（21 条）
| 条目 | 标题摘要 | 删除原因 | 证据或合并去向 |
|---|---|---|---|
| O-01 | 课表补白随自定义时间伸缩 | 验收通过 | `grid-metrics.ts:34-66`、`grid-metrics.test.ts`、smoke:673-684；归档 docs/01 §2.1 |
| O-02 | 行高自适应真实窗口复核 | 验收通过 | `row-height.test.ts`、`course-card.tsx:112-144`、smoke:658-663/2132-2135；人工实测数值不引用 |
| O-03 | 存储位置：便携/安装/自定义路径 | 验收通过 | `lib.rs:269-301` + Rust 3345-3403；Windows 端到端转发布验收清单 |
| O-04 | 数据库 WAL 日志模式开关 | 验收通过 | `journal.ts:5-65`、`journal.test.ts:32-94`；归档 docs/02 §5-8 |
| O-05 | 数据管理模块（JSON/Base64/整包 zip） | 验收通过 | `data-management.ts:21-232`、`data-management.test.ts`、`core/test/backup.test.ts:212-225` |
| O-06 | 备份与恢复（整库文件快照） | 验收通过 | `backup.ts:24-245`、`backup.test.ts:42-143`、Rust 3301；归档 docs/02 §5-8 |
| O-07 | WebDAV 云同步 | 验收通过 | `webdav.ts:21-357`、`webdav.test.ts:56-230`、`core/backup.ts:37-43` |
| O-11 | 引导页可滚动 | 验收通过 | `onboarding.tsx:142-147`、smoke:2815-2825 |
| O-12 | 学校选择收进首启「高级设置」 | 验收通过（不合并） | `onboarding.tsx:196-232`、smoke:2817-2824；与 O-17 合并建议驳回 |
| O-13 | 底部栏与悬浮按钮留白 | 验收通过 | `styles.css:70-71`、`App.tsx:1084-1089`、smoke:2408-2413；人工实测数值不引用 |
| O-16 | 引导页 ExternalLinkConfirm 未挂载 | 验收通过 | `App.tsx:920-922`、smoke:2840-2851 |
| O-17 | 选校改弹窗（SchoolPickerDialog） | 验收通过 | `school-picker-dialog.tsx:16-45`、`onboarding.tsx:222-229`、smoke:2826-2868 |
| O-18 | 卡片布局独立成对话框 | 验收通过 | `layout-panel.tsx:20-101`、`settings-view.tsx:2029-2077`、smoke:2307-2325 |
| O-19 | 倒计时块宽屏只占一半（按需求不改） | 需求撤销 | 两路盲审均判「无待办工作」，决策句归档（保持侧列，需要时在卡片布局切主列） |
| O-21 | 倒计时与「日期与倒计时」合并成一张卡 | 验收通过 | `schedule-cards.tsx:544-595`、smoke:1423-1436/2321-2322 |
| O-22 | 开发者特性默认关闭 | 验收通过 | `settings.ts:127`、`dev-features.ts:6-24`、smoke:1970-1994 |
| O-23 | 首次引导页可跳过 | 验收通过 | `onboarding.tsx:90-140/183-190`、smoke:2789-2801 |
| O-24 | beta 更新源对齐（查发布列表） | 验收通过 | `update.ts:244-264/293-303`、`update.test.ts:193-269` |
| O-29 | 课表卡片去边框、文字完整显示 | 验收通过 | `course-card.tsx:58-102`、smoke:686-697 |
| O-33 | 移除 beta 分支 | 验收通过 | 分支列表 + `plan.test.mjs:36-40` + `docs/06:17` |
| O-34 | 周视图改为「从今天开始的 N 天窗口」 | 验收通过 | `data.ts:168-246`、smoke:705-732 |

### 10.2 合并项（旧组→新条目）
| 组 | 旧条目 | 处置 | 合并去向与理由 |
|---|---|---|---|
| G1 课表布局与窗口 | O-01、O-02、O-34 | 全删 | 归档 docs/01 §2.1 与 CHANGELOG 0.2.0；不设新条目 |
| G2 存储/备份/WebDAV | O-03、O-04、O-05、O-06、O-07 | 全删 | 归档 docs/02 §5-8、docs/06 §1；O-08 属启动验证，不并入 |
| G3 首启与选校 | O-11、O-12、O-16、O-17、O-23 | 全删 | 归档 CHANGELOG 0.1.0/0.2.0；O-12 与 O-17 不合并（断言目标不同） |
| G4 卡片与倒计时 | O-18、O-19、O-21 删；O-28、O-30、O-31 留 | 分拆 | O-19 决策句归档；O-28/O-30/O-31 三项独立验收，不合并 |
| G5 安卓权限 | O-26、O-27 | 留并建议合并 | 合并为 P2-14「Android 真机验收」，一次 Android 11+/13+ 安装同验明文、外部链接、通知、精确闹钟、电池优化 |
| G6 发布流程 | O-24、O-33 删；O-25、O-35 留 | 部分合并 | 合并为 Q9/Q10「发布核对」；核对前仍分列两条待确认 |
| G7 主线 | O-09、O-10、O-32 | 保留 | 互不重叠：迁移兼容 / 页面内容 / 同步；O-10 并入 P1-02 同一对象 |
| G8 诊断验收 | O-14、O-15 | 留并建议合并 | 合并为 P2-12「诊断日志验收」，同一份 `dawn-tick.log` 覆盖布局字段与级别透传 |
| 不合并 | O-30 与 O-31 | — | 动效模式/视图过渡 与 加载态/防重复触发，代码路径与验收手段不同 |
| 不合并 | O-08 与 G2 | — | O-08 是 Windows 启动回归，G2 其余已验收删除，无可合并对象 |
| 不合并 | O-25 与 O-24 | — | O-24 已验收删除；O-25 是发布资产与提交号待确认 |
| 拆分 | UX-02 ↔ UX-03、UX-04 ↔ UX-05、UX-06 ↔ UX-13 | 拆条 | 删除入口 vs 删除确认、导入入口层级 vs 完成死按钮、加考试入口 vs 倒计时空态，各为独立验收 |

### 10.3 保留项与状态调整（14 条）
| 条目 | 新状态 | 新去向 |
|---|---|---|
| O-08 | 待验收 | P2-11（Windows 便携版与安装版启动回归） |
| O-09 | 待办 | A-20（启动兼容自检：识别缺 `_sqlx_migrations` 的旧库） |
| O-10 | 待办 | 并入 P1-02（同一「我的」页对象）；若选方案②则随「设备与同步」交付 |
| O-14 | 待验收 | P2-12（诊断日志验收） |
| O-15 | 待验收 | P2-12（诊断日志验收，与 O-14 合并） |
| O-20 | 待验收 | P2-13（EBWebView 目录搬迁与窗口几何恢复） |
| O-25 | 待确认 | Q9（Release 资产与提交号核对） |
| O-26 | 待验收 | P2-14（Android 真机验收） |
| O-27 | 待验收 | P2-14（Android 真机验收，与 O-26 合并） |
| O-28 | 待验收 | P2-15（倒计时 15 秒节拍刷新） |
| O-30 | 待办 | A-21（视图进入过渡接线） |
| O-31 | 待办 | A-22（加载态接线与 `busy.test.ts` 纳入） |
| O-32 | 暂不做 | R-12（局域网配对同步一期），原因见 §8 第 9 条 |
| O-35 | 待确认 | Q10（GitHub secrets 核对） |
| 合计 | 待验收 7 / 待办 4 / 暂不做 1 / 待确认 2 | 14 条全部有落点，无一条再以旧编号进 TODO |

### 10.4 盲审复核结论
| 结论 | 内容 |
|---|---|
| 覆盖 | 体验 35/35（`06-blind-ux.md` §2）、技术 35/35（`07-blind-tech.md` §2），每条两路覆盖，无单路覆盖 |
| 一致性 | 三方一致 24 条；分歧 11 条（O-03、O-08、O-12、O-15、O-19、O-20、O-25、O-26、O-30、O-31、O-35） |
| 删除被盲审覆盖 | 21 条删除中，20 条「已验收」与既有机制断言（单测 + 冒烟）同时被两路盲审确认；O-19 由两路判「无待办工作」，按需求撤销删除 |
| 删除候选被驳回 | 7 条：O-08 / O-15 / O-20 / O-26（技术判已验收，主审未放行）；O-31（体验判已验收，技术判部分未完成）；O-12（技术建议并入 O-17，Lead 驳回合并）；O-25（主审判已验收，两路证据不足） |
| 删除后的风险提示 | O-02、O-13 含人工实测数值（1000×720、navHeight/mainPadBottom），删除依据只引用机制断言，不引用这些数值；O-03 的 Windows 端到端、O-26/O-27 的真机验收转入发布/真机验收清单，避免「机制已验证」被读成「全机型已验」 |
| 主审新发现 | O-24 的 `beta-latest` 兜底、O-31 的 `busy.test.ts` 未进 test 脚本、O-25 提交号错误，均已记录，不改变裁决 |

### 10.5 口径调整
| 项 | 调整后口径 |
|---|---|
| 删除/保留计数 | 删除 21 = 已验收 20 + 已失效 1（O-19）；保留 14 = 待验收 7 + 待办 4 + 暂不做 1 + 待确认 2；「重复可合并」计 0 |
| 合并口径 | O-12 不并入 O-17、O-28/O-30/O-31 不互相合并、O-08 不并入 G2、O-25 不并入 O-24；合并按「Android 真机验收」「发布核对」「诊断日志验收」三组执行，且不进本稿 |
| 测试/冒烟计数 | 删除项只引用机制断言（单测名 + smoke 行号区间），不引用人工实测数值；新增断言按「冒烟 + 单测 + a11y」三类分别计数，同一断言不重复计，合计 ≥30；`pnpm test`、`pnpm ui:smoke`、`node tools/design/check-a11y.mjs` 全绿为准 |
| 行号口径 | `path:line` 只作定位参考，替换前按原文案与 `data-role` 锚点复核，不按行号批量替换 |
| 文档漂移 | O-25 提交号 `1aac20a` 已过时（标签实指 `819b3e3`）；`docs/01:163` 只有「节次」；`docs/01:66`「导入不占导航」与课表空态入口冲突（Q2）；`docs/04:108-109` 为破坏性操作句式的唯一来源，`DELETE` 与之对齐 |
| 术语口径 | 「课次」退出界面用词（只可留代码注释）；通知权限按 docs/01:79 的六态（已允许 / 未申请 / 已拒绝 / 永久拒绝 / 通知被关闭 / 渠道被静音）；渠道只用开发版/公测版/正式版，beta/dev 只进日志 |
| 优先级口径 | P0 8 条（产品 5 + 技术 3）、P1 12 条、P2 10 条；另 §3.1 待验收 5 条（P2-11…P2-15）、§5 追加 A-20…A-22 3 条、§4 追加 R-12 1 条；08b 与最终排期的定级差异（UX-06 自 P0 调 P1，UX-15/CP-04/CP-05 自 P1 调 P2）已在各条「来源」注明，ICE 分值不变 |
### 10.6 核验修正记录

| 核验 | 问题 | 处理 |
|---|---|---|
| 09a（第 0–3 节与第 10 节） | 1 条目录错引（components/school-timetable-card.tsx 应为 screens/）、1 条缩写路径、冒烟断言写 216（实测 235）、中文行与设置页行数、孤儿行、状态值带括号、Q9/Q10 与 Q14/Q15 重复 | 已逐条修正，计数与路径以本文口径为准 |
| 09b（第 4–9 节） | 5 条来源归属与第 9.3 节不一致、第 9.3 节漏列 A-20…A-22、A-13/A-17 依据不实、A-15 字段对应不实、A-19 依赖数、映射表错位、R-06 依赖不可达 | 已修正；A-17 改引 components/school-picker.tsx:71 与 school-picker-model.ts:88/386-398，A-15 改述为「手抄已漂移：缺 timeZone」 |
| 两路核验共同确认 | 旧 35 条两路 35/35 覆盖属实；65 条任务 15 字段齐全；编号连续；删除 21 条与 08a 集合一致 | 无需修改 |

### 10.7 本轮执行记录（P0 批次）

| 任务 | 提交 | 主要改动 | 验证 |
|---|---|---|---|
| P0-06 | `ac3fd31` | 备份键由设置键派生，补两项视图开关 | core 250 用例（+2）、typecheck |
| P0-07 | `c162b73` | 新增 `package.ts`，导出/导入/WebDAV 共用并恢复预设 | web 174 用例（+3）、冒烟 |
| P0-08 | `1d4c252` | `setSchedules` 派生 `weeks_raw`，开库回填 | core 252 用例（+2） |
| P0-03 | `aa3b32c` | 详情关闭出口、窄宽覆盖层、侧栏折叠 | 冒烟 +5 条 |
| P0-05 | `1c2bea8` | 「完成」收起导入区、步骤文案 | 冒烟 +2 条 |
| P0-02 | `b38143a` | 全局确认框与删除句式，8 处接入 | 冒烟 +3 条 |
| P0-01 | `3483df4` | 详情删除条目、时间线长按删除 | 冒烟 +5 条 |
| P0-04 | `4b2ce8a` | 设置页快捷动作、单一导入入口、卡内去折叠 | 冒烟 +3 条，共 253 项 |
| 文档 | `1d5c819` | CHANGELOG 补本次修复、0.2.0 段改为 beta | 结构检查、版本检查通过 |

### 10.8 第一批并行任务执行记录（2026-10-19）

| 任务 | 分支提交 | 合入 dev | 验证 |
|---|---|---|---|
| P1-13 更新兜底 `version.json` | `f120fdb` | `b0c03d2` | web 176、core 252、workflows 检查、version-json 3 条 |
| A-20 旧库启动自检 | `85a460f` | `6c59207` | core 254、web 177 |
| A-21 视图进入过渡 | `b28f23a` | `84be77c` | 冒烟 254（+1） |
| P2-01 表单标签与周视图语义 | `a985b10` | `a5fd4e7` | 冒烟 256（+3） |
| P2-02 导入失败直达手动映射 | `a222bdd` | `a68d398` | 冒烟 256；冲突筛选另立 P2-16 |
| P2-03 引导页导入格式对齐 | `19062ae` | `8b4af70` | 冒烟 255（+2） |

- 合并后批次验证：`pnpm typecheck`、core 254、web 177、tools 36、界面冒烟 262 项全过。
- 本批另修 Release 正文 Full Changelog（`5342c04`）：用 CHANGELOG 段落作正文时按渠道基准追加比较链接，滚动标签不作为基准。
- 发版：`v0.3.0-beta.1` 指向 `2a8650c`，已推送触发 beta 构建；段落包含 P0 与第一批 6 条。

### 10.9 第二批并行任务执行记录（2026-10-20）

| 任务 | 分支提交 | 合入 dev | 验证 |
|---|---|---|---|
| P1-10 节次/排课/这节课 + en dash | `cafa6fe` | `ab5adf2` | core 256、web 184、冒烟 274 |
| P1-08 空态三态与主行动 | `d02f059` | `39848e0` | 新增 `week-empty` 单测 4 条、冒烟 275（+6） |
| P2-16 导入只看冲突项 | `72d8c05` | `cbfc534` | core +2、冒烟 +4 |
| P1-02 「我的」改建「设备与同步」页 | `40cb891` | `bb4e860` | 页面迁移 −1485 行、冒烟 275 |
| P2-08 悬浮窗双击开主窗口、小组件文案 | `42552a3` | `53146b9` | cargo check/test、冒烟 279（+3） |
| P1-04 调课统一为一个弹窗 | `e592f1c` | `3d019ed` | 新增 6 条冒烟断言、冒烟 283 |
| P2-04 前两部分：课程名校验与忙碌态 | `5d88f75` | `dc898d8` | core +1、web +1、冒烟 285（+2） |
| P1-07 原生库回退可见且只读 | `fc7489d` | `5962a0e` | 新增回退/只读单测、冒烟 291（+6） |
| P1-09 错误页与加载页补行动 | `e672e6c` | `5962a0e` | `fail()` 句式统一、冒烟 +6（与 P1-07 同批） |
| A-13 CI 纳入界面冒烟与 a11y、`busy.test.ts` | `c933759` | — | CI 增加 `pnpm ui:smoke`、Android 编译校验 job、`busy.test.ts` 进 web 测试 |

- 批次验证：`pnpm typecheck`、core 257、web 189、tools 36、界面冒烟 291 项全过。
- 偏离：P1-04 的「性质（课程/实验）」无对应课程字段，按删除处理（原实现只影响调课事件标签）；P1-02 未把「悬浮窗/小组件」迁到设备页，留在「外观」卡；P1-08 快照空态文案仍在设备页待补；P2-04 移动端底部 Sheet 未做，另立 P2-17。
- CI 增加 Android 编译校验 job 的原因：安卓工程此前只在发版时编译，编译错误要到打标签才暴露（`v0.3.0-beta.1` 首次构建即因缺校验而失败，重跑后通过）。
