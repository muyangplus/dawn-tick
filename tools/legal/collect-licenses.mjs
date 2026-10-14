#!/usr/bin/env node
/**
 * 生成第三方许可证声明。
 *
 * 数据来源（全部实际读取，不手写）：
 *   1. 各端 package.json 的 `dependencies`，版本与许可证取自 node_modules 里已安装包的 package.json；
 *   2. 桌面端 Cargo.toml 的直接依赖，版本取自 Cargo.lock，许可证取自 cargo 注册表里该 crate 的 Cargo.toml。
 * 许可证全文取自各包/crate 自带的 LICENSE / LICENCE / COPYING 文件。
 *
 * 用法：
 *   node tools/legal/collect-licenses.mjs            写入声明与前端清单
 *   node tools/legal/collect-licenses.mjs --check    只校验磁盘内容是否与生成结果一致（退出码 1 表示不一致）
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MARKDOWN_PATH = join(ROOT, 'THIRD-PARTY-LICENSES.md');
const LIST_PATH = join(ROOT, 'apps/web/src/legal/credits.generated.ts');
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

/**
 * 已安装包的 package.json 路径。
 * pnpm 的 store 目录名会带 peer 依赖哈希后缀，因此不拼目录名，直接沿 workspace 的软链解析真实路径。
 */
function installedPackageJson(app, name) {
  for (const base of [join(ROOT, app, 'node_modules'), join(ROOT, 'node_modules')]) {
    const candidate = join(base, name, 'package.json');
    if (!existsSync(candidate)) continue;
    const real = realpathSync(candidate);
    if (existsSync(real)) return real;
  }
  return null;
}

function licenseTextOf(dir) {
  if (dir === null || !existsSync(dir)) return null;
  for (const entry of readdirSync(dir)) {
    if (LICENSE_FILE_PATTERN.test(entry)) {
      const text = readTextIfExists(join(dir, entry));
      if (text !== null && text.length > 0) return text;
    }
  }
  return null;
}

/** 各端 npm 直接依赖。 */
function collectNpmDependencies() {
  const rows = [];
  for (const app of ['apps/web', 'apps/mobile']) {
    const manifest = readJson(join(ROOT, app, 'package.json'));
    for (const name of Object.keys(manifest.dependencies ?? {}).sort()) {
      if (name.startsWith('@dawn-tick/')) continue;
      const found = installedPackageJson(app, name);
      if (found === null) throw new Error(`${app}: 未安装 ${name}，先执行 pnpm install`);
      const pkg = readJson(found);
      const dir = dirname(found);
      const license = typeof pkg.license === 'string' ? pkg.license : licenseOfLegacyField(pkg);
      if (license === null) throw new Error(`${app}: ${name} 未声明 license 字段`);
      rows.push({
        component: app === 'apps/web' ? 'Web' : 'Android',
        name,
        version: String(pkg.version ?? ''),
        license,
        text: licenseTextOf(dir),
      });
    }
  }
  return rows;
}

/** 老包用 licenses 数组或 license 对象声明。 */
function licenseOfLegacyField(pkg) {
  const list = pkg.licenses;
  if (Array.isArray(list) && list.length > 0) {
    const types = list.map((item) => (typeof item === 'string' ? item : item?.type)).filter(Boolean);
    if (types.length > 0) return types.join(' OR ');
  }
  if (typeof pkg.license === 'object' && pkg.license !== null && typeof pkg.license.type === 'string') {
    return pkg.license.type;
  }
  return null;
}

function cargoTomlValue(text, key) {
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm').exec(text);
  return match === null ? null : match[1];
}

/** Cargo.toml 里一条依赖的版本要求（字符串形式或 `{ version = "…" }`）。 */
function dependencyRequirement(line) {
  const inline = /=\s*"([^"]+)"/.exec(line);
  if (inline !== null) return inline[1];
  const table = /=\s*\{([^}]*)\}/.exec(line);
  if (table === null) return null;
  const version = /version\s*=\s*"([^"]+)"/.exec(table[1]);
  return version === null ? null : version[1];
}

/** 版本要求去掉 ^ ~ = 等前缀后作为比对前缀。 */
function requirementPrefix(requirement) {
  return requirement.replace(/^[\^~=><\s]*/, '').split(',')[0].trim();
}

/** Cargo.lock 里某个 crate 的全部版本。 */
function lockVersions(lock, name) {
  const versions = [];
  const pattern = /\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g;
  let match = pattern.exec(lock);
  while (match !== null) {
    if (match[1] === name) versions.push(match[2]);
    match = pattern.exec(lock);
  }
  return versions;
}

/** 桌面端 Cargo.toml 的直接依赖（含 build-dependencies 与目标平台依赖）。 */
function collectCargoDependencies() {
  const cargoToml = readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const lock = readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  const wanted = new Map();
  let section = '';
  for (const line of cargoToml.split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header !== null) {
      section = header[1];
      continue;
    }
    // 只收运行时依赖：dev-dependencies 只在开发与测试时使用，不进产物
    if (!section.endsWith('dependencies') || section.startsWith('dev-')) continue;
    const name = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (name === null) continue;
    wanted.set(name[1], dependencyRequirement(line) ?? '');
  }
  const registrySrc = findRegistrySrc();
  const rows = [];
  for (const name of [...wanted.keys()].sort()) {
    const prefix = requirementPrefix(wanted.get(name));
    const versions = lockVersions(lock, name);
    if (versions.length === 0) throw new Error(`Cargo.lock 里找不到 ${name}`);
    const matched = versions
      .filter((version) => prefix === '' || version === prefix || version.startsWith(`${prefix}.`))
      .sort(compareVersionsDesc);
    const candidates = matched.length > 0 ? matched : versions.sort(compareVersionsDesc);
    const found = candidates.find((version) => existsSync(join(registrySrc, `${name}-${version}`)));
    if (found === undefined) {
      throw new Error(`cargo 注册表里找不到 ${name}-${candidates[0]}，先执行 cargo fetch`);
    }
    const crateDir = join(registrySrc, `${name}-${found}`);
    const manifest = readFileSync(join(crateDir, 'Cargo.toml'), 'utf8');
    const license = cargoTomlValue(manifest, 'license') ?? cargoTomlValue(manifest, 'license-file');
    if (license === null) throw new Error(`${name}-${found} 未声明 license`);
    rows.push({
      component: 'Windows',
      name,
      version: found,
      license,
      text: licenseTextOf(crateDir),
    });
  }
  return rows;
}

function compareVersionsDesc(left, right) {
  const parse = (value) => value.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function findRegistrySrc() {
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
  const src = join(cargoHome, 'registry', 'src');
  if (!existsSync(src)) throw new Error(`找不到 cargo 注册表源码目录：${src}`);
  const registries = readdirSync(src).filter((entry) => !entry.startsWith('.'));
  if (registries.length === 0) throw new Error(`${src} 下没有注册表目录，先执行 cargo fetch`);
  return join(src, registries[0]);
}

function escapeCell(text) {
  return text.replace(/\|/g, '\\|');
}

function renderMarkdown(rows) {
  const lines = [];
  lines.push('# 第三方许可证声明');
  lines.push('');
  lines.push('本文件由 `node tools/legal/collect-licenses.mjs` 生成：版本与许可证取自各端清单与实际安装的依赖元数据，');
  lines.push('许可证全文取自各包自带的许可证文件。收录范围为各端**直接依赖**：');
  lines.push('`apps/web` 与 `apps/mobile` 的 `dependencies`、`apps/desktop/src-tauri/Cargo.toml` 的 `dependencies`、');
  lines.push('`build-dependencies` 与目标平台相关依赖（不含只在开发与测试时使用的 dev-dependencies）。');
  lines.push('');
  lines.push('校验一致性：`node tools/legal/collect-licenses.mjs --check`（不一致时退出码 1）。');
  lines.push('');
  lines.push('## 清单');
  lines.push('');
  lines.push('| 组件 | 依赖 | 版本 | 许可证 |');
  lines.push('|---|---|---|---|');
  for (const row of rows) {
    lines.push(`| ${row.component} | ${escapeCell(row.name)} | ${row.version} | ${escapeCell(row.license)} |`);
  }
  lines.push('');
  lines.push('## 许可证全文');
  lines.push('');
  const byLicense = new Map();
  for (const row of rows) {
    const list = byLicense.get(row.license) ?? [];
    list.push(row);
    byLicense.set(row.license, list);
  }
  for (const license of [...byLicense.keys()].sort()) {
    lines.push(`### ${license}`);
    lines.push('');
    for (const row of byLicense.get(license)) {
      lines.push(`#### ${row.name} ${row.version}（${row.component}）`);
      lines.push('');
      if (row.text === null) {
        lines.push('该包未随附许可证全文，许可证类型以上表声明为准。');
      } else {
        lines.push('```text');
        lines.push(row.text);
        lines.push('```');
      }
      lines.push('');
    }
  }
  lines.push('');
  return lines.join('\n');
}

function quote(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderList(rows) {
  const lines = [];
  lines.push('// 由 tools/legal/collect-licenses.mjs 生成，请勿手改。');
  lines.push('export interface RuntimeCredit {');
  lines.push('  component: string;');
  lines.push('  name: string;');
  lines.push('  version: string;');
  lines.push('  license: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const RUNTIME_CREDITS: readonly RuntimeCredit[] = [');
  for (const row of rows) {
    lines.push(
      `  { component: ${quote(row.component)}, name: ${quote(row.name)}, version: ${quote(row.version)}, license: ${quote(row.license)} },`,
    );
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const rows = [...collectNpmDependencies(), ...collectCargoDependencies()];
  const markdown = renderMarkdown(rows);
  const list = renderList(rows);
  if (check) {
    const problems = [];
    if (readTextIfExists(MARKDOWN_PATH) !== markdown.trim()) problems.push('THIRD-PARTY-LICENSES.md');
    if (readTextIfExists(LIST_PATH) !== list.trim()) problems.push('apps/web/src/legal/credits.generated.ts');
    if (problems.length > 0) {
      console.error(`许可证声明与依赖不一致：${problems.join('、')}`);
      console.error('执行 node tools/legal/collect-licenses.mjs 重新生成');
      process.exit(1);
    }
    console.log(`许可证声明一致：${rows.length} 项直接依赖`);
    return;
  }
  writeFileSync(MARKDOWN_PATH, `${markdown.trim()}\n`, 'utf8');
  writeFileSync(LIST_PATH, list, 'utf8');
  console.log(`已写入许可证声明：${rows.length} 项直接依赖`);
}

main();
