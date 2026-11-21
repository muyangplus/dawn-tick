#!/usr/bin/env node
/**
 * 界面文案集中检查：Web 端的界面文案只写在 `apps/web/src/copy/`，组件里不再出现中文字面量。
 *
 * 扫描范围：
 * - `apps/web/src/**\/*.tsx`（`copy/` 除外）；
 * - `apps/web/src/screens/**\/*.ts` 与 `apps/web/src/components/**\/*.ts`（表单模型、卡片注册等界面侧纯逻辑）。
 *
 * 报出含中日韩字符（汉字、CJK 标点、全角符号）的字符串字面量、模板字面量的静态部分、JSX 文本与 JSX 属性字符串。
 * 不报：
 * - 注释；
 * - 日志调用（logTrace / logDebug / logInfo / logWarn / logError）实参里的内容，含嵌套的对象与模板；
 * - 对象属性 `log:` 的值（`useAction().run({ log })`：失败时写进日志的消息）；
 * - `ALLOW` 清单里登记的文件或顶层声明（数据匹配表这类不上屏的文本），每条写明原因。
 *
 * 词法是手写的 TSX 扫描器（与 check-log-scopes 一样不依赖编译器）：认注释、字符串、模板与 `${}` 嵌套、
 * 正则字面量、JSX 元素 / 片段 / 属性 / 表达式容器；`.ts` 文件不认 JSX。
 *
 * 用法：node tools/verify/check-ui-literals.mjs（仓库根目录，或 verify-all.ps1 调用）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');

export const WEB_SRC = 'apps/web/src';

/** 文案模块目录：这里是中文的唯一来源，不扫。 */
export const COPY_DIR = 'copy';

/** 除 `.tsx` 外还要扫 `.ts` 的目录（相对 `WEB_SRC`）。 */
export const TS_DIRS = ['screens', 'components'];

/** 日志函数：实参是写进诊断日志的开发者文本，不上屏。 */
export const LOG_CALLS = new Set(['logTrace', 'logDebug', 'logInfo', 'logWarn', 'logError']);

/**
 * 放行清单（路径相对 `WEB_SRC`）：`{ file, name?, reason }`。
 * 只登记不上屏的数据匹配文本；`name` 是顶层声明名（const / function / class），省略时整份文件放行。
 */
export const ALLOW = [
  {
    file: 'screens/school-picker-model.ts',
    name: 'PREFERRED_SCHOOL_TAGS',
    reason: '与预设学校目录里的标签值逐字匹配，改字会让常用标签筛不到学校',
  },
];

/** 汉字（含扩展 A 与兼容区）、CJK 标点、全角符号。 */
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿！-｠]/;

export function hasCjk(text) {
  return CJK.test(text);
}

// ---------------------------------------------------------------- 词法

const KEYWORDS_BEFORE_EXPRESSION = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'default',
  'extends',
]);

/** 这些关键字后面的 `(` 不是函数调用。 */
const NON_CALL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'typeof', 'await', 'function']);

const DECLARATION_KEYWORDS = new Set(['const', 'let', 'var', 'function', 'class', 'enum', 'interface', 'type']);

const PUNCT_BEFORE_EXPRESSION = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>']);

const isIdentStart = (ch) => ch !== undefined && /[A-Za-z_$]/.test(ch);
const isIdentPart = (ch) => ch !== undefined && /[\w$]/.test(ch);

/** 前一个记号之后是否开始一个表达式（决定 `/` 是正则还是除号、`<` 是否可能是 JSX）。 */
function expressionExpected(prev) {
  if (PUNCT_BEFORE_EXPRESSION.has(prev)) return true;
  return KEYWORDS_BEFORE_EXPRESSION.has(prev);
}

/**
 * 扫描一份源码，返回 `{ literals, comments }`。
 * literal：`{ kind, start, end, text, calls, decl, attr }`。
 * - kind：`string` | `template` | `jsx-text` | `jsx-attr`；`template` 是模板里一段静态文本（不含 `${}`）；
 * - calls：所在位置外层的调用名（由内向外），不在调用实参里时为空；
 * - decl：所在的顶层声明名，顶层表达式里为 null；
 * - attr：`jsx-attr` 的属性名。
 */
export function scanSource(source, { jsx = true } = {}) {
  const n = source.length;
  const literals = [];
  const comments = [];
  const callStack = [];
  let depth = 0;
  let decl = null;
  let prev = '';
  let prevIdentForDecl = '';

  const record = (kind, start, end, extra = {}) => {
    literals.push({
      kind,
      start,
      end,
      text: source.slice(start, end),
      calls: callStack.filter((name) => name !== '').reverse(),
      decl,
      ...extra,
    });
  };

  const scanString = (from) => {
    const quote = source[from];
    let j = from + 1;
    while (j < n) {
      const ch = source[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === quote) return j + 1;
      if (ch === '\n') return j;
      j += 1;
    }
    return n;
  };

  const scanRegex = (from) => {
    let j = from + 1;
    let inClass = false;
    while (j < n) {
      const ch = source[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '\n') return j;
      if (inClass) {
        if (ch === ']') inClass = false;
      } else if (ch === '[') inClass = true;
      else if (ch === '/') {
        j += 1;
        while (isIdentPart(source[j])) j += 1;
        return j;
      }
      j += 1;
    }
    return n;
  };

  const scanTemplate = (from) => {
    let j = from + 1;
    let chunk = j;
    while (j < n) {
      const ch = source[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') {
        if (chunk < j) record('template', chunk, j);
        return j + 1;
      }
      if (ch === '$' && source[j + 1] === '{') {
        if (chunk < j) record('template', chunk, j);
        depth += 1;
        j = scanCode(j + 2, '}');
        chunk = j;
        continue;
      }
      j += 1;
    }
    return n;
  };

  /** 扫到与起点配对的 `}`（terminator 为 '}'）或文件尾；返回结束位置（已越过 `}`）。 */
  function scanCode(from, terminator) {
    let j = from;
    let braces = 0;
    const stackBase = callStack.length;
    const savedPrev = prev;
    prev = terminator === '}' ? '{' : prev;
    while (j < n) {
      const ch = source[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        j += 1;
        continue;
      }
      if (ch === '/' && source[j + 1] === '/') {
        const end = source.indexOf('\n', j);
        comments.push({ start: j, end: end < 0 ? n : end });
        j = end < 0 ? n : end;
        continue;
      }
      if (ch === '/' && source[j + 1] === '*') {
        const close = source.indexOf('*/', j + 2);
        const end = close < 0 ? n : close + 2;
        comments.push({ start: j, end });
        j = end;
        continue;
      }
      if (ch === "'" || ch === '"') {
        const end = scanString(j);
        record('string', j, end);
        j = end;
        prev = 'value';
        continue;
      }
      if (ch === '`') {
        j = scanTemplate(j);
        prev = 'value';
        continue;
      }
      if (ch === '/' && expressionExpected(prev)) {
        j = scanRegex(j);
        prev = 'value';
        continue;
      }
      if (ch === '<' && jsx && expressionExpected(prev) && (isIdentStart(source[j + 1]) || source[j + 1] === '>')) {
        const end = tryJsxElement(j);
        if (end !== null) {
          j = end;
          prev = 'value';
          continue;
        }
      }
      if (isIdentStart(ch)) {
        let k = j + 1;
        while (isIdentPart(source[k])) k += 1;
        const word = source.slice(j, k);
        if (depth === 0 && DECLARATION_KEYWORDS.has(prevIdentForDecl)) decl = word;
        prevIdentForDecl = word;
        prev = word;
        j = k;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let k = j + 1;
        while (/[\w.]/.test(source[k] ?? '')) k += 1;
        j = k;
        prev = 'value';
        prevIdentForDecl = '';
        continue;
      }
      prevIdentForDecl = '';
      if (ch === '(') {
        const callee = /^[A-Za-z_$][\w$]*$/.test(prev) && !NON_CALL_KEYWORDS.has(prev) ? prev : '';
        callStack.push(callee);
        depth += 1;
        prev = '(';
        j += 1;
        continue;
      }
      if (ch === ')') {
        if (callStack.length > stackBase) callStack.pop();
        depth = Math.max(0, depth - 1);
        prev = ')';
        j += 1;
        continue;
      }
      if (ch === '[') {
        callStack.push('');
        depth += 1;
        prev = '[';
        j += 1;
        continue;
      }
      if (ch === ']') {
        if (callStack.length > stackBase) callStack.pop();
        depth = Math.max(0, depth - 1);
        prev = 'value';
        j += 1;
        continue;
      }
      if (ch === '{') {
        braces += 1;
        depth += 1;
        prev = '{';
        j += 1;
        continue;
      }
      if (ch === '}') {
        depth = Math.max(0, depth - 1);
        if (braces === 0 && terminator === '}') {
          callStack.length = stackBase;
          prev = savedPrev;
          return j + 1;
        }
        braces -= 1;
        prev = '}';
        j += 1;
        continue;
      }
      if (ch === '=' && source[j + 1] === '>') {
        prev = '=>';
        j += 2;
        continue;
      }
      prev = ch;
      j += 1;
    }
    callStack.length = stackBase;
    return n;
  }

  /** `<` 起的 JSX 元素；不像 JSX（泛型 `<T,>`、未闭合）时回滚并返回 null。 */
  function tryJsxElement(from) {
    if (/^<[A-Za-z_$][\w$]*\s*(?:,|extends\b)/.test(source.slice(from, from + 80))) return null;
    const snapshot = { literals: literals.length, comments: comments.length, depth, calls: callStack.length, decl };
    const end = scanJsxElement(from);
    if (end !== null) return end;
    literals.length = snapshot.literals;
    comments.length = snapshot.comments;
    depth = snapshot.depth;
    callStack.length = snapshot.calls;
    decl = snapshot.decl;
    return null;
  }

  /** 返回元素结束位置；扫到文件尾仍未闭合时返回 null。 */
  function scanJsxElement(from) {
    let j = from + 1;
    if (source[j] === '>') return scanJsxChildren(j + 1);
    while (/[\w$.:-]/.test(source[j] ?? '')) j += 1;
    while (j < n) {
      const ch = source[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        j += 1;
        continue;
      }
      if (ch === '/' && source[j + 1] === '>') return j + 2;
      if (ch === '>') return scanJsxChildren(j + 1);
      if (ch === '{') {
        depth += 1;
        j = scanCode(j + 1, '}');
        continue;
      }
      if (ch === '/' && source[j + 1] === '*') {
        const close = source.indexOf('*/', j + 2);
        comments.push({ start: j, end: close < 0 ? n : close + 2 });
        j = close < 0 ? n : close + 2;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        let k = j + 1;
        while (/[\w$:.-]/.test(source[k] ?? '')) k += 1;
        const attr = source.slice(j, k);
        j = k;
        while (/\s/.test(source[j] ?? '')) j += 1;
        if (source[j] !== '=') continue;
        j += 1;
        while (/\s/.test(source[j] ?? '')) j += 1;
        const value = source[j];
        if (value === '"' || value === "'") {
          const close = source.indexOf(value, j + 1);
          const end = close < 0 ? n : close + 1;
          record('jsx-attr', j, end, { attr });
          j = end;
        } else if (value === '{') {
          depth += 1;
          j = scanCode(j + 1, '}');
        } else if (value === '<') {
          const end = scanJsxElement(j);
          if (end === null) return null;
          j = end;
        }
        continue;
      }
      // 不认识的字符：不是 JSX
      return null;
    }
    return null;
  }

  function scanJsxChildren(from) {
    let j = from;
    let text = j;
    const flush = (end) => {
      if (text < end && source.slice(text, end).trim() !== '') record('jsx-text', text, end);
    };
    while (j < n) {
      const ch = source[j];
      if (ch === '{') {
        flush(j);
        depth += 1;
        j = scanCode(j + 1, '}');
        text = j;
        continue;
      }
      if (ch === '<') {
        flush(j);
        if (source[j + 1] === '/') {
          const close = source.indexOf('>', j);
          return close < 0 ? null : close + 1;
        }
        const end = scanJsxElement(j);
        if (end === null) return null;
        j = end;
        text = j;
        continue;
      }
      j += 1;
    }
    return null;
  }

  scanCode(0, null);
  return { literals, comments };
}

// ---------------------------------------------------------------- 判定

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** 字面量是否是对象属性 `log:` 的值。 */
export function isLogOption(source, start) {
  return /(?:^|[^\w$.])log\s*:\s*$/.test(source.slice(Math.max(0, start - 40), start));
}

/** 放行条目里与这份文件、这条字面量匹配的一条；没有返回 null。 */
export function allowedBy(file, literal, allow = ALLOW) {
  for (const entry of allow) {
    if (entry.file !== file) continue;
    if (entry.name === undefined || entry.name === literal.decl) return entry;
  }
  return null;
}

/**
 * 检查一份源码：`{ hits, logged, allowed }`。
 * hits：`[{ line, kind, text, decl }]`，需要搬进 copy/ 的字面量；logged / allowed 是被放行的条数。
 */
export function checkSource(source, { file = '', jsx = true, allow = ALLOW } = {}) {
  const { literals } = scanSource(source, { jsx });
  const starts = lineStarts(source);
  const hits = [];
  let logged = 0;
  let allowed = 0;
  for (const literal of literals) {
    if (!hasCjk(literal.text)) continue;
    if (literal.calls.some((name) => LOG_CALLS.has(name)) || isLogOption(source, literal.start)) {
      logged += 1;
      continue;
    }
    if (allowedBy(file, literal, allow) !== null) {
      allowed += 1;
      continue;
    }
    hits.push({
      // JSX 文本从上一个标签的 `>` 起算：行号取第一个非空白字符
      line: lineAt(starts, literal.start + (literal.text.length - literal.text.trimStart().length)),
      kind: literal.kind,
      text: literal.text.trim(),
      decl: literal.decl,
    });
  }
  return { hits, logged, allowed };
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

/** 要扫的文件（相对 `WEB_SRC`，`/` 分隔）。 */
export function filesToScan(srcDir) {
  return walk(srcDir)
    .map((file) => relative(srcDir, file).replace(/\\/g, '/'))
    .filter((file) => {
      if (file.startsWith(`${COPY_DIR}/`)) return false;
      if (file.endsWith('.d.ts')) return false;
      if (file.endsWith('.tsx')) return true;
      return file.endsWith('.ts') && TS_DIRS.some((dir) => file.startsWith(`${dir}/`));
    })
    .sort();
}

/** 全量检查：`{ files, hits, logged, allowed, staleAllow }`；hits 带 file。staleAllow 是匹配不到任何字面量的放行条目。 */
export function checkUiLiterals({ root = ROOT, allow = ALLOW } = {}) {
  const srcDir = join(root, WEB_SRC);
  const files = filesToScan(srcDir);
  const hits = [];
  let logged = 0;
  let allowed = 0;
  const used = new Set();
  for (const file of files) {
    const source = readFileSync(join(srcDir, file), 'utf8');
    const jsx = file.endsWith('.tsx');
    for (const literal of scanSource(source, { jsx }).literals) {
      if (!hasCjk(literal.text)) continue;
      const entry = allowedBy(file, literal, allow);
      if (entry !== null) used.add(entry);
    }
    const result = checkSource(source, { file, jsx, allow });
    for (const hit of result.hits) hits.push({ file, ...hit });
    logged += result.logged;
    allowed += result.allowed;
  }
  const staleAllow = allow.filter((entry) => !used.has(entry));
  return { files, hits, logged, allowed, staleAllow };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/verify/check-ui-literals.mjs');
if (invokedDirectly) {
  const { files, hits, logged, allowed, staleAllow } = checkUiLiterals();
  for (const { file, line, kind, text } of hits) {
    const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    console.log(`[FAIL] ${WEB_SRC}/${file}:${line}: ${kind} ${preview}（移到 ${WEB_SRC}/${COPY_DIR}/）`);
  }
  for (const entry of staleAllow) {
    console.log(`[FAIL] 放行条目已无对应文本：${entry.file}${entry.name === undefined ? '' : `#${entry.name}`}`);
  }
  const failures = hits.length + staleAllow.length;
  if (failures > 0) {
    console.log(`界面文案检查未通过（${failures} 处）`);
    process.exit(1);
  }
  console.log(
    `界面文案已集中到 copy/：${files.length} 个界面源文件无中文字面量（日志实参 ${logged} 处、放行清单 ${allowed} 处不计）`,
  );
}
