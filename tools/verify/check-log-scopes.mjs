#!/usr/bin/env node
/**
 * 日志范围与敏感字段检查：Web、桌面（Rust）、安卓（Kotlin/Java）共用同一组日志范围。
 *
 * 范围名是跨语言手写的字符串：Rust 只在 debug 构建里 debug_assert，安卓只往 logcat 打一行警告，
 * 发布构建里写错范围名不会有任何报错。这里在构建前兜住：
 * - 三端清单（`log-scopes.ts` 的 `LOG_SCOPES` 键、`logging.rs` 的 `LOG_SCOPES`、`NativeLog.SCOPES`）逐项一致；
 * - Rust 的 `log_error..log_trace` / `log_at` 与 Kotlin/Java 的 `NativeLog.error..trace` 调用（含跨行调用），
 *   范围实参是字面量或同文件里的字符串常量（如 `SCOPE`），且已登记；
 * - 日志消息里出现 password / passwd / token / secret / pin / cookie / authorization 的键名或插值时报出。
 *   按标识符最后一个词判定：`pinLength`、`tokenCount` 不算，`accessToken`、`cred.password` 算。
 *   Web 端的调用由 TypeScript 的 `LogScope` 类型把关，这里不扫。
 *
 * 用法：node tools/verify/check-log-scopes.mjs（仓库根目录，或 verify-all.ps1 调用）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');

export const SCOPE_SOURCES = {
  web: 'apps/web/src/lib/log-scopes.ts',
  rust: 'apps/desktop/src-tauri/src/logging.rs',
  android: 'apps/mobile/android/app/src/main/java/com/dawntick/app/diag/NativeLog.kt',
};

const RUST_DIR = 'apps/desktop/src-tauri/src';
const ANDROID_DIR = 'apps/mobile/android/app/src';

export const LOG_LEVEL_NAMES = ['error', 'warn', 'info', 'debug', 'trace'];

/** 视为敏感的词；标识符按 camelCase / snake_case 拆词后比对最后一个词。 */
export const SECRET_WORDS = ['password', 'passwd', 'token', 'secret', 'pin', 'cookie', 'authorization'];

/**
 * 放行的标识符（不区分大小写）：名字里带敏感词但值不敏感的。
 * 只有确认值本身可公开时才往这里加，并写明原因。
 */
export const SECRET_ALLOW = new Set([]);

// ---------------------------------------------------------------- 清单解析

function stringLiterals(text) {
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
}

/** `export const LOG_SCOPES = { app: '…', … }` 的键。 */
export function parseWebScopes(source) {
  const block = /export\s+const\s+LOG_SCOPES\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const\s*)?;/.exec(source);
  if (!block) return null;
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const keys = [];
  for (const match of body.matchAll(/(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g)) {
    keys.push(match[1] ?? match[2] ?? match[3]);
  }
  return keys;
}

/** `pub(crate) const LOG_SCOPES: &[&str] = &[ "app", … ];` 的元素。 */
export function parseRustScopes(source) {
  const block = /\bconst\s+LOG_SCOPES\s*:\s*&(?:'static\s+)?\[\s*&(?:'static\s+)?str\s*\]\s*=\s*&\[([\s\S]*?)\]\s*;/.exec(
    source,
  );
  if (!block) return null;
  return stringLiterals(block[1].replace(/\/\/[^\n]*/g, ''));
}

/** `val SCOPES: Set<String> = setOf( "app", … )` 的元素。 */
export function parseAndroidScopes(source) {
  const block = /\bval\s+SCOPES\s*(?::\s*Set<String>\s*)?=\s*setOf\s*(?:<String>\s*)?\(([\s\S]*?)\)/.exec(source);
  if (!block) return null;
  return stringLiterals(block[1].replace(/\/\/[^\n]*/g, ''));
}

function duplicatesOf(list) {
  const seen = new Set();
  const dups = new Set();
  for (const item of list) {
    if (seen.has(item)) dups.add(item);
    seen.add(item);
  }
  return [...dups];
}

/**
 * 以 Web 清单为基准比对其他端：`[{ platform, missing, extra, duplicates }]`，只列有问题的端。
 * 某端解析不到清单时 `missing` 为 null。
 */
export function compareScopeLists(lists) {
  const base = lists.web ?? [];
  const problems = [];
  for (const [platform, list] of Object.entries(lists)) {
    if (list === null || list === undefined) {
      problems.push({ platform, missing: null, extra: [], duplicates: [] });
      continue;
    }
    const set = new Set(list);
    const baseSet = new Set(base);
    const missing = platform === 'web' ? [] : base.filter((name) => !set.has(name));
    const extra = platform === 'web' ? [] : list.filter((name) => !baseSet.has(name));
    const duplicates = duplicatesOf(list);
    if (missing.length > 0 || extra.length > 0 || duplicates.length > 0) {
      problems.push({ platform, missing, extra: [...new Set(extra)], duplicates });
    }
  }
  return problems;
}

// ---------------------------------------------------------------- 词法

/**
 * 把源码切成 code / string / comment 三类片段（首尾相接覆盖全文）。
 * lang：`rust` | `kotlin` | `java`。Rust 认原始串 `r#"…"#` 与生命周期 `'a`；Kotlin 认 `"""…"""` 与 `${…}` 模板。
 */
export function lexSource(source, lang) {
  const segments = [];
  let codeStart = 0;
  let i = 0;
  const n = source.length;
  const push = (kind, start, end) => {
    if (codeStart < start) segments.push({ kind: 'code', start: codeStart, end: start });
    segments.push({ kind, start, end });
    codeStart = end;
  };

  /** 普通双引号串，返回结束位置（含收尾引号）；Kotlin 处理 `${…}` 内的嵌套串。 */
  const scanQuoted = (from) => {
    let j = from + 1;
    while (j < n) {
      const ch = source[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '"') return j + 1;
      if (lang === 'kotlin' && ch === '$' && source[j + 1] === '{') {
        j = scanTemplate(j + 2);
        continue;
      }
      if (ch === '\n' && lang !== 'rust') return j; // 未闭合：止于行尾
      j += 1;
    }
    return n;
  };

  /** Kotlin `${` 之后到匹配的 `}`，其中可有嵌套串。 */
  const scanTemplate = (from) => {
    let depth = 1;
    let j = from;
    while (j < n && depth > 0) {
      const ch = source[j];
      if (ch === '"') {
        j = source.startsWith('"""', j) ? scanRawKotlin(j) : scanQuoted(j);
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      j += 1;
    }
    return j;
  };

  const scanRawKotlin = (from) => {
    const close = source.indexOf('"""', from + 3);
    if (close < 0) return n;
    let end = close + 3;
    while (source[end] === '"') end += 1; // `""""` 结尾的多余引号属于内容
    return end;
  };

  const scanBlockComment = (from) => {
    // Rust 与 Kotlin 的块注释可嵌套；Java 不嵌套
    let depth = 1;
    let j = from + 2;
    while (j < n && depth > 0) {
      if (source.startsWith('*/', j)) {
        depth -= 1;
        j += 2;
      } else if (lang !== 'java' && source.startsWith('/*', j)) {
        depth += 1;
        j += 2;
      } else j += 1;
    }
    return j;
  };

  while (i < n) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      push('comment', i, end < 0 ? n : end);
      i = end < 0 ? n : end;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = scanBlockComment(i);
      push('comment', i, end);
      i = end;
      continue;
    }
    if (lang === 'rust') {
      const raw = /^b?r(#*)"/.exec(source.slice(i, i + 40));
      if (raw && !/[\w]/.test(source[i - 1] ?? '')) {
        const close = source.indexOf(`"${raw[1]}`, i + raw[0].length);
        const end = close < 0 ? n : close + 1 + raw[1].length;
        push('string', i, end);
        i = end;
        continue;
      }
      if (ch === 'b' && source[i + 1] === '"' && !/[\w]/.test(source[i - 1] ?? '')) {
        const end = scanQuoted(i + 1);
        push('string', i, end);
        i = end;
        continue;
      }
    }
    if (ch === '"') {
      const end = lang === 'kotlin' && source.startsWith('"""', i) ? scanRawKotlin(i) : scanQuoted(i);
      push('string', i, end);
      i = end;
      continue;
    }
    if (ch === "'") {
      // 字符字面量 'x' / '\n' / '\u{..}'；Rust 的生命周期 'a 没有收尾引号，按代码处理
      if (source[i + 1] === '\\') {
        const end = source.indexOf("'", i + 2);
        if (end > 0 && end - i < 12) {
          push('string', i, end + 1);
          i = end + 1;
          continue;
        }
      } else {
        const cp = source.codePointAt(i + 1);
        const width = cp !== undefined && cp > 0xffff ? 2 : 1;
        if (source[i + 1 + width] === "'") {
          push('string', i, i + 2 + width);
          i += 2 + width;
          continue;
        }
      }
    }
    i += 1;
  }
  if (codeStart < n) segments.push({ kind: 'code', start: codeStart, end: n });
  return segments;
}

function segmentAt(segments, index) {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const segment = segments[mid];
    if (index < segment.start) hi = mid - 1;
    else if (index >= segment.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * 从 `(` 起切顶层实参，返回 `{ args: [{ start, end }], end }`；只在 code 片段里数括号与逗号。
 */
function splitArgs(source, segments, openIndex) {
  const args = [];
  let depth = 0;
  let argStart = openIndex + 1;
  let index = segmentAt(segments, openIndex);
  for (; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind !== 'code') continue;
    const from = Math.max(segment.start, openIndex);
    for (let j = from; j < segment.end; j += 1) {
      const ch = source[j];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1;
        if (depth === 0) {
          if (source.slice(argStart, j).trim() !== '') args.push({ start: argStart, end: j });
          return { args, end: j + 1 };
        }
      } else if (ch === ',' && depth === 1) {
        args.push({ start: argStart, end: j });
        argStart = j + 1;
      }
    }
  }
  return { args, end: source.length };
}

/** Rust 里包住本次调用的日志函数名（`log_error` 内转调 `log_at`）；不在日志函数里返回 null。 */
function enclosingLogFn(source, at) {
  let name = null;
  for (const match of source.slice(0, at).matchAll(/\bfn\s+(\w+)/g)) name = match[1];
  return name !== null && /^log_(?:error|warn|info|debug|trace|at)$/.test(name) ? name : null;
}

const CALL_PATTERNS = {
  rust: /\b(log_(error|warn|info|debug|trace)|log_at)\s*\(/g,
  kotlin: /\bNativeLog\s*\.\s*(error|warn|info|debug|trace)\s*\(/g,
  java: /\bNativeLog\s*\.\s*(error|warn|info|debug|trace)\s*\(/g,
};

/** 范围实参的位置：Rust `log_x(scope, msg)` / `log_at(level, scope, msg)`；安卓 `NativeLog.x(ctx, scope, msg…)`。 */
function scopeIndexOf(lang, callee) {
  if (lang === 'rust') return callee === 'log_at' ? 1 : 0;
  return 1;
}

/**
 * 找出日志调用：`[{ callee, level, line, forwarder, scope: { start, end }, messages: [{ start, end }] }]`。
 * forwarder：调用位于 Rust 日志函数自身体内时为该函数名。
 * 注释与字符串里的同名文本、Rust 的 `fn log_xxx(` 定义都跳过。
 */
export function findLogCalls(source, lang, segments = lexSource(source, lang)) {
  const pattern = new RegExp(CALL_PATTERNS[lang].source, 'g');
  const calls = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const at = match.index;
    const segment = segments[segmentAt(segments, at)];
    if (segment === undefined || segment.kind !== 'code') continue;
    if (lang === 'rust' && /\bfn\s+$/.test(source.slice(Math.max(0, at - 12), at))) continue;
    const callee = lang === 'rust' ? match[1] : `NativeLog.${match[1]}`;
    const openIndex = at + match[0].length - 1;
    const { args } = splitArgs(source, segments, openIndex);
    const scopeIndex = scopeIndexOf(lang, match[1]);
    let level = lang === 'rust' ? (match[2] ?? null) : match[1];
    if (lang === 'rust' && match[1] === 'log_at' && args[0] !== undefined) {
      const levelArg = /LogLevel::(\w+)/.exec(source.slice(args[0].start, args[0].end));
      level = levelArg ? levelArg[1].toLowerCase() : null;
    }
    calls.push({
      callee,
      level,
      line: lineOf(source, at),
      forwarder: lang === 'rust' ? enclosingLogFn(source, at) : null,
      scope: args[scopeIndex] ?? null,
      messages: args.slice(scopeIndex + 1),
    });
  }
  return calls;
}

/** 文件内的字符串常量：Rust `const X: &str = "…"`，Kotlin `const val X = "…"` / `val X: String = "…"`，Java `static final String X = "…"`。 */
export function stringConstants(source) {
  const constants = new Map();
  const pattern =
    /\b(?:const\s+val|val|const|static\s+final\s+String|final\s+static\s+String)\s+([A-Za-z_]\w*)\s*(?::\s*(?:&\s*(?:'static\s+)?str|String)\s*)?=\s*"((?:[^"\\$]|\\.)*)"/g;
  for (const match of source.matchAll(pattern)) {
    if (!constants.has(match[1])) constants.set(match[1], match[2]);
  }
  return constants;
}

/** 范围实参解析：字面量或常量 → `{ scope }`，否则 `{ unresolved: 原文 }`。 */
export function resolveScope(text, constants) {
  const trimmed = text.trim();
  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  if (literal) return { scope: literal[1] };
  const name = /^(?:[A-Za-z_]\w*\s*(?:\.|::)\s*)*([A-Za-z_]\w*)$/.exec(trimmed);
  if (name && constants.has(name[1])) return { scope: constants.get(name[1]) };
  return { unresolved: trimmed };
}

// ---------------------------------------------------------------- 敏感字段

/** 标识符拆词：`accessToken` → access, token；`user_password` → user, password；`PIN_CODE` → pin, code。 */
export function splitWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

const PREDICATE_PREFIXES = new Set(['has', 'is', 'needs', 'should', 'can', 'missing', 'no', 'with', 'without']);

/** 标识符是否像敏感值：最后一个词是敏感词，且不是 `hasToken` 这类布尔判断。 */
export function isSensitiveName(name, allow = SECRET_ALLOW) {
  if (allow.has(name.toLowerCase())) return false;
  const words = splitWords(name);
  if (words.length === 0) return false;
  if (!SECRET_WORDS.includes(words.at(-1))) return false;
  return !(words.length > 1 && PREDICATE_PREFIXES.has(words[0]));
}

/** 只改形态不改内容的方法：`token.as_str()`、`password.trim()` 仍按 token / password 判定。 */
const TRANSPARENT_METHODS = new Set([
  'as_str',
  'as_ref',
  'as_deref',
  'to_string',
  'to_owned',
  'clone',
  'trim',
  'unwrap',
  'unwrap_or',
  'unwrap_or_default',
  'expect',
  'display',
  'tostring',
  'orempty',
  'value',
  'get',
]);

/** 脱敏函数里的实参不算泄漏：`redact_url(&token_url)`、`urlForLog(x)`、`mask(pin)`。 */
const SANITIZER_CALL = /\b(?:redact\w*|mask\w*|hash\w*|sha\d*\w*|fingerprint\w*|\w*ForLog|\w*_for_log)\s*\(/g;

function stripSanitizerCalls(code) {
  let output = code;
  for (let guard = 0; guard < 8; guard += 1) {
    SANITIZER_CALL.lastIndex = 0;
    const match = SANITIZER_CALL.exec(output);
    if (!match) break;
    let depth = 0;
    let end = output.length;
    for (let j = match.index + match[0].length - 1; j < output.length; j += 1) {
      if (output[j] === '(') depth += 1;
      else if (output[j] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    output = output.slice(0, match.index) + ' '.repeat(end - match.index) + output.slice(end);
  }
  return output;
}

/** 表达式里的敏感标识符：按 `.` / `::` / `?.` 连起来的链取有效的最后一节。 */
export function sensitiveNamesInCode(code, allow = SECRET_ALLOW) {
  const found = [];
  const cleaned = stripSanitizerCalls(code);
  const chainPattern = /[A-Za-z_]\w*(?:\s*(?:\?\.|\.|::)\s*[A-Za-z_]\w*)*/g;
  for (const match of cleaned.matchAll(chainPattern)) {
    const parts = match[0].split(/\s*(?:\?\.|\.|::)\s*/);
    while (parts.length > 1 && TRANSPARENT_METHODS.has(parts.at(-1).toLowerCase())) parts.pop();
    const last = parts.at(-1);
    if (isSensitiveName(last, allow)) found.push(match[0].replace(/\s+/g, ''));
  }
  return found;
}

const KEY_BEFORE_VALUE = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9])(${SECRET_WORDS.join('|')})\s*[=:]\s*(?=$|\{|\$)`,
  'gi',
);

/**
 * 字符串字面量里的敏感内容：
 * - 键名紧跟待填的值：`"token="` + …、`"pin={}"`、`"password: $value"`；
 * - Rust 内联占位 `{token}`、Kotlin 模板 `$token` / `${cred.password}`。
 */
export function sensitiveInLiteral(literal, lang, allow = SECRET_ALLOW) {
  const reasons = [];
  // 去掉引号与 Rust 原始串标记
  const body = literal.replace(/^b?r?#*"+/, '').replace(/"+#*$/, '');
  for (const key of body.matchAll(KEY_BEFORE_VALUE)) {
    // 键名后面紧跟的模板整体是脱敏调用（`secret=${redact(secret)}`）时不算
    const rest = body.slice(key.index + key[0].length);
    const template = /^\$\{([^}]*)\}/.exec(rest);
    if (template && stripSanitizerCalls(template[1]).trim() === '' && template[1].trim() !== '') continue;
    reasons.push(`键名 ${key[1]}`);
  }
  if (lang === 'rust') {
    for (const match of body.matchAll(/(?<!\{)\{([A-Za-z_][\w.]*)(?::[^}]*)?\}/g)) {
      for (const name of sensitiveNamesInCode(match[1], allow)) reasons.push(`插值 {${name}}`);
    }
  }
  if (lang === 'kotlin') {
    for (const match of body.matchAll(/\$\{([^}]*)\}|\$([A-Za-z_]\w*)/g)) {
      const expr = match[1] ?? match[2];
      for (const name of sensitiveNamesInCode(expr, allow)) reasons.push(`插值 \${${name}}`);
    }
  }
  return reasons;
}

/** 一段实参里的敏感内容：字面量按 sensitiveInLiteral，代码部分按标识符。 */
function sensitiveInRange(source, segments, range, lang, allow) {
  const reasons = [];
  let code = '';
  for (let index = segmentAt(segments, range.start); index >= 0 && index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.start >= range.end) break;
    const start = Math.max(segment.start, range.start);
    const end = Math.min(segment.end, range.end);
    const text = source.slice(start, end);
    if (segment.kind === 'string') {
      reasons.push(...sensitiveInLiteral(text, lang, allow));
      code += ' "" ';
    } else if (segment.kind === 'code') code += text;
    else code += ' ';
  }
  for (const name of sensitiveNamesInCode(code, allow)) reasons.push(`实参 ${name}`);
  return reasons;
}

// ---------------------------------------------------------------- 单文件与全仓

/**
 * 检查一个源文件：`{ calls, unknown, unresolved, secrets }`，每项带 line。
 * scopes 为已登记范围（Set 或数组）。
 */
export function checkSource(source, lang, { scopes, allow = SECRET_ALLOW } = {}) {
  const registered = new Set(scopes ?? []);
  const segments = lexSource(source, lang);
  const constants = stringConstants(source);
  const calls = findLogCalls(source, lang, segments);
  const unknown = [];
  const unresolved = [];
  const secrets = [];
  for (const call of calls) {
    if (call.scope === null) {
      unresolved.push({ line: call.line, callee: call.callee, text: '(缺少范围实参)' });
    } else {
      const resolved = resolveScope(source.slice(call.scope.start, call.scope.end), constants);
      if ('scope' in resolved) {
        call.resolvedScope = resolved.scope;
        if (!registered.has(resolved.scope)) unknown.push({ line: call.line, callee: call.callee, scope: resolved.scope });
      } else if (call.forwarder !== null && /^[A-Za-z_]\w*$/.test(resolved.unresolved)) {
        // 日志函数自身把参数转给下一层（`log_error(scope, …)` → `log_at(…, scope, …)`）：由其调用方核对
        call.resolvedScope = null;
      } else {
        unresolved.push({ line: call.line, callee: call.callee, text: resolved.unresolved });
      }
    }
    // 安卓 error / warn 的最后一个实参可能是 Throwable：异常本身不当作消息内容扫
    for (const range of call.messages) {
      for (const reason of sensitiveInRange(source, segments, range, lang, allow)) {
        secrets.push({ line: call.line, callee: call.callee, reason });
      }
    }
  }
  return { calls, unknown, unresolved, secrets };
}

function walk(dir, accept) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'build' || entry.name === 'target' || entry.name.startsWith('.')) continue;
      files.push(...walk(full, accept));
    } else if (accept(entry.name)) files.push(full);
  }
  return files.sort();
}

function langOf(file) {
  if (file.endsWith('.rs')) return 'rust';
  if (file.endsWith('.kt')) return 'kotlin';
  if (file.endsWith('.java')) return 'java';
  return null;
}

/** 全仓检查。返回 `{ lists, listProblems, files, calls, unknown, unresolved, secrets }`，后三项带 file。 */
export function checkLogScopes({ root = ROOT, allow = SECRET_ALLOW } = {}) {
  const read = (rel) => {
    const file = join(root, rel);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  };
  const lists = {
    web: parseWebScopes(read(SCOPE_SOURCES.web)),
    rust: parseRustScopes(read(SCOPE_SOURCES.rust)),
    android: parseAndroidScopes(read(SCOPE_SOURCES.android)),
  };
  const listProblems = compareScopeLists(lists);
  const scopes = new Set(lists.web ?? []);
  const files = [
    ...walk(join(root, RUST_DIR), (name) => name.endsWith('.rs')),
    ...walk(join(root, ANDROID_DIR), (name) => name.endsWith('.kt') || name.endsWith('.java')),
  ];
  let calls = 0;
  const unknown = [];
  const unresolved = [];
  const secrets = [];
  for (const file of files) {
    const result = checkSource(readFileSync(file, 'utf8'), langOf(file), { scopes, allow });
    calls += result.calls.length;
    for (const item of result.unknown) unknown.push({ file, ...item });
    for (const item of result.unresolved) unresolved.push({ file, ...item });
    for (const item of result.secrets) secrets.push({ file, ...item });
  }
  return { lists, listProblems, files, calls, unknown, unresolved, secrets };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/verify/check-log-scopes.mjs');
if (invokedDirectly) {
  const { lists, listProblems, files, calls, unknown, unresolved, secrets } = checkLogScopes();
  const rel = (file) => relative(ROOT, file).replace(/\\/g, '/');
  const names = (list) => (list.length > 0 ? list.join(', ') : '无');
  for (const { platform, missing, extra, duplicates } of listProblems) {
    const source = SCOPE_SOURCES[platform];
    if (missing === null) {
      console.log(`[FAIL] ${source}: 解析不到日志范围清单`);
      continue;
    }
    if (missing.length > 0 || extra.length > 0) {
      console.log(`[FAIL] ${source}: 与 ${SCOPE_SOURCES.web} 不一致，缺少 ${names(missing)}；多出 ${names(extra)}`);
    }
    if (duplicates.length > 0) console.log(`[FAIL] ${source}: 重复的范围 ${names(duplicates)}`);
  }
  for (const { file, line, callee, scope } of unknown) {
    console.log(`[FAIL] ${rel(file)}:${line}: ${callee} 的范围 "${scope}" 未登记`);
  }
  for (const { file, line, callee, text } of unresolved) {
    console.log(`[FAIL] ${rel(file)}:${line}: ${callee} 的范围 ${text} 不是字面量或同文件常量，无法核对`);
  }
  for (const { file, line, callee, reason } of secrets) {
    console.log(`[FAIL] ${rel(file)}:${line}: ${callee} 的消息疑似带敏感内容（${reason}）`);
  }
  const failures = listProblems.length + unknown.length + unresolved.length + secrets.length;
  if (failures > 0) {
    console.log(`日志范围检查未通过（${failures} 处）`);
    process.exit(1);
  }
  console.log(
    `日志范围三端一致（${lists.web.length} 个），${files.length} 个原生源文件里的 ${calls} 处日志调用范围均已登记，未发现敏感字段`,
  );
}
