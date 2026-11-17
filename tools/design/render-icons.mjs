#!/usr/bin/env node
/**
 * 由 assets/brand/*.svg 生成三端图标：桌面 PNG + ICO、安卓启动器（含自适应前景/背景/单色）与通知小图标、网页 favicon。
 * 用无头 Chromium 栅格化，需要能 `require('playwright')`（或用 CHROMIUM_PATH 指定浏览器）。
 *
 *   node tools/design/render-icons.mjs
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const brand = join(root, 'assets', 'brand');
const desktop = join(root, 'apps', 'desktop', 'src-tauri', 'icons');
const res = join(root, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res');
const web = join(root, 'apps', 'web', 'public');

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** 每项：源 SVG → 目标文件与边长；`white` 把图形转成纯白（通知小图标）。 */
const jobs = [
  ['app-icon.svg', join(desktop, '32x32.png'), 32],
  ['app-icon.svg', join(desktop, '128x128.png'), 128],
  ['app-icon.svg', join(desktop, '128x128@2x.png'), 256],
  ['app-icon.svg', join(desktop, 'icon.png'), 512],
];
for (const [name, scale] of Object.entries(DENSITIES)) {
  const dir = join(res, `mipmap-${name}`);
  jobs.push(['app-icon.svg', join(dir, 'ic_launcher.png'), 48 * scale]);
  jobs.push(['app-icon-round.svg', join(dir, 'ic_launcher_round.png'), 48 * scale]);
  jobs.push(['adaptive-foreground.svg', join(dir, 'ic_launcher_foreground.png'), 108 * scale]);
  jobs.push(['adaptive-background.svg', join(dir, 'ic_launcher_background.png'), 108 * scale]);
  jobs.push(['adaptive-monochrome.svg', join(dir, 'ic_launcher_monochrome.png'), 108 * scale]);
  jobs.push(['mono.svg', join(res, `drawable-${name}`, 'ic_stat_dawntick.png'), 24 * scale, { white: true }]);
}
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function launch() {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const executablePath = process.env['CHROMIUM_PATH'];
  return chromium.launch(executablePath === undefined ? {} : { executablePath });
}

async function render(page, svgName, size, options = {}) {
  const svg = readFileSync(join(brand, svgName), 'utf8');
  const filter = options.white === true ? 'filter:brightness(0) invert(1);' : '';
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img style="display:block;width:${size}px;height:${size}px;${filter}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`,
  );
  await page.waitForFunction(() => document.images[0]?.complete === true);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** PNG 内嵌的 ICO：Windows Vista 起支持，每个尺寸一张。 */
function buildIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

const browser = await launch();
try {
  const page = await browser.newPage();
  for (const [svg, target, size, options] of jobs) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await render(page, svg, Math.round(size), options));
  }
  const icoImages = [];
  for (const size of ICO_SIZES) {
    icoImages.push({ size, png: await render(page, size <= 32 ? 'favicon.svg' : 'app-icon.svg', size) });
  }
  writeFileSync(join(desktop, 'icon.ico'), buildIco(icoImages));
  mkdirSync(web, { recursive: true });
  copyFileSync(join(brand, 'favicon.svg'), join(web, 'favicon.svg'));
  writeFileSync(join(web, 'apple-touch-icon.png'), await render(page, 'app-icon.svg', 180));
} finally {
  await browser.close();
}
console.log(`已生成 ${jobs.length + 3} 个图标文件`);
