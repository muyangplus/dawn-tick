import { AA_LARGE, AA_TEXT, contrastRatio, mix } from '../../apps/web/src/design/contrast.ts';
import {
  BREAKPOINT,
  FONT_FAMILY,
  FONT_SIZE,
  PRESETS,
  RADIUS,
  SHADOW,
  SPACING,
  TAP_MIN,
  courseTint,
} from '../../apps/web/src/design/tokens.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STYLES_PATH = join(process.cwd(), 'apps/web/src/styles.css');

/** 文字配对：前景 / 背景 / 最低对比度。 */
export const TEXT_PAIRS = [
  ['text', 'bg', AA_TEXT],
  ['text', 'surface', AA_TEXT],
  ['text', 'surfaceMuted', AA_TEXT],
  ['muted', 'bg', AA_TEXT],
  ['muted', 'surface', AA_TEXT],
  ['primaryStrong', 'bg', AA_TEXT],
  ['primaryStrong', 'surface', AA_TEXT],
  ['accentStrong', 'bg', AA_TEXT],
  ['successStrong', 'bg', AA_TEXT],
  ['warningStrong', 'bg', AA_TEXT],
  ['dangerStrong', 'bg', AA_TEXT],
  ['infoStrong', 'bg', AA_TEXT],
  ['onPrimary', 'primary', AA_TEXT],
];

export const UI_PAIRS = [
  ['borderStrong', 'surface', AA_LARGE],
  ['primaryStrong', 'surface', AA_LARGE],
];

function cssBlock(source, header) {
  const start = source.indexOf(header);
  if (start === -1) throw new Error(`styles.css 缺少 ${header}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const body = source.slice(open + 1, close);
  const entries = {};
  for (const line of body.split('\n')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/i.exec(line);
    if (match !== null) entries[match[1]] = match[2].trim();
  }
  return entries;
}

function toPx(value) {
  const match = /^(-?[\d.]+)px$/.exec(String(value).trim());
  if (match === null) throw new Error(`期望 px 值: ${value}`);
  return Number(match[1]);
}

/** 校验 styles.css 的静态令牌与 tokens.ts 一致，避免两处漂移。 */
export function checkStaticTokens(stylesSource = readFileSync(STYLES_PATH, 'utf8')) {
  const failures = [];
  const theme = cssBlock(stylesSource, '@theme {');

  for (const [key, value] of Object.entries(SPACING)) {
    const css = theme[`--spacing-${key}`];
    if (css === undefined || toPx(css) !== toPx(value)) failures.push(`间距 ${key}: css=${css} ts=${value}`);
  }
  const tapCss = theme['--spacing-tap'];
  if (tapCss === undefined || toPx(tapCss) !== TAP_MIN) {
    failures.push(`触控令牌 --spacing-tap: css=${tapCss} ts=${TAP_MIN}px`);
  }
  for (const [key, value] of Object.entries(RADIUS)) {
    if (key === 'full') continue;
    const css = theme[`--radius-${key}`];
    if (css === undefined || toPx(css) !== toPx(value)) failures.push(`圆角 ${key}: css=${css} ts=${value}`);
  }
  for (const [key, value] of Object.entries(FONT_SIZE)) {
    const css = theme[`--text-${key}`];
    if (css === undefined || toPx(css) !== toPx(value)) failures.push(`字号 ${key}: css=${css} ts=${value}`);
  }
  for (const [key, value] of Object.entries(SHADOW)) {
    const css = theme[`--shadow-${key}`];
    if (css !== value) failures.push(`阴影 ${key}: css=${css} ts=${value}`);
  }
  for (const [key, value] of Object.entries(BREAKPOINT)) {
    const css = theme[`--breakpoint-${key}`];
    if (css === undefined || toPx(css) !== Number(value)) failures.push(`断点 ${key}: css=${css} ts=${value}`);
  }
  const normalizeFamily = (value) => String(value).replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  if (normalizeFamily(theme['--font-sans'] ?? '') !== normalizeFamily(FONT_FAMILY)) {
    failures.push(`字体族不一致: css=${theme['--font-sans']} ts=${FONT_FAMILY}`);
  }
  return failures;
}

export function runChecks(stylesSource) {
  const failures = [];
  const rows = [];

  for (const [preset, tokens] of Object.entries(PRESETS)) {
    for (const mode of ['light', 'dark']) {
      const colors = tokens[mode];
      for (const [foreground, background, required] of [...TEXT_PAIRS, ...UI_PAIRS]) {
        const ratio = contrastRatio(colors[foreground], colors[background]);
        const ok = ratio >= required;
        if (!ok) {
          failures.push(`${preset}/${mode} ${foreground} on ${background} = ${ratio.toFixed(2)} < ${required}`);
        }
        rows.push({ preset, mode, pair: `${foreground}/${background}`, ratio, required, ok });
      }
      for (const [index, color] of tokens.courses.entries()) {
        const tint = courseTint(colors.surface, color);
        // 色块内文字只用 ink 或 ink 降到 80% 不透明度；muted 在部分课程色上不达标，禁止使用。
        const ink80 = mix(tint, colors.text, 0.8);
        for (const [role, foreground] of [['text', colors.text], ['text@80%', ink80]]) {
          const ratio = contrastRatio(foreground, tint);
          if (ratio < AA_TEXT) {
            failures.push(`${preset}/${mode} 课程色 ${index} 块内 ${role} = ${ratio.toFixed(2)} < ${AA_TEXT}`);
          }
        }
      }
    }
  }

  if (TAP_MIN < 44) failures.push(`触控尺寸 ${TAP_MIN}px < 44px`);

  failures.push(...checkStaticTokens(stylesSource));
  return { failures, rows };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/design/check-a11y.mjs');
if (invokedDirectly) {
  const { failures, rows } = runChecks();
  const worst = [...rows].sort((a, b) => a.ratio - b.ratio).slice(0, 5);
  console.log(`对比度检查项 ${rows.length} 条，触控下限 ${TAP_MIN}px`);
  for (const row of worst) {
    console.log(`  最低: ${row.preset}/${row.mode} ${row.pair} = ${row.ratio.toFixed(2)} (需 ${row.required})`);
  }
  if (failures.length > 0) {
    console.error(`未通过 ${failures.length} 项:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('全部通过');
}
