#!/usr/bin/env node
/**
 * 小组件布局白名单检查：RemoteViews 只能 inflate 一组固定的视图类。
 *
 * 布局里混进白名单外的标签（例如裸 `<View>`），编译与单测都不会报错，
 * 到桌面上整块小组件只显示「载入窗口小部件时出现问题」。这里在构建前兜住：
 * - 从 res/xml/widget_*_info.xml 读 android:initialLayout / android:previewLayout；
 * - 顺着 `<include layout>` 与 `<ViewStub android:layout>` 递归收集被引用的布局，
 *   同名布局的各限定符目录（layout-v31 等）一并扫描；
 * - 逐个元素比对白名单，CheckBox / RadioButton / RadioGroup / Switch 要求 minSdk ≥ 31。
 *
 * 用法：node tools/verify/check-widget-layouts.mjs（仓库根目录，或 verify-all.ps1 调用）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const ANDROID_DIR = join(ROOT, 'apps/mobile/android');
const RES_DIR = join(ANDROID_DIR, 'app/src/main/res');
const DEFAULT_MIN_SDK = 24;

/** minSdk 24 起即可用的 RemoteViews 视图类，外加非视图标签 include / merge。 */
const BASE_ALLOWED = [
  'FrameLayout',
  'LinearLayout',
  'RelativeLayout',
  'GridLayout',
  'AnalogClock',
  'Button',
  'Chronometer',
  'ImageButton',
  'ImageView',
  'ProgressBar',
  'TextView',
  'ViewFlipper',
  'ListView',
  'GridView',
  'StackView',
  'AdapterViewFlipper',
  'ViewStub',
  'include',
  'merge',
];

/** API 31 起 RemoteViews 才接受的复合按钮。 */
const API31_ALLOWED = ['CheckBox', 'RadioButton', 'RadioGroup', 'Switch'];

/** 按 minSdk 给出白名单。 */
export function allowedTags(minSdk = DEFAULT_MIN_SDK) {
  return new Set(minSdk >= 31 ? [...BASE_ALLOWED, ...API31_ALLOWED] : BASE_ALLOWED);
}

/** 注释替换为等长空白（保留换行），行号不受影响。 */
function blankComments(xmlText) {
  return xmlText.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** 列出所有开始标签（含自闭合），跳过结束标签、`<?xml ?>`、`<!DOCTYPE>`、CDATA 与注释。 */
export function listTags(xmlText) {
  const source = blankComments(xmlText).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (cdata) =>
    cdata.replace(/[^\n]/g, ' '),
  );
  const tags = [];
  const pattern = /<(?![/?!])([^\s/>]+)([^>]*)>/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length;
    tags.push({ tag: match[1], attrs: match[2], line });
  }
  return tags;
}

/** `android.widget.TextView` 与 `TextView` 是同一个类；其他带包名的写法一律不认。 */
function shortName(tag) {
  return tag.startsWith('android.widget.') ? tag.slice('android.widget.'.length) : tag;
}

/** 白名单外的元素：`[{ tag, line }]`，line 从 1 起。 */
export function findDisallowedViews(xmlText, { minSdk = DEFAULT_MIN_SDK } = {}) {
  const allowed = allowedTags(minSdk);
  return listTags(xmlText)
    .filter(({ tag }) => !allowed.has(shortName(tag)))
    .map(({ tag, line }) => ({ tag, line }));
}

/** 布局里通过 include / ViewStub 引用的其他布局名。 */
export function referencedLayouts(xmlText) {
  const names = [];
  for (const { tag, attrs } of listTags(xmlText)) {
    const attr =
      tag === 'include'
        ? /(?:^|\s)layout\s*=\s*"@layout\/([\w.]+)"/.exec(attrs)
        : shortName(tag) === 'ViewStub'
          ? /android:layout\s*=\s*"@layout\/([\w.]+)"/.exec(attrs)
          : null;
    if (attr) names.push(attr[1]);
  }
  return names;
}

/** 从 widget_*_info.xml 取 initialLayout / previewLayout 的布局名。 */
export function providerLayouts(infoXml) {
  const source = blankComments(infoXml);
  const names = [];
  const pattern = /android:(?:initialLayout|previewLayout)\s*=\s*"@layout\/([\w.]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) names.push(match[1]);
  return names;
}

/** variables.gradle 里的 minSdkVersion，读不到按 24。 */
export function readMinSdk(androidDir = ANDROID_DIR) {
  const file = join(androidDir, 'variables.gradle');
  if (!existsSync(file)) return DEFAULT_MIN_SDK;
  const match = /minSdkVersion\s*=\s*(\d+)/.exec(readFileSync(file, 'utf8'));
  return match ? Number(match[1]) : DEFAULT_MIN_SDK;
}

/** 名为 name 的布局在各 layout* 目录下的文件。 */
function layoutFiles(resDir, name) {
  return readdirSync(resDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^layout(-|$)/.test(entry.name))
    .map((entry) => join(resDir, entry.name, `${name}.xml`))
    .filter((file) => existsSync(file));
}

/** 扫描所有小组件布局，返回 `{ files, failures, missing }`。 */
export function checkWidgetLayouts({ resDir = RES_DIR, minSdk = readMinSdk() } = {}) {
  const xmlDir = join(resDir, 'xml');
  const infos = readdirSync(xmlDir).filter((name) => /^widget_.*_info\.xml$/.test(name));
  const queue = infos.flatMap((info) => providerLayouts(readFileSync(join(xmlDir, info), 'utf8')));
  const seen = new Set();
  const files = [];
  const failures = [];
  const missing = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const found = layoutFiles(resDir, name);
    if (found.length === 0) missing.push(name);
    for (const file of found) {
      const xml = readFileSync(file, 'utf8');
      files.push(file);
      for (const { tag, line } of findDisallowedViews(xml, { minSdk })) {
        failures.push({ file, tag, line });
      }
      queue.push(...referencedLayouts(xml));
    }
  }
  return { infos, files, failures, missing, minSdk };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/verify/check-widget-layouts.mjs');
if (invokedDirectly) {
  const { infos, files, failures, missing, minSdk } = checkWidgetLayouts();
  const rel = (file) => relative(ROOT, file).replace(/\\/g, '/');
  for (const name of missing) console.log(`[FAIL] 找不到布局 @layout/${name}`);
  for (const { file, tag, line } of failures) {
    console.log(`[FAIL] ${rel(file)}:${line}: <${tag}> 不在 RemoteViews 白名单内（minSdk ${minSdk}）`);
  }
  if (infos.length === 0) console.log('[FAIL] 未找到 res/xml/widget_*_info.xml');
  if (failures.length > 0 || missing.length > 0 || infos.length === 0) {
    console.log(`小组件布局检查未通过（${failures.length + missing.length + (infos.length === 0 ? 1 : 0)} 处）`);
    process.exit(1);
  }
  console.log(`[PASS] ${files.map(rel).join(' ')}`);
  console.log(`小组件布局均在 RemoteViews 白名单内（${infos.length} 个小组件 / ${files.length} 个布局，minSdk ${minSdk}）`);
}
