# 预设快照的同步（tools/presets）

这个目录只有一个脚本：`sync-snapshot.mjs`。它把**预设仓库** `dawn-tick-presets` 产出的
真实快照同步进主仓库，成为「内置预设」——也就是 App 离线时用的那份兜底数据。

零依赖：只用 Node 内置模块（`node:crypto` / `node:fs` / `node:path` / `node:url`）。

## 1. 两个仓库的分工

| 仓库 | 管什么 | 谁改 |
| --- | --- | --- |
| `dawn-tick-presets`（独立仓库） | 内容的**唯一来源**：作息表、教务系统、JS 适配器，以及它们的内容快照与 `version.json` | 维护预设的人 |
| 本仓库 `dawn-tick`（主仓库） | 内置的**离线兜底副本**：`packages/core/src/config/` 下的几个 JSON，打包期内联进三端 | 同步脚本自动写，**不要手改** |

主仓库里与预设有关的一共四个文件：

| 文件 | 内容 | 谁写 |
| --- | --- | --- |
| `packages/core/src/config/timetables.json` | 合并后的作息表数组（`BUILTIN_TIMETABLES` 的来源） | 人工（跟随预设仓库内容） |
| `packages/core/src/config/systems.json` | 合并后的教务系统数组（`readSystemsConfig()` 的来源） | 人工（跟随预设仓库内容） |
| `packages/core/src/config/builtin-preset-snapshot.json` | 预设仓库快照的**原文副本**（含 `hash`、`generatedAt`） | 同步脚本 |
| `packages/core/src/config/preset-version.json` | `{ version, schemaVersion }` | 同步脚本 |

## 2. 用法

```bash
# 版本从 <预设仓库>/version.json 取
node tools/presets/sync-snapshot.mjs --from "E:/work/dsh/dawn-tick-presets"

# 指定版本（必须真的存在 snapshot/presets-<version>.json）
node tools/presets/sync-snapshot.mjs --from "E:/work/dsh/dawn-tick-presets" --version 1.0.1

# 只校验、不写盘（CI 里可以用来发现「预设仓库有新快照但主仓库没同步」）
node tools/presets/sync-snapshot.mjs --from "E:/work/dsh/dawn-tick-presets" --check
```

脚本读 `<预设仓库>/version.json` 与 `<预设仓库>/snapshot/presets-<version>.json`，
**复算快照的内容哈希**（口径见下），校验通过后才把两个文件写进主仓库，并打印中文摘要
（来源、版本、生成时间、内容清单、内容哈希、写入路径）。

行为约定：

- **幂等**：内容一致时报告「未变化」，**不触碰文件**（连 mtime 都不改），所以连跑两次
  `git status --short packages/core/src/config` 是干净的。
- **失败不落盘**：目录不存在、快照缺失、JSON 非法、`hash` 格式不对、哈希不符、清单与内置
  配置对不上，都会打印中文错误并以非 0 退出，且**一个文件都不写**（所有校验都在写入之前完成）。
- 写入的是快照**原文**（逐字节复制），不重新序列化、不重新生成 `generatedAt`、不改 `hash`。

## 3. 哈希口径（全仓只有一份实现）

```
hash = "sha256:" + sha256( canonicalJson( 去掉 hash 字段后的快照对象 ) )
```

- `canonicalJson`：对象键排序、数组保序、无多余空白；
- 与预设仓库 `scripts/snapshot.mjs` 的口径逐字一致，因此同一份数据在任何机器上得到同一个哈希。

实现只存在一处：

- `packages/core/src/config/preset-hash.ts` —— `canonicalPresetJson()` + `sha256HexSync()`；
  它是**纯 TS**（自己实现 SHA-256，不用 `node:crypto`），因为同一份代码要跑在浏览器里：
  Vite 会把 `node:crypto` 「为浏览器外部化」，调用 `createHash` 会直接抛错，所以这里不能用平台 API；
- `packages/core/src/config/index.ts` 转出这两个函数（`BUILTIN_PRESET_SNAPSHOT`、
  `verifyBuiltinPresetSnapshot()` 也在这里）；
- `apps/web/src/preset-update.ts` 只从 core **转出**同名函数（Web 端下载校验用的异步
  `sha256Hex()` 仍在本模块，它优先走 WebCrypto，没有 WebCrypto 时回落到 core 的 `sha256HexSync()`）；
- `tools/presets/sync-snapshot.mjs` **直接 import** core 的 `preset-hash.ts` 复算哈希
  （Node 24 可以原生 import `.ts`，不需要构建），所以脚本没有第二份实现。

## 4. 版本与 schemaVersion 的语义

- **`version`（内容版本）**：预设仓库的版本线，形如 `1.0.0`（SemVer）。每发布一版内容就 +1；
  App 的「检查预设更新」用它做比较，只接受**更高**的版本。内置值即 `BUILTIN_PRESET_VERSION`。
- **`schemaVersion`（结构版本）**：快照字段形状的版本，当前为 `1`。只在快照字段增删或改语义时 +1；
  App 见到比自己能消费的 `schemaVersion` 更高的快照会**拒收**（而不是猜着解析）。
- 两者独立：可以只发内容（`version` 变、`schemaVersion` 不变）；结构一变，旧 App 必须拒收。
- 快照文件里没有 `schemaVersion` 时按 `1` 处理（1.0.0 时期的形状）。

## 5. 规矩（重要）

> **改了预设仓库里的任何内容（作息表 / 教务系统 / 适配器），必须重新生成快照并跑同步脚本。**

完整流程：

```bash
# ① 在预设仓库里改内容
# ② 在预设仓库里重新生成快照（它会写 snapshot/presets-<version>.json）
cd E:/work/dsh/dawn-tick-presets
node scripts/snapshot.mjs            # CI 下用 SOURCE_DATE_EPOCH 或 --at 固定 generatedAt
# ③ 把新内容落到主仓库的 timetables.json / systems.json（合并数组，顺序是业务语义）
# ④ 回主仓库跑同步脚本
cd E:/work/dsh/dawn-tick
node tools/presets/sync-snapshot.mjs --from "E:/work/dsh/dawn-tick-presets"
```

第 ③ 步是人工的：快照清单记的是预设仓库里**每个单文件**的哈希与路径，而内置是合并后的数组，
两者形态不同，脚本不会替你重排数组内容。`verifyBuiltinPresetSnapshot()` 会检查
「清单 id 集合 ⇔ 内置配置 id 集合」是否一一对应，漏加或多加一个都会当场报出来。

## 6. 自检与测试

- 运行时自检：`verifyBuiltinPresetSnapshot()` 返回 `{ ok, reason? }`，复算快照哈希，
  并核对快照 `sources.timetables` / `sources.systems` 与内置 `timetables.json` / `systems.json`
  的 id 集合完全一致（只比集合，不比顺序——快照按文件名排序，内置顺序是识别优先级）。
- 单元测试：`packages/core/test/preset-snapshot.test.ts`（已挂进 `pnpm -C packages/core test`），
  覆盖哈希复算、篡改检测、内置一致性、同步脚本成功写入 / 哈希不符非 0 退出 / 目录不存在非 0 退出。
- 一致性边界：快照清单里每条的 `sha256` 是预设仓库**单文件**的原文哈希，与内置合并数组复算出的
  哈希本来就不同，所以校验不拿它去比内置正文；内置正文的漂移靠上面那条流程规矩、
  `config.test.ts` 的逐条断言，以及 `builtinPresetSourcesDigest()` 导出的正文指纹人工审计。
