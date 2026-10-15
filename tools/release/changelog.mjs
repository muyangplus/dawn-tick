import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHANGELOG_FILE = 'CHANGELOG.md';

/** 版本段标题：`## [0.2.0]` 或 `## [0.2.0] - 2026-10-15`，方括号可省略。 */
function headingPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+\\[?${escaped}\\]?(?:\\s+-\\s+.*)?\\s*$`, 'm');
}

/** 未发布段标题：`## [未发布]` / `## [Unreleased]`。 */
export const UNRELEASED_PATTERN = /^##\s+\[?(?:未发布|Unreleased)\]?\s*$/m;

/**
 * 取出某个版本的正文（不含标题行，去掉首尾空行）。
 * 找不到该版本时返回 null：调用方据此回退到别的发布说明来源。
 */
export function extractSection(text, version) {
  const pattern = headingPattern(version);
  const match = pattern.exec(text);
  if (match === null) return null;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = /^##\s+/m.exec(rest);
  const body = (next === null ? rest : rest.slice(0, next.index)).trim();
  return body.length === 0 ? null : body;
}

/** 未发布段的正文；没有这一节时返回 null。 */
export function extractUnreleased(text) {
  const match = UNRELEASED_PATTERN.exec(text);
  if (match === null) return null;
  const rest = text.slice(match.index + match[0].length);
  const next = /^##\s+/m.exec(rest);
  const body = (next === null ? rest : rest.slice(0, next.index)).trim();
  return body.length === 0 ? null : body;
}

/** 文件里出现过的版本号，按出现顺序。 */
export function releasedVersions(text) {
  const out = [];
  for (const match of text.matchAll(/^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/gm)) {
    out.push(match[1]);
  }
  return out;
}

/** 结构自检：要有标题、要有未发布段，已发布版本必须带日期。 */
export function checkChangelog(text) {
  const problems = [];
  if (!/^#\s+变更日志/m.test(text) && !/^#\s+Changelog/m.test(text)) {
    problems.push('缺少一级标题（# 变更日志）');
  }
  if (extractUnreleased(text) === null) problems.push('缺少「未发布」段或有内容为空');
  for (const version of releasedVersions(text)) {
    const heading = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?\\s+-\\s+(\\d{4}-\\d{2}-\\d{2})\\s*$`, 'm');
    if (!heading.test(text)) problems.push(`${version} 缺少发布日期（应为「## [${version}] - YYYY-MM-DD」）`);
  }
  return problems;
}

export function readChangelog(root = process.cwd()) {
  return readFileSync(join(root, CHANGELOG_FILE), 'utf8');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/changelog.mjs');
if (invokedDirectly) {
  const args = new Map();
  for (const raw of process.argv.slice(2)) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    args.set(key, rest.join('='));
  }
  let text;
  try {
    text = readChangelog();
  } catch (error) {
    process.stderr.write(`读不到 ${CHANGELOG_FILE}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  if (args.has('extract')) {
    const version = args.get('extract') ?? '';
    const body = version.length === 0 ? extractUnreleased(text) : extractSection(text, version);
    if (body === null) {
      process.stderr.write(`CHANGELOG 里没有 ${version.length === 0 ? '未发布' : version} 段\n`);
      process.exit(1);
    }
    process.stdout.write(`${body}\n`);
  } else if (args.has('versions')) {
    process.stdout.write(`${releasedVersions(text).join('\n')}\n`);
  } else if (args.has('check')) {
    const problems = checkChangelog(text);
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    if (problems.length > 0) process.exit(1);
    process.stdout.write(`${CHANGELOG_FILE} 结构正常\n`);
  } else {
    process.stderr.write('用法: --extract=<版本> | --extract | --versions | --check\n');
    process.exit(1);
  }
}
