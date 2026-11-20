#!/usr/bin/env node
/**
 * 安卓壳失败分支日志检查：提醒、密钥库、安装更新、文件分享四块原生代码。
 *
 * 这四块的失败只在用户真机上发生，没有 logcat 时全靠诊断日志定位，又各自碰提醒正文、密码、文件路径。
 * check-log-scopes 管三端范围清单与全仓的密码类字段；这里按区域补四条更细的规则：
 * 1. 每个 `catch` 块、每处 `call.reject(` 所在的最内层块里直接有 `NativeLog.warn` / `NativeLog.error`
 *    （写在更深一层 if / when 分支里的不算；不带花括号的 `if (x) call.reject(…)` 按外层块算），
 *    或登记在 `DELEGATED` 清单（失败已由被调函数记过一次，或是预期分支），清单里的被调函数也要真有 warn / error；
 * 2. 日志范围是常量或字面量，且等于区域约定的范围（`AREAS`），并在 `NativeLog.SCOPES` 里；
 * 3. 日志消息不插值、不拼接 `FORBIDDEN` 里的值（明文、密文、提醒标题正文、完整路径、文件与提醒对象）；
 *    `file.file.name`、`record.id`、`title != null` 这类只取名字、编号或判空的不算；
 *    `credentials` 范围另外不带异常对象、不取 `.message`（异常 message 可能带密文片段），只记类名；
 * 4. `call.reject(` 的实参里没有中日韩字符的字符串字面量：提示文案走 strings.xml。
 *
 * 块按花括号配对，只认 code 片段（词法复用 check-log-scopes 的 lexSource）；
 * `runCatching` / `onFailure` 这类不带 catch 关键字的失败分支不在覆盖范围内。
 *
 * 用法：node tools/verify/check-android-logs.mjs（仓库根目录，或 verify-all.ps1 调用）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLogCalls, lexSource, parseAndroidScopes, resolveScope, SCOPE_SOURCES, stringConstants } from './check-log-scopes.mjs';
import { hasCjk } from './check-ui-literals.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');

/** 四块代码所在的包目录；`AREAS` 与 `DELEGATED` 里的路径都相对它。 */
export const PACKAGE_DIR = 'apps/mobile/android/app/src/main/java/com/dawntick/app';

/** 区域 → 约定范围。`path` 以 `/` 结尾表示整个目录（不含子目录）。 */
export const AREAS = [
  { path: 'reminder/', scope: 'reminder' },
  { path: 'secret/', scope: 'credentials' },
  { path: 'install/ApkInstallerPlugin.kt', scope: 'update' },
  { path: 'share/FileSharePlugin.kt', scope: 'backup' },
];

/**
 * 日志消息里不能出现的值（按表达式链的最后一节比对，区分大小写）。
 * 除约定的几项外：`canonicalPath` 与 `path` 同义；`uri` / `contentUri` 是 FileProvider 地址，带完整相对路径；
 * `record` 是 ReminderRecord，data class 的 toString 会带出标题与正文。
 */
export const FORBIDDEN = new Set([
  'value',
  'plain',
  'ciphertext',
  'encoded',
  'title',
  'body',
  'path',
  'absolutePath',
  'canonicalPath',
  'file',
  'uri',
  'contentUri',
  'record',
]);

/** `credentials` 范围额外禁止的链尾：异常 message 与栈。 */
export const CREDENTIAL_FORBIDDEN = new Set(['message', 'localizedMessage', 'stackTraceToString', 'printStackTrace']);

/** 只改形态不改内容的链尾：`value.trim()` 仍按 value 判定。 */
const TRANSPARENT = new Set([
  'toString',
  'trim',
  'orEmpty',
  'lowercase',
  'uppercase',
  'take',
  'takeLast',
  'substring',
  'substringAfterLast',
  'substringBeforeLast',
  'substringAfter',
  'substringBefore',
  'let',
  'also',
]);

/**
 * 不需要就地记日志的失败分支：`{ file, site, delegate, reason }`。
 * - site：`函数名#reject(R.string.xxx)`（取第一个实参里的资源名，没有时取实参原文）或 `函数名#catch(异常类型)`；
 * - delegate：`文件#函数名`，失败已由它记过一次（检查会核对该函数里确有 warn / error）；
 *   为 null 表示这个分支本身不是失败（写明原因）。
 * 只在确认失败已经落日志、或分支确属预期时才加。
 */
export const DELEGATED = [
  {
    file: 'share/FileSharePlugin.kt',
    site: 'shareFile#reject(R.string.share_no_app)',
    delegate: 'share/FileSharePlugin.kt#startSend',
    reason: 'startSend 的 catch 已按 mime 记 warn，这里只把失败交还 JS',
  },
  {
    file: 'share/FileSharePlugin.kt',
    site: 'revealFile#reject(R.string.share_reveal_failed)',
    delegate: 'share/FileSharePlugin.kt#startSend',
    reason: '前两级 startView 与这一级 startSend 的失败都已各记一次 warn',
  },
  {
    file: 'secret/SecretVault.kt',
    site: 'unavailableCause#catch(Exception)',
    delegate: 'secret/SecretStorePlugin.kt#isAvailable',
    reason: '异常原样返回给 isAvailable，由插件按类名记 warn（SecretVault 不拿 Context）',
  },
  {
    file: 'reminder/ReminderActionsPlugin.kt',
    site: 'handleOnDestroy#catch(IllegalArgumentException)',
    delegate: null,
    reason: '接收器已注销时重复销毁的预期分支，不是失败',
  },
];

// ---------------------------------------------------------------- 源码结构

/** 非代码片段（字符串、注释）换成等长空白，换行保留，便于在代码上直接用正则与括号配对。 */
export function maskSource(source, segments) {
  let output = '';
  for (const segment of segments) {
    const text = source.slice(segment.start, segment.end);
    output += segment.kind === 'code' ? text : text.replace(/[^\n]/g, ' ');
  }
  return output;
}

/** 花括号配对：`[{ open, close }]`，close 为 `}` 的下标；未闭合的以全文末尾为 close。 */
export function bracePairs(masked) {
  const pairs = [];
  const stack = [];
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === '{') stack.push(i);
    else if (masked[i] === '}' && stack.length > 0) pairs.push({ open: stack.pop(), close: i });
  }
  while (stack.length > 0) pairs.push({ open: stack.pop(), close: masked.length });
  return pairs.sort((a, b) => a.open - b.open);
}

/** 包住 index 的最内层块。 */
export function innermostBlock(pairs, index) {
  let best = null;
  for (const pair of pairs) {
    if (pair.open >= index) break;
    if (pair.close > index && (best === null || pair.open > best.open)) best = pair;
  }
  return best;
}

function matchParen(masked, openIndex) {
  let depth = 0;
  for (let j = openIndex; j < masked.length; j += 1) {
    if (masked[j] === '(') depth += 1;
    else if (masked[j] === ')') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return masked.length;
}

/**
 * 函数声明：`[{ name, start, end }]`。块体取配对的花括号；表达式体（`= try { … }`）取到外层块结束，
 * 判定归属时取「起点在前、范围包住」的最后一个，所以后面的函数会先命中。
 */
export function functionRanges(masked, pairs) {
  const ranges = [];
  for (const match of masked.matchAll(/\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(/g)) {
    const close = matchParen(masked, match.index + match[0].length - 1);
    const rest = /^[^{=]*([{=])/.exec(masked.slice(close + 1));
    let end = masked.length;
    if (rest && rest[1] === '{') {
      const open = close + 1 + rest[0].length - 1;
      end = pairs.find((pair) => pair.open === open)?.close ?? masked.length;
    } else {
      end = innermostBlock(pairs, match.index)?.close ?? masked.length;
    }
    ranges.push({ name: match[1], start: match.index, end });
  }
  return ranges;
}

export function enclosingFunction(ranges, index) {
  let found = null;
  for (const range of ranges) {
    if (range.start < index && index < range.end) found = range;
  }
  return found?.name ?? null;
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

/** catch 块：`[{ index, type, block }]`。 */
export function findCatches(masked, pairs) {
  const found = [];
  for (const match of masked.matchAll(/\bcatch\s*\(/g)) {
    const openParen = match.index + match[0].length - 1;
    const closeParen = matchParen(masked, openParen);
    const params = masked.slice(openParen + 1, closeParen);
    // Kotlin `e: A`、Java `A e` / `A | B e`
    const kotlin = /:\s*([\w.]+)/.exec(params);
    const type = kotlin ? kotlin[1] : (params.trim().split(/\s+/).slice(0, -1).join(' ') || params.trim());
    const braceAt = masked.indexOf('{', closeParen);
    const block = pairs.find((pair) => pair.open === braceAt) ?? null;
    found.push({ index: match.index, type: type.split('.').at(-1), block });
  }
  return found;
}

/** `call.reject(` / `savedCall.reject(`：`[{ index, open, close }]`，open / close 为实参括号。 */
export function findRejects(masked) {
  const found = [];
  for (const match of masked.matchAll(/\b\w*[cC]all\s*(?:\?\.|\.)\s*reject\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    found.push({ index: match.index, open, close: matchParen(masked, open) });
  }
  return found;
}

/** reject 的登记名：第一个实参里的 `R.string.xxx`，没有时取第一个实参原文（压掉空白）。 */
function rejectKey(masked, source, reject) {
  const args = source.slice(reject.open + 1, reject.close);
  const resource = /R\s*\.\s*string\s*\.\s*(\w+)/.exec(masked.slice(reject.open + 1, reject.close));
  if (resource) return `R.string.${resource[1]}`;
  let depth = 0;
  let end = args.length;
  for (let j = 0; j < args.length; j += 1) {
    const ch = masked[reject.open + 1 + j];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      end = j;
      break;
    }
  }
  return args.slice(0, end).replace(/\s+/g, '');
}

// ---------------------------------------------------------------- 消息内容

/** 去掉表达式里的字符串字面量（模板里的 `"是"` 之类），只留代码。 */
function stripLiterals(expr) {
  return expr.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * 表达式里不该进日志的值：返回命中的链（如 `record.title`）。
 * 链尾越过 TRANSPARENT；紧挨 `== null` / `!= null` 的判空不算。
 */
export function forbiddenInExpression(expr, { credentials = false } = {}) {
  const code = stripLiterals(expr);
  const hits = [];
  const chain = /[A-Za-z_]\w*(?:\s*(?:\?\.|!!\.|\.)\s*[A-Za-z_]\w*)*/g;
  for (const match of code.matchAll(chain)) {
    const before = code.slice(0, match.index);
    if (/(?:\?\.|\.)\s*$/.test(before)) continue; // 链的中段已由前面的匹配覆盖
    const parts = match[0].split(/\s*(?:\?\.|!!\.|\.)\s*/);
    while (parts.length > 1 && TRANSPARENT.has(parts.at(-1))) parts.pop();
    const last = parts.at(-1);
    const after = code.slice(match.index + match[0].length);
    if (/^\s*(?:!!)?\s*[!=]==?\s*null\b/.test(after) || /\bnull\s*[!=]==?\s*$/.test(before)) continue;
    if (FORBIDDEN.has(last) || (credentials && CREDENTIAL_FORBIDDEN.has(last))) hits.push(match[0].replace(/\s+/g, ''));
  }
  return hits;
}

/** Kotlin 字符串字面量里的模板表达式：`${expr}` 与 `$name`。Java 没有模板。 */
export function templateExpressions(literal, lang) {
  if (lang !== 'kotlin') return [];
  const exprs = [];
  const body = literal;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\') {
      i += 1;
      continue;
    }
    if (body[i] !== '$') continue;
    if (body[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth += 1;
        else if (body[j] === '}') depth -= 1;
        j += 1;
      }
      exprs.push(body.slice(i + 2, j - 1));
      i = j - 1;
    } else {
      const name = /^[A-Za-z_]\w*/.exec(body.slice(i + 1));
      if (name) {
        exprs.push(name[0]);
        i += name[0].length;
      }
    }
  }
  return exprs;
}

function forbiddenInRange(source, segments, range, lang, options) {
  const hits = [];
  let code = '';
  for (const segment of segments) {
    if (segment.end <= range.start || segment.start >= range.end) continue;
    const text = source.slice(Math.max(segment.start, range.start), Math.min(segment.end, range.end));
    if (segment.kind === 'string') {
      for (const expr of templateExpressions(text, lang)) {
        for (const hit of forbiddenInExpression(expr, options)) hits.push(`插值 ${hit}`);
      }
      code += ' "" ';
    } else if (segment.kind === 'code') code += text;
    else code += ' ';
  }
  for (const hit of forbiddenInExpression(code, options)) hits.push(`拼接 ${hit}`);
  return hits;
}

// ---------------------------------------------------------------- 单文件

/**
 * 检查一个源文件。
 * options：`lang`（kotlin | java）、`scope`（区域约定范围）、`scopes`（NativeLog.SCOPES）、`allowSites`（本文件登记的 site）。
 * 返回 `{ calls, sites, unlogged, scopeProblems, forbidden, cjk, usedSites }`，问题项带 line。
 */
export function checkSource(source, { lang = 'kotlin', scope, scopes, allowSites = new Set() } = {}) {
  const segments = lexSource(source, lang);
  const masked = maskSource(source, segments);
  const pairs = bracePairs(masked);
  const functions = functionRanges(masked, pairs);
  const constants = stringConstants(source);
  const registered = new Set(scopes ?? []);
  const calls = findLogCalls(source, lang, segments).map((call) => ({
    ...call,
    index: call.scope?.start ?? 0,
  }));
  const failureLogs = calls.filter((call) => call.level === 'warn' || call.level === 'error');
  // 日志要直接写在这一层块里：嵌套的 if / when 分支里那条只覆盖它自己的分支
  const loggedWithin = (block) =>
    block !== null && failureLogs.some((call) => innermostBlock(pairs, call.index)?.open === block.open);

  const sites = [];
  const unlogged = [];
  const usedSites = new Set();
  const report = (kind, index, key, block) => {
    const fn = enclosingFunction(functions, index) ?? '(顶层)';
    const site = `${fn}#${kind}(${key})`;
    const line = lineAt(source, index);
    sites.push({ line, site });
    if (loggedWithin(block)) return;
    if (allowSites.has(site)) {
      usedSites.add(site);
      return;
    }
    unlogged.push({ line, site });
  };
  for (const item of findCatches(masked, pairs)) report('catch', item.index, item.type, item.block);
  const rejects = findRejects(masked);
  for (const item of rejects) report('reject', item.index, rejectKey(masked, source, item), innermostBlock(pairs, item.index));

  const scopeProblems = [];
  const forbidden = [];
  for (const call of calls) {
    const line = call.line;
    let resolved = null;
    if (call.scope === null) scopeProblems.push({ line, callee: call.callee, problem: '缺少范围实参' });
    else {
      const result = resolveScope(source.slice(call.scope.start, call.scope.end), constants);
      if ('scope' in result) resolved = result.scope;
      else scopeProblems.push({ line, callee: call.callee, problem: `范围 ${result.unresolved} 不是字面量或同文件常量` });
    }
    if (resolved !== null && !registered.has(resolved)) {
      scopeProblems.push({ line, callee: call.callee, problem: `范围 "${resolved}" 不在 NativeLog.SCOPES` });
    }
    if (resolved !== null && scope !== undefined && resolved !== scope) {
      scopeProblems.push({ line, callee: call.callee, problem: `范围 "${resolved}"，本区域应为 "${scope}"` });
    }
    const credentials = (resolved ?? scope) === 'credentials';
    const [message, ...rest] = call.messages;
    if (message !== undefined) {
      for (const reason of forbiddenInRange(source, segments, message, lang, { credentials })) {
        forbidden.push({ line, callee: call.callee, reason });
      }
    }
    if (credentials && rest.length > 0) {
      forbidden.push({ line, callee: call.callee, reason: '带了异常对象（会附上 message），只记类名' });
    }
  }

  const cjk = [];
  for (const item of rejects) {
    for (const segment of segments) {
      if (segment.kind !== 'string' || segment.end <= item.open || segment.start >= item.close) continue;
      const text = source.slice(segment.start, segment.end);
      if (hasCjk(text)) cjk.push({ line: lineAt(source, segment.start), text });
    }
  }
  return { calls, sites, unlogged, scopeProblems, forbidden, cjk, usedSites, functions, failureLogs };
}

// ---------------------------------------------------------------- 全仓

function areaFiles(root, area) {
  const full = join(root, PACKAGE_DIR, area.path);
  if (!area.path.endsWith('/')) return existsSync(full) ? [area.path] : null;
  if (!existsSync(full)) return null;
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name.endsWith('.kt') || entry.name.endsWith('.java')))
    .map((entry) => `${area.path}${entry.name}`)
    .sort();
}

/**
 * 全仓检查。返回 `{ files, calls, sites, missingAreas, unlogged, scopeProblems, forbidden, cjk, badDelegates, stale }`，
 * 问题项带 file（相对 PACKAGE_DIR）。
 */
export function checkAndroidLogs({ root = ROOT, areas = AREAS, delegated = DELEGATED } = {}) {
  const scopesSource = join(root, SCOPE_SOURCES.android);
  const scopes = parseAndroidScopes(existsSync(scopesSource) ? readFileSync(scopesSource, 'utf8') : '') ?? [];
  const results = new Map();
  const missingAreas = [];
  const out = { files: [], calls: 0, sites: 0, unlogged: [], scopeProblems: [], forbidden: [], cjk: [] };
  for (const area of areas) {
    const files = areaFiles(root, area);
    if (files === null || files.length === 0) {
      missingAreas.push(area.path);
      continue;
    }
    for (const file of files) {
      const allowSites = new Set(delegated.filter((entry) => entry.file === file).map((entry) => entry.site));
      const lang = file.endsWith('.java') ? 'java' : 'kotlin';
      const result = checkSource(readFileSync(join(root, PACKAGE_DIR, file), 'utf8'), {
        lang,
        scope: area.scope,
        scopes,
        allowSites,
      });
      results.set(file, result);
      out.files.push(file);
      out.calls += result.calls.length;
      out.sites += result.sites.length;
      for (const key of ['unlogged', 'scopeProblems', 'forbidden', 'cjk']) {
        for (const item of result[key]) out[key].push({ file, ...item });
      }
    }
  }

  const badDelegates = [];
  const stale = [];
  for (const entry of delegated) {
    const result = results.get(entry.file);
    if (result === undefined || !result.usedSites.has(entry.site)) {
      stale.push(entry);
      continue;
    }
    if (entry.delegate === null) continue;
    const [file, name] = entry.delegate.split('#');
    const target = results.get(file);
    const fn = target?.functions.find((range) => range.name === name);
    const logs = fn !== undefined && target.failureLogs.some((call) => call.index > fn.start && call.index < fn.end);
    if (!logs) badDelegates.push({ ...entry, problem: fn === undefined ? '找不到该函数' : '函数里没有 NativeLog.warn / error' });
  }
  return { ...out, missingAreas, badDelegates, stale, scopes };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/verify/check-android-logs.mjs');
if (invokedDirectly) {
  const result = checkAndroidLogs();
  const at = (file, line) => `${PACKAGE_DIR}/${file}:${line}`;
  for (const path of result.missingAreas) console.log(`[FAIL] ${PACKAGE_DIR}/${path}: 区域不存在或没有源文件，AREAS 需要跟着改`);
  for (const { file, line, site } of result.unlogged) {
    console.log(`[FAIL] ${at(file, line)}: ${site} 所在块里没有 NativeLog.warn / error，也没有登记在 DELEGATED`);
  }
  for (const { file, line, callee, problem } of result.scopeProblems) console.log(`[FAIL] ${at(file, line)}: ${callee} ${problem}`);
  for (const { file, line, callee, reason } of result.forbidden) {
    console.log(`[FAIL] ${at(file, line)}: ${callee} 的消息不应带这个值（${reason}）`);
  }
  for (const { file, line, text } of result.cjk) console.log(`[FAIL] ${at(file, line)}: call.reject 里有中文字面量 ${text}，改用 strings.xml`);
  for (const { file, site, delegate, problem } of result.badDelegates) {
    console.log(`[FAIL] DELEGATED ${file} ${site}: 委托的 ${delegate} ${problem}`);
  }
  for (const { file, site } of result.stale) console.log(`[FAIL] DELEGATED ${file} ${site}: 已无对应的未记日志分支，删掉这条`);
  const failures =
    result.missingAreas.length +
    result.unlogged.length +
    result.scopeProblems.length +
    result.forbidden.length +
    result.cjk.length +
    result.badDelegates.length +
    result.stale.length;
  if (failures > 0) {
    console.log(`安卓失败分支日志检查未通过（${failures} 处）`);
    process.exit(1);
  }
  console.log(
    `安卓失败分支日志：${result.files.length} 个文件、${result.sites} 处 catch / reject 均有 warn 或已登记委托，` +
      `${result.calls} 处日志范围与区域一致，消息不带敏感值，reject 无中文字面量`,
  );
}
