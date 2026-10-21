#!/usr/bin/env node
/**
 * 小组件快照契约检查：TS 接口字段 ↔ Kotlin WidgetStore.kt 的 JSON 键名。
 *
 * 快照由 Web 层写、Android 小组件读，两端各写一份字段名：
 * - TS 契约源：apps/web/src/widget-snapshot.ts 的 WidgetSnapshot / WidgetLesson /
 *   WidgetGridLesson / WidgetExam / WidgetColors 接口（WidgetColors 含卡面底色 surface
 *   与强调色 accent，danger 为 A-15 兼容字段）；
 * - Kotlin 读取端：apps/mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetStore.kt
 *   里 `xxx.optString("key")` 一类的 JSON 键名。
 *
 * 两边按类型分组做双向差集：TS 有而 Kotlin 没读、Kotlin 读了而 TS 没有，都算漂移。
 * 缺字段不会报错、只会表现为小组件空白，所以这里用非 0 退出码兜住。
 *
 * 用法：node tools/verify/check-widget-contract.mjs（仓库根目录，或 verify-all.ps1 调用）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TS_FILE = join(process.cwd(), 'apps/web/src/widget-snapshot.ts');
const KOTLIN_FILE = join(
  process.cwd(),
  'apps/mobile/android/app/src/main/java/com/dawntick/app/widget/WidgetStore.kt',
);

/**
 * 契约分组：`type` 是两侧共用的类型名；`withRootKeys` 表示该类型的字段直接从快照根对象读
 * （Kotlin 里用 `root.opt*` 接收），需要把根级键并入该组。
 */
const GROUPS = [
  { type: 'WidgetSnapshot', withRootKeys: true },
  { type: 'WidgetLesson', withRootKeys: false },
  { type: 'WidgetGridLesson', withRootKeys: false },
  { type: 'WidgetExam', withRootKeys: false },
  { type: 'WidgetColors', withRootKeys: false },
];

// ---------------------------------------------------------------- 通用扫描

/** 从 `source[start]` 的开括号取到配对闭括号，跳过字符串与注释（Kotlin 文案里有全角括号与 ${}）。 */
function balanced(source, start) {
  const open = source[start];
  const close = { '{': '}', '(': ')', '[': ']' }[open];
  if (close === undefined) throw new Error(`不是开括号: ${open}`);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i);
      if (newline < 0) break;
      i = newline;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { body: source.slice(start + 1, i), end: i };
    }
  }
  return null;
}

// ---------------------------------------------------------------- TS 侧

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 取 `export interface Name { ... }` 的字段名（含可选字段），找不到返回 null。 */
function tsInterfaceFields(source, name) {
  const header = new RegExp(`export\\s+interface\\s+${name}\\b`).exec(source);
  if (header === null) return null;
  const openIndex = source.indexOf('{', header.index + header[0].length);
  if (openIndex < 0) return null;
  const block = balanced(source, openIndex);
  if (block === null) return null;
  const fields = [];
  for (const line of stripComments(block.body).split('\n')) {
    // 只接受 `field: type;` / `field?: type;`，注释行已被剥掉
    const match = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*:\s*\S/.exec(line);
    if (match !== null) fields.push(match[1]);
  }
  return fields;
}

// ---------------------------------------------------------------- Kotlin 侧

const OPT_CALL = /\.\s*opt(?:String|Int|Long|Boolean|JSONArray|JSONObject)\s*\(\s*"([^"]+)"/g;

function optKeys(text) {
  const keys = [];
  for (const match of text.matchAll(OPT_CALL)) keys.push(match[1]);
  return keys;
}

/**
 * 取 Kotlin 里 `Name(...)` 调用（跳过 `data class Name(...)` 声明）的实参文本。
 * 同类型只可能有一处构造调用，取第一处非声明调用即可。
 */
function kotlinCallArgs(source, name) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const before = source.slice(Math.max(0, match.index - 40), match.index);
    if (/\bclass\s+$/.test(before)) continue; // data class 声明
    const openIndex = source.indexOf('(', match.index);
    const block = balanced(source, openIndex);
    if (block === null) throw new Error(`Kotlin ${name}(...) 括号不配对`);
    return block.body;
  }
  return null;
}

// ---------------------------------------------------------------- 主流程

function main() {
  const tsSource = readFileSync(TS_FILE, 'utf8');
  const kotlinSource = readFileSync(KOTLIN_FILE, 'utf8');

  // 快照根级键：只有快照对象从 `root` 读；其余类型从各自的 item 读，不能混用
  const ROOT_OPT = /root\s*\.\s*opt(?:String|Int|Long|Boolean|JSONArray|JSONObject)\s*\(\s*"([^"]+)"/g;
  const rootKeys = [...kotlinSource.matchAll(ROOT_OPT)].map((match) => match[1]);

  const failures = [];
  const summary = [];
  let fieldCount = 0;
  for (const group of GROUPS) {
    const tsFields = tsInterfaceFields(tsSource, group.type);
    if (tsFields === null) {
      failures.push(`${group.type}: TS 接口未找到（契约源缺类型或改名）`);
      continue;
    }
    fieldCount += tsFields.length;
    const args = kotlinCallArgs(kotlinSource, group.type);
    if (args === null) {
      failures.push(`${group.type}: Kotlin 未找到 ${group.type}(...) 构造调用`);
      continue;
    }
    const kotlinKeys = [...new Set(optKeys(args).concat(group.withRootKeys ? rootKeys : []))];
    if (kotlinKeys.length === 0) {
      failures.push(`${group.type}: Kotlin 没读到任何 opt* 键名`);
      continue;
    }

    const missing = tsFields.filter((field) => !kotlinKeys.includes(field));
    const extra = kotlinKeys.filter((key) => !tsFields.includes(key));
    for (const field of missing) failures.push(`${group.type}: Kotlin 缺少键 ${field}`);
    for (const key of extra) failures.push(`${group.type}: Kotlin 多出键 ${key}（TS 接口没有）`);
    summary.push(`${group.type}=${tsFields.length}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.log(`[FAIL] ${failure}`);
    console.log(`小组件快照契约不一致（${failures.length} 处）`);
    return 1;
  }
  console.log(`[PASS] ${summary.join(' ')}`);
  console.log(`小组件快照契约一致（${GROUPS.length} 组 / ${fieldCount} 个字段）`);
  return 0;
}

process.exit(main());
