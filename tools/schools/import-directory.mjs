#!/usr/bin/env node
/**
 * 学校富目录导入脚本（零第三方依赖，可重复运行、幂等）。
 *
 * 输入（只读，默认 `out-local/colleage`，可用 `--source` 指定）
 *   - 大学目录.json           校名索引（字符串数组）
 *   - 大学详情/<校名>.json    每校一条：{ logo, summary, tags[], attrs{}, imgs[] }
 *   - 各行政区大学列表/<省>.json  { p, datas: [{ name, code, authorities, location, level, tip, href? }] }
 *   - 全国普通高等学校名单.xls  **不使用**（xls 是二进制格式，零依赖不解析；只作人工对账参考）
 *   - pinyin-table.json       拼音数据表（汉字 → 拼音 / 词组修正），见 gen-pinyin-table.py
 *
 * 输出
 *   packages/core/src/schools/directory.json
 *
 * 规矩
 *   - **只导入结构化短字段**：校名、简称、省市、标签、门类、拼音、首字母。
 *     logo / imgs / summary 一律不入库（图片是外链，简介是长文本，都会把目录撑爆且易过期）。
 *   - 不写时间戳、不遍历目录顺序：同一输入必定产出同一份字节，重复运行 `git status` 无变化。
 *   - 数据源更新后重跑本脚本即可；详见 tools/schools/README.md。
 *
 * 用法
 *   node tools/schools/import-directory.mjs [--source <目录>] [--out <文件>] [--check] [--quiet]
 *   --check  只比对、不写文件；与现有产物不一致时退出码 1（用于 CI 守门）
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_SOURCE = path.join(REPO_ROOT, 'out-local', 'colleage');
const DEFAULT_OUT = path.join(REPO_ROOT, 'packages', 'core', 'src', 'schools', 'directory.json');
const PINYIN_TABLE = path.join(HERE, 'pinyin-table.json');

/** 教务处系统：本数据源里没有任何教务系统信息，一律留空（产物中省略 system 字段）。 */
const SYSTEM_FROM_SOURCE = false;

/**
 * 改名/校区别名表：数据源里的行政区名单是较早的快照，个别学校后来改了名，
 * 或者只在详情里以「校本部（校区）」形式出现。这里只借它补 province / city / level，
 * **绝不借 code**（否则会和本体撞 id）。每条都在导入摘要里单独报告。
 */
const NAME_ALIASES = new Map([
  ['海军军医大学', '第二军医大学'],
  ['空军军医大学', '第四军医大学'],
  ['华北电力大学(保定)', '华北电力大学'],
  ['阜阳师范学院', '阜阳师范大学'],
]);

// ---------------------------------------------------------------- 小工具

const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;

function isHan(char) {
  return HAN.test(char);
}

/** 全角括号/斜杠折半角、压缩空白：仅用于「同名判断」，不写进产物。 */
function normalizeName(name) {
  return String(name)
    .replace(/\uFF08/g, '(')
    .replace(/\uFF09/g, ')')
    .replace(/\uFF0F/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJson(file, problems) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    problems.push(`${path.basename(file)}：JSON 解析失败（${error.message}）`);
    return undefined;
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** 目录摘要：文件名 + 内容一起哈希，顺序固定，同一份输入得到同一个摘要。 */
function digestDir(dir) {
  const hash = createHash('sha256');
  for (const file of readdirSync(dir).sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path.join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------- 拼音

function loadPinyinTable(problems) {
  const raw = readJson(PINYIN_TABLE, problems);
  if (raw === undefined) return { chars: new Map(), phrases: [], sha256: '' };
  const chars = new Map(Object.entries(raw.chars ?? {}));
  const phrases = Object.entries(raw.phrases ?? {})
    .map(([key, syllables]) => [key, syllables])
    .sort((left, right) => right[0].length - left[0].length);
  return { chars, phrases, sha256: sha256(readFileSync(PINYIN_TABLE, 'utf8')) };
}

/**
 * 汉字 → 无声调拼音。词组修正「最长匹配优先」，其余逐字查表。
 * 返回按字对齐的音节数组；非汉字原样占位，方便定位未覆盖的字。
 */
function syllablesOf(name, table) {
  const out = [];
  let position = 0;
  while (position < name.length) {
    const hit = table.phrases.find(([key]) => name.startsWith(key, position));
    if (hit !== undefined) {
      out.push(...hit[1]);
      position += hit[0].length;
      continue;
    }
    const char = name[position];
    out.push(isHan(char) ? table.chars.get(char) : char);
    position += 1;
  }
  return out;
}

function pinyinOf(name, table, missing) {
  const syllables = syllablesOf(name, table);
  const han = [];
  let hanCount = 0;
  for (let index = 0; index < name.length; index += 1) {
    if (!isHan(name[index])) continue;
    hanCount += 1;
    const syllable = syllables[index];
    if (typeof syllable !== 'string' || syllable.length === 0) {
      missing.add(name[index]);
      continue;
    }
    han.push(syllable);
  }
  return {
    pinyin: han.join(''),
    initials: han.map((syllable) => syllable[0]).join(''),
    /** 每个汉字都查到了读音。为假说明有字被跳过，这个拼音是**缺字**的半截结果，不能当完整拼音用 */
    complete: han.length === hanCount,
  };
}

// ---------------------------------------------------------------- 简称

const SHORT_NAME_PATTERN =
  /简称\s*[”"“「『]?\s*([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]{2,6}?)(?=[、，。；;：:）)（(,和或]|[”"“”」』]|[A-Za-z0-9]|\s|$)/u;

/** 从简介里抠「简称X」；只收 2~6 个汉字，取不到就留空（简介正文本身不入库）。 */
function shortNameOf(name, summary) {
  if (typeof summary !== 'string' || summary.length === 0) return undefined;
  const match = SHORT_NAME_PATTERN.exec(summary);
  if (match === null) return undefined;
  const candidate = match[1];
  if (candidate === name || candidate.length >= name.length) return undefined;
  return candidate;
}

// ---------------------------------------------------------------- 门类 / 标签

const CATEGORY_PATTERN = /^(.{1,6}?)类$/u;

function categoryOf(tags) {
  for (const tag of tags) {
    const match = CATEGORY_PATTERN.exec(tag);
    if (match !== null) return match[1];
  }
  return undefined;
}

// ---------------------------------------------------------------- 详情归属校验

const BASE_NAME_PATTERN = /[（(].*$/u;
const HEAD_WINDOW = 16;

/**
 * 详情文件是否真的属于这所学校。
 *
 * 数据源里有 5 个串档文件（例如 `华北电力大学（保定）.json` 里装的是海军军医大学的正文），
 * 直接采信会把「医科（军事）类」「211」这类标签和错误简称安到别人头上。
 * 判据：简介必须提到本校名（去掉括号后缀也算）；否则看简介开头 16 个字里
 * 是否出现了**别的**校名——出现就是串档，整份详情丢弃。
 * 另有约 150 个 45 字节空壳文件（summary/tags 全空），也没有可导入的字段。
 */
function detailVerdict(name, payload, masterNames) {
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
    : [];
  if (summary.length === 0 && tags.length === 0) return '空详情（45 字节空壳），无可导入字段';
  if (summary.length === 0) return undefined;
  const base = name.replace(BASE_NAME_PATTERN, '');
  if (summary.includes(base)) return undefined;
  const head = summary.slice(0, HEAD_WINDOW);
  const other = masterNames.find(
    (candidate) => candidate !== name && candidate.replace(BASE_NAME_PATTERN, '') !== base && head.includes(candidate),
  );
  return other === undefined ? undefined : `疑似串档：简介开头讲的是「${other}」`;
}

// ---------------------------------------------------------------- 读数据源

function readSource(sourceRoot, problems, notes) {
  const detailDir = path.join(sourceRoot, '大学详情');
  const regionDir = path.join(sourceRoot, '各行政区大学列表');

  let indexNames = [];
  const indexPath = path.join(sourceRoot, '大学目录.json');
  if (existsSync(indexPath)) {
    const raw = readJson(indexPath, problems);
    if (Array.isArray(raw)) {
      indexNames = raw.filter((item) => typeof item === 'string' && item.trim().length > 0);
      if (indexNames.length !== raw.length) {
        notes.push(`大学目录.json：跳过 ${raw.length - indexNames.length} 条空/非字符串条目`);
      }
    }
  } else {
    problems.push('大学目录.json：文件不存在，索引部分按空处理');
  }

  const details = new Map();
  let detailFiles = 0;
  if (existsSync(detailDir)) {
    for (const file of readdirSync(detailDir).sort()) {
      if (!file.endsWith('.json')) continue;
      detailFiles += 1;
      const payload = readJson(path.join(detailDir, file), problems);
      if (payload === undefined || payload === null || typeof payload !== 'object') continue;
      details.set(normalizeName(file.slice(0, -'.json'.length)), { name: file.slice(0, -'.json'.length), payload });
    }
  } else {
    problems.push('大学详情/：目录不存在，详情部分按空处理');
  }

  const regionEntries = [];
  const regionByKey = new Map();
  let regionFiles = 0;
  if (existsSync(regionDir)) {
    for (const file of readdirSync(regionDir).sort()) {
      if (!file.endsWith('.json')) continue;
      regionFiles += 1;
      const payload = readJson(path.join(regionDir, file), problems);
      if (payload === undefined || !Array.isArray(payload.datas)) continue;
      const province = typeof payload.p === 'string' ? payload.p.trim() : '';
      if (province.length === 0) {
        notes.push(`各行政区大学列表/${file}：缺少 p 字段，整份跳过`);
        continue;
      }
      for (const item of payload.datas) {
        if (item === null || typeof item !== 'object') continue;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (name.length === 0) {
          notes.push(`各行政区大学列表/${file}：跳过 1 条无 name 记录`);
          continue;
        }
        const entry = {
          province,
          name,
          code: typeof item.code === 'string' && item.code.length > 0 ? item.code : undefined,
          location: typeof item.location === 'string' && item.location.length > 0 ? item.location : undefined,
          level: typeof item.level === 'string' && item.level.length > 0 ? item.level : undefined,
          tip: typeof item.tip === 'string' && item.tip.length > 0 ? item.tip : undefined,
        };
        regionEntries.push(entry);
        const key = normalizeName(name);
        if (!regionByKey.has(key)) regionByKey.set(key, entry);
      }
    }
  } else {
    problems.push('各行政区大学列表/：目录不存在，省市部分按空处理');
  }

  return { indexNames, details, detailFiles, regionEntries, regionByKey, regionFiles };
}

// ---------------------------------------------------------------- 组装

function buildSchool(seen, detail, region, exact, table, missing) {
  // 校名以主表里第一条来源为准（行政区名单优先），别名借用**不改**校名。
  const name = seen.name;
  const tags = [];
  const push = (tag) => {
    if (typeof tag !== 'string') return;
    const value = tag.trim();
    if (value.length === 0 || value === '未知') return;
    if (!tags.includes(value)) tags.push(value);
  };
  for (const tag of detail?.payload.tags ?? []) push(tag);
  // tip（民办 / 中外合作办学…）只认「精确同名」那条记录，别名借用来的不算。
  push(exact?.tip);
  push(region?.level);

  const category = categoryOf(tags);
  const { pinyin, initials } = pinyinOf(name, table, missing);
  const shortName = shortNameOf(name, detail?.payload.summary);
  // 简称拼音：用同一张表给简称注音（`北大` → `beida`），这样检索键就多一档「简称全拼」。
  // 简称是 2~6 个汉字（见 SHORT_NAME_PATTERN），非汉字不会进来；但表里可能缺字——
  // 那种情况下 `complete` 为假、拼音是缺字的半截结果，**一律不写进产物**
  // （宁可这条没有 shortPinyin，也不能让「为西职院」变成「xizhiyuan」这种错键）。
  const shortPinyinInfo = shortName === undefined ? undefined : pinyinOf(shortName, table, missing);
  const shortPinyin = shortPinyinInfo !== undefined && shortPinyinInfo.complete ? shortPinyinInfo.pinyin : '';

  const school = { id: '', name };
  if (shortName !== undefined) school.shortName = shortName;
  if (shortPinyin.length > 0) school.shortPinyin = shortPinyin;
  if (region?.province !== undefined) school.province = region.province;
  if (region?.location !== undefined) school.city = region.location;
  school.tags = tags;
  if (category !== undefined) school.category = category;
  if (pinyin.length > 0) school.pinyin = pinyin;
  if (initials.length > 0) school.initials = initials;
  if (SYSTEM_FROM_SOURCE && region?.system !== undefined) school.system = region.system;
  // id 只认「精确同名」那一条行政区记录的代码；别名借用来的省市绝不带代码，否则会撞 id。
  school.id = exact?.code !== undefined ? exact.code : `x-${pinyin.length > 0 ? pinyin : seen.key}`;
  return school;
}

function build(sourceRoot, table, report) {
  const { indexNames, details, regionEntries, regionByKey } = readSource(sourceRoot, report.problems, report.notes);
  report.source.index.names = indexNames.length;
  report.source.details.files = details.size;
  report.source.regions.schools = regionEntries.length;
  report.source.regions.provinces = new Set(regionEntries.map((entry) => entry.province)).size;

  // 主表：以行政区名单（教育部快照）为准，再并入索引与详情里独有的校名。
  const merged = new Map();
  const normalizedKeys = new Set();
  const add = (rawName, originKey) => {
    const key = normalizeName(rawName);
    if (key.length === 0) return;
    if (key !== rawName && !normalizedKeys.has(key)) {
      normalizedKeys.add(key);
      report.normalizedNames += 1;
    }
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { key, name: rawName, origins: new Set([originKey]) });
      return;
    }
    if (!existing.origins.has(originKey)) {
      existing.origins.add(originKey);
      report.mergedAcrossSources += 1;
    }
  };

  for (const entry of regionEntries) add(entry.name, 'regions');
  for (const name of indexNames) add(name, 'index');
  for (const detail of details.values()) add(detail.name, 'details');

  // 详情归属校验：串档/空壳文件的字段一概不采信（校名仍在主表里，只是没详情）。
  const masterNames = [...merged.values()].map((item) => item.name).sort((left, right) => right.length - left.length);
  for (const [key, detail] of [...details.entries()]) {
    const verdict = detailVerdict(detail.name, detail.payload, masterNames);
    if (verdict === undefined) continue;
    details.delete(key);
    report.detailSkipped.push(`${detail.name}：${verdict}`);
  }

  const missing = new Set();
  const schools = [];
  for (const item of merged.values()) {
    const detail = details.get(item.key);
    const exact = regionByKey.get(item.key);
    let region = exact;
    if (region === undefined && NAME_ALIASES.has(item.key)) {
      const alias = NAME_ALIASES.get(item.key);
      region = regionByKey.get(normalizeName(alias));
      if (region !== undefined) report.aliasResolved.push(`${item.name} → 借用「${alias}」的省市/层次（不借教育部代码）`);
    }
    if (exact === undefined) report.noRegionMatch.push(item.name);
    schools.push(buildSchool(item, detail, region, exact, table, missing));
  }

  // 稳定排序：拼音 → 校名（都用码元比较，避免 locale 差异导致产物漂移）。
  schools.sort((left, right) => {
    const leftKey = left.pinyin ?? left.name;
    const rightKey = right.pinyin ?? right.name;
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (left.name !== right.name) return left.name < right.name ? -1 : 1;
    return 0;
  });

  // id 兜底去重（正常不会触发，触发说明数据源里有同名不同源的条目）。
  const used = new Map();
  for (const school of schools) {
    const count = used.get(school.id) ?? 0;
    used.set(school.id, count + 1);
    if (count > 0) {
      report.duplicateIds.push(`${school.name}（${school.id}）`);
      school.id = `${school.id}-${count + 1}`;
    }
  }

  report.total = schools.length;
  report.missingPinyinChars = [...missing].sort();
  report.coverage = {
    shortName: schools.filter((school) => school.shortName !== undefined).length,
    shortPinyin: schools.filter((school) => school.shortPinyin !== undefined).length,
    province: schools.filter((school) => school.province !== undefined).length,
    city: schools.filter((school) => school.city !== undefined).length,
    category: schools.filter((school) => school.category !== undefined).length,
    tags: schools.filter((school) => school.tags.length > 0).length,
    pinyin: schools.filter((school) => school.pinyin !== undefined).length,
    initials: schools.filter((school) => school.initials !== undefined).length,
    system: schools.filter((school) => school.system !== undefined).length,
  };
  // 有简称却注不出拼音的条目（简称里出现了拼音表没覆盖的汉字）：摘要里单独提示
  report.shortNameWithoutPinyin = schools
    .filter((school) => school.shortName !== undefined && school.shortPinyin === undefined)
    .map((school) => `${school.name}（简称 ${school.shortName}）`);
  report.tags = [...new Set(schools.flatMap((school) => school.tags))].sort();
  report.provinces = [...new Set(schools.map((school) => school.province).filter((value) => value !== undefined))].length;
  return schools;
}

// ---------------------------------------------------------------- 序列化

function serialize(schools, source, coverage, extra) {
  const lines = [];
  lines.push('{');
  lines.push('  "_generated": true,');
  lines.push('  "_generatedBy": "tools/schools/import-directory.mjs",');
  lines.push('  "_source": {');
  lines.push(`    "root": ${JSON.stringify(source.root)},`);
  lines.push(`    "index": ${JSON.stringify(source.index)},`);
  lines.push(`    "details": ${JSON.stringify(source.details)},`);
  lines.push(`    "regions": ${JSON.stringify(source.regions)},`);
  lines.push(`    "pinyinTable": ${JSON.stringify(source.pinyinTable)},`);
  lines.push(`    "xls": ${JSON.stringify(source.xls)},`);
  lines.push(`    "policy": ${JSON.stringify(source.policy)}`);
  lines.push('  },');
  lines.push(`  "_stats": ${JSON.stringify({ count: schools.length, ...coverage, ...extra })},`);
  lines.push('  "schools": [');
  for (let index = 0; index < schools.length; index += 1) {
    lines.push(`    ${JSON.stringify(schools[index])}${index === schools.length - 1 ? '' : ','}`);
  }
  lines.push('  ]');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------- 摘要

function printReport(report, schools, outPath, sourceRoot, bytes) {
  const line = (text) => process.stdout.write(`${text}\n`);
  line('学校富目录导入摘要');
  line('─'.repeat(64));
  line(`数据源目录      ${path.relative(REPO_ROOT, sourceRoot) || sourceRoot}`);
  line(`  大学目录.json           索引校名 ${report.source.index.names} 条`);
  line(`  大学详情/*.json         详情文件 ${report.source.details.files} 个`);
  line(`  各行政区大学列表/*.json  ${report.source.regions.provinces} 个行政区、${report.source.regions.schools} 条记录`);
  line(`  全国普通高等学校名单.xls 未使用（xls 需第三方解析库，仅作人工对账参考）`);
  line(`  拼音数据表              汉字 ${report.source.pinyinTable.chars} 个、词组修正 ${report.source.pinyinTable.phrases} 条`);
  line('');
  line(`学校总数        ${schools.length}`);
  line(`  唯一 id         ${new Set(schools.map((school) => school.id)).size}`);
  line(`  跨源同名合并     ${report.mergedAcrossSources} 次（同一校名在多个来源出现，已并成一条）`);
  line(`  名称折半角       ${report.normalizedNames} 条（全角括号等，仅用于匹配，不改产物里的校名）`);
  line(`  省级行政区       ${report.provinces} 个`);
  line(`  标签             ${report.tags.length} 种`);
  line('');
  line('字段覆盖率（有值的条目数 / 占比）');
  const coverage = report.coverage;
  for (const [field, count] of Object.entries(coverage)) {
    line(`  ${field.padEnd(10, ' ')} ${String(count).padStart(5)}  ${((count / schools.length) * 100).toFixed(1)}%`);
  }
  line(`  system 一律留空（数据源无教务系统信息，产物中省略该字段）`);
  line('');
  line(`标签清单        ${report.tags.join(' ')}`);
  line('');
  line('被跳过 / 需要留意的条目');
  let skippedTotal = report.problems.length + report.notes.length + report.aliasResolved.length
    + report.noRegionMatch.length + report.duplicateIds.length + report.detailSkipped.length
    + report.shortNameWithoutPinyin.length;
  if (skippedTotal === 0) line('  （无）');

  const section = (title, items, limit = 8) => {
    if (items.length === 0) return;
    line(`  ${title}：${items.length} 条`);
    for (const item of items.slice(0, limit)) line(`    - ${item}`);
    if (items.length > limit) line(`    …… 其余 ${items.length - limit} 条从略`);
  };
  section('解析失败', report.problems);
  section('源内跳过/提示', report.notes);
  section('详情不采信（空壳/串档）', report.detailSkipped, 6);
  section('按别名补省市', report.aliasResolved);
  section('未匹配到行政区名单（省市留空）', report.noRegionMatch, 12);
  section('id 撞车（已加后缀）', report.duplicateIds);
  section('拼音表未覆盖的汉字', report.missingPinyinChars, 20);
  section('有简称但注不出拼音', report.shortNameWithoutPinyin);
  line('');
  line(`产物            ${path.relative(REPO_ROOT, outPath)}  ${(bytes / 1024).toFixed(1)} KiB`);
  line('─'.repeat(64));
}

// ---------------------------------------------------------------- 入口

function main(argv) {
  let sourceRoot = DEFAULT_SOURCE;
  let outPath = DEFAULT_OUT;
  let checkOnly = false;
  let quiet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') sourceRoot = path.resolve(argv[++index] ?? '');
    else if (arg === '--out') outPath = path.resolve(argv[++index] ?? '');
    else if (arg === '--check') checkOnly = true;
    else if (arg === '--quiet') quiet = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('用法：node tools/schools/import-directory.mjs [--source <目录>] [--out <文件>] [--check] [--quiet]\n');
      return 0;
    } else {
      process.stderr.write(`未知参数：${arg}\n`);
      return 2;
    }
  }
  if (!existsSync(sourceRoot)) {
    process.stderr.write(`数据源目录不存在：${sourceRoot}\n`);
    return 1;
  }

  const report = {
    problems: [],
    notes: [],
    mergedAcrossSources: 0,
    normalizedNames: 0,
    aliasResolved: [],
    detailSkipped: [],
    noRegionMatch: [],
    duplicateIds: [],
    missingPinyinChars: [],
    shortNameWithoutPinyin: [],
    tags: [],
    provinces: 0,
    total: 0,
    coverage: {},
    source: {
      root: path.relative(REPO_ROOT, sourceRoot).split(path.sep).join('/'),
      index: { file: '大学目录.json', names: 0, sha256: '' },
      details: { dir: '大学详情', files: 0, sha256: '' },
      regions: { dir: '各行政区大学列表', files: 0, provinces: 0, schools: 0, sha256: '' },
      pinyinTable: { file: 'tools/schools/pinyin-table.json', chars: 0, phrases: 0, sha256: '' },
      xls: { file: '全国普通高等学校名单.xls', used: false, reason: 'xls 为二进制表格，零依赖不解析；仅作人工对账参考' },
      policy: '只导入结构化短字段；logo/图片/简介长文本一律不入库',
    },
  };

  const table = loadPinyinTable(report.problems);
  report.source.pinyinTable.chars = table.chars.size;
  report.source.pinyinTable.phrases = table.phrases.length;
  report.source.pinyinTable.sha256 = table.sha256.slice(0, 16);

  const indexPath = path.join(sourceRoot, '大学目录.json');
  if (existsSync(indexPath)) report.source.index.sha256 = sha256(readFileSync(indexPath, 'utf8')).slice(0, 16);
  const detailDir = path.join(sourceRoot, '大学详情');
  if (existsSync(detailDir)) report.source.details.sha256 = digestDir(detailDir).slice(0, 16);
  const regionDir = path.join(sourceRoot, '各行政区大学列表');
  if (existsSync(regionDir)) {
    report.source.regions.files = readdirSync(regionDir).filter((file) => file.endsWith('.json')).length;
    report.source.regions.sha256 = digestDir(regionDir).slice(0, 16);
  }
  report.source.pinyinTable.sha256 = table.sha256.slice(0, 16);

  const schools = build(sourceRoot, table, report);
  const extra = {
    tags: report.tags.length,
    provinces: report.provinces,
    mergedAcrossSources: report.mergedAcrossSources,
  };
  const text = serialize(schools, report.source, report.coverage, extra);
  const bytes = Buffer.byteLength(text, 'utf8');

  if (checkOnly) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (current !== text) {
      process.stderr.write(`产物不一致：${path.relative(REPO_ROOT, outPath)}（重跑 node tools/schools/import-directory.mjs）\n`);
      return 1;
    }
    if (!quiet) process.stdout.write(`产物已是最新：${path.relative(REPO_ROOT, outPath)}\n`);
    return 0;
  }

  // 幂等：内容与现有产物逐字节一致时**不写文件**（连 mtime 都不动），
  // 与 tools/presets/sync-snapshot.mjs 的口径一致——连跑两次只是「未触碰」，不是「又写了一遍」。
  const unchanged = existsSync(outPath) && readFileSync(outPath, 'utf8') === text;
  if (!unchanged) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, text, 'utf8');
  }
  if (!quiet) {
    printReport(report, schools, outPath, sourceRoot, bytes);
    if (unchanged) {
      process.stdout.write(
        `未改动文件：${path.relative(REPO_ROOT, outPath)} 与本次生成逐字节一致（幂等，未触碰 mtime）\n`,
      );
    }
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
