# 学校富目录（`packages/core/src/schools/directory.json`）

给「选择学校」这类界面用的**本地检索索引**：2659 所学校，带省市、标签、门类、
拼音全拼、拼音首字母缩写与简称全拼。零第三方依赖、零网络：JSON 在打包期被 import 进来，
浏览器 / Node / 打包产物拿到的是同一份。

```
tools/schools/
  import-directory.mjs    生成脚本（零依赖，日常只用它）
  pinyin-table.json       汉字 → 拼音 数据表（生成物，随仓库提交）
  gen-pinyin-table.py     重新生成上面那张表的**作者期**脚本（需要 Python + pypinyin）
  README.md               本文件
packages/core/src/schools/
  directory.json          生成物，不要手改
  index.ts                零依赖读取 + 检索 API
packages/core/test/schools.test.ts
```

## 1. 数据来源（只读，本机 `out-local/colleage/`，不进版本库）

| 文件 | 实际结构 | 用途 |
| --- | --- | --- |
| `大学目录.json` | 字符串数组，2631 个校名 | 校名索引（有的校名只有名字、没有详情） |
| `大学详情/<校名>.json` | `{ logo, summary, tags[], attrs{}, imgs[] }`；`attrs` 的键**不固定**（`院校隶属`/`所在地区`/`创建时间`/`硕士点`/`博士点`/`重点学科数`/`院士数`/`地址`），文件名就是校名 | `tags`、简介里的「简称」 |
| `各行政区大学列表/<省>.json` | `{ p, datas: [{ name, code, authorities, location, level, tip }] }`；港澳台条目没有 `code`，只有 `href` | 教育部学校代码、省市、本科/专科、办学性质 |
| `全国普通高等学校名单.xls` | 437 KB 的 xls | **不使用**，见下 |

xls 为二进制表格格式，零依赖方案需要手写 BIFF/OLE 解析器，成本高于收益。
脚本将其写入产物 `_source.xls` 并标记 `used: false`；人工对账时直接打开该文件。

拼音处理：Node 不内置汉字注音能力，第三方拼音库与「零依赖」约束冲突。采用方案为
把读音固化成**纯数据表** `pinyin-table.json`（741 个汉字 + 11 条多音字词组修正），
由 `gen-pinyin-table.py` 用 pypinyin 生成，脚本逐条回放校验（2659 个校名的音节与
pypinyin 完全一致），导入脚本只读该表，日常导入不需要 Python。
数据源出现新汉字时先补表再导入：脚本把「拼音表未覆盖的汉字」列入摘要。

## 2. 生成命令

```bash
# 生成（默认读 out-local/colleage，写 packages/core/src/schools/directory.json）
node tools/schools/import-directory.mjs

# 只看摘要、不写文件；与现有产物不一致时退出码 1（适合放进 CI 守门）
node tools/schools/import-directory.mjs --check

# 换数据源 / 换输出位置
node tools/schools/import-directory.mjs --source D:\somewhere\colleage --out tmp\directory.json
```

脚本**幂等**：不写时间戳、不依赖目录遍历顺序，同一份输入产出同一份字节；
内容与现有产物一致时**不写入文件**（mtime 不变），摘要末尾写明「未改动文件」。
重复运行后 `git status --short packages/core/src/schools` 无变化。

## 3. 字段语义（`School`）

| 字段 | 含义 | 覆盖 |
| --- | --- | --- |
| `id` | 教育部学校代码（如 `4111010003`）；港澳台等没代码的用 `x-<拼音>` | 2659/2659 唯一 |
| `name` | 校名全称（以教育部名单为准，保留原始全角括号） | 100% |
| `shortName` | 简介里写明的中文简称（「清华」「北大」），只在简介里出现「简称X」时才有 | 400 |
| `shortPinyin` | 简称的无声调全拼（`beida` → 北京大学），由 `shortName` 用同一张拼音表生成 | 397 |
| `province` | 省级行政区（`北京市`、`广东省`、`内蒙古自治区`、`香港`…） | 2657 |
| `city` | 地级行政区（`广州市`、`大理白族自治州`…） | 2633 |
| `tags` | 详情标签 + 名单里的 `level`(本科/专科) + `tip`(民办/中外合作办学…) | 2635 |
| `category` | 由标签里的「XX类」推出：`综合`/`理工`/`师范`/`财经`/`医药`/`艺术`/`农林`… | 2439 |
| `pinyin` | 校名全拼，无声调小写连写（`qinghuadaxue`） | 2659 |
| `initials` | 校名拼音首字母（`qhdx`） | 2659 |
| `system` | 教务系统标识 | **一律为空** |

`system` 为空的原因：该数据源不含教务入口信息，留空优于推测。接入教务走
`src/import/schools.ts` 的 `MANUAL_SCHOOLS` 手工条目或用户自定义学校；`School.system`
保留为可选字段，取得可靠来源后可直接填充。

检索口径见 `index.ts` 顶部注释：中文全名 / 中文简称 / **简称全拼** / 校名全拼 / 首字母五种键都命中，
大小写不敏感、拼音键忽略空格；`searchSchools('')` 返回全部。筛选 `tags` 是「全都要满足」，
`province` 支持简写（`北京` → `北京市`），`category` 带不带「类」等价。

简称全拼解决的是「按简称的读音搜」：校名全拼 `beijingdaxue` 既不以 `beida` 开头也不包含它，
所以 `searchSchools('beida')` 在过去是搜不到北京大学的；有了 `shortPinyin` 它稳定排第一。

## 4. 规矩：只导入文本短字段

- **logo / imgs 一律不入库**。它们为外链（部分为百度图片的临时缩略图地址），
  入库会产生失效链接与体积膨胀；需要图片时另行处理。
- **`summary` 长文本不入库**，仅从中提取字级别的「简称」。
  单份简介数十至数百字，2600 份合计数 MB，且会随数据源变化。
- `attrs` 里的数字（院士数、博士点等）不入库：口径不统一、缺失较多，
  需要时单独制作带来源与年份的统计表。
- 结果：产物约 **593 KiB**，单文件、可直接 diff，`git` 中一行一所学校。

## 5. 数据源更新后的流程

1. 用新的数据覆盖 `out-local/colleage/`（保持同样的目录结构）。
2. 查看脚本摘要里的「拼音表未覆盖的汉字」：有新增汉字时执行一次
   `python tools/schools/gen-pinyin-table.py`（需要 `pip install pypinyin`）刷新
   `pinyin-table.json`。
3. `node tools/schools/import-directory.mjs` 重新生成目录，并逐条阅读摘要：
   被跳过的条目、按别名补省市的条目、id 撞车、未匹配到行政区名单的条目均在摘要内。
4. `pnpm -C packages/core test`（含 `test/schools.test.ts`）与 `pnpm -C packages/core typecheck`。
5. 一并提交 `directory.json` 的 diff；摘要里的数字变化即本次更新的说明。

## 6. 已知的数据源缺陷（脚本已处理，摘要里会逐条列出）

- **串档**：5 个详情文件的正文属于**别的学校**，例如 `华北电力大学（保定）.json`
  内为海军军医大学的内容。脚本按「简介须提到本校名，否则检查开头 16 字内是否出现别的校名」
  判定，命中则整份详情不采信，因此 `华北电力大学（保定）` 仅有省市与层次，无标签。
- **空壳**：140 个 45 字节的详情文件（`summary` 与 `tags` 均为空），无字段可导；
  另有 10 个文件简介为空但 `tags` 有值，该部分标签照常导入。
- **改名/校区**：`海军军医大学`、`空军军医大学` 不在这份教育部快照内，
  `华北电力大学（保定）`、`阜阳师范学院` 与名单里的名字不一致。脚本用
  `NAME_ALIASES` 表只借其省市/层次（不借用教育部代码，避免撞 id）。
  未补齐项：海军军医大学、空军军医大学没有 `province`。
- **港澳台**：名单内无教育部代码，产物用 `x-<拼音>` 兜底；也没有 `level`/`tip`，
  因此这 24 条 `tags` 为空（`index.ts` 的测试覆盖了这种缺字段条目）。
- **简称全拼**：`shortPinyin` 与校名拼音共用同一张表，限制项一致：
  1. **多音字**按单字默认读音（词组修正表只有 11 条，均为校名整词，覆盖不到简称），
     个别简称的读音可能与习惯读法不同；
  2. 简称内含**表未覆盖的汉字**时，`shortPinyin` **整个字段不产出**（当前 3 条：
     含「为」「独」「粤」的简称），摘要中「有简称但注不出拼音」一节逐条列出；
     该档检索键不产出，也不产出缺字的半截拼音（`为西职院` → `xizhiyuan` 这类错键影响更大）；
  3. 同一简称全拼会撞车（`nanda` 同时对应南京大学与南昌大学，`xida` 有 3 所），
     检索按「整串相等 → 前缀 → 包含」加办学层次排序，撞车时 985/211 院校排前；
  4. `shortName` 取自简介里「简称X」的正则，个别条目提取到的是「独立学院」这类
     非简称词（该条同样没有 `shortPinyin`：「独」不在表内），属数据源文本问题。
- 与 `packages/core/src/import/schools.ts` 的 `DIRECTORY_NAMES`（2631 条）对账：
  名单里的 2631 条在富目录里均可找到；富目录多出的 28 条为港澳台 24 条
  加 海军军医大学 / 空军军医大学 / 华北电力大学（保定）/ 阜阳师范大学。
