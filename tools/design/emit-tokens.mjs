import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BREAKPOINT,
  FONT_FAMILY,
  FONT_SIZE,
  PRESETS,
  RADIUS,
  SHADOW,
  SPACING,
  TAP_MIN,
} from '../../apps/web/src/design/tokens.ts';

const target = process.argv[2] ?? 'local-notes/docs/design-tokens.json';

const payload = {
  spacing: SPACING,
  radius: RADIUS,
  fontSize: FONT_SIZE,
  fontFamily: FONT_FAMILY,
  shadow: SHADOW,
  breakpoint: BREAKPOINT,
  tapMin: TAP_MIN,
  presets: Object.fromEntries(
    Object.entries(PRESETS).map(([preset, tokens]) => [
      preset,
      { label: tokens.label, light: tokens.light, dark: tokens.dark, courses: tokens.courses },
    ]),
  ),
};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`已写入 ${target}`);
