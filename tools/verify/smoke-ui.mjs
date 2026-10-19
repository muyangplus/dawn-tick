import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const repo = process.cwd();
const webDir = join(repo, 'apps/web');
const outDir = join(webDir, 'smoke-dist');
const entryUrl = pathToFileURL(join(outDir, 'entry.js')).href;

/** 冒烟固定在当前时钟上：断言按「今天」推算日期，真实日期一变就会飘。 */
const FIXED_NOW = Date.parse('2026-10-18T18:30:00+08:00');

function freezeClock() {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(FIXED_NOW);
      else super(...args);
    }
    static now() {
      return FIXED_NOW;
    }
  }
  Object.defineProperty(globalThis, 'Date', { value: FrozenDate, configurable: true, writable: true });
  if (typeof globalThis.window === 'object' && globalThis.window !== null) {
    Object.defineProperty(globalThis.window, 'Date', { value: FrozenDate, configurable: true, writable: true });
  }
}

function build() {
  execSync('pnpm exec vite build --ssr smoke/entry.tsx --outDir smoke-dist --emptyOutDir', {
    cwd: webDir,
    stdio: 'inherit',
  });
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  const mediaQueryStub = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });

  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  window.matchMedia = mediaQueryStub;
  window.scrollTo = () => {};
  window.ResizeObserver = ObserverStub;
  window.IntersectionObserver = ObserverStub;
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.hasPointerCapture = () => false;
  window.Element.prototype.setPointerCapture = () => {};
  window.Element.prototype.releasePointerCapture = () => {};

  // 镜像 jsdom 的 window 全局（HTMLFormElement 等 DOM 类），不覆盖 Node 已有的全局
  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    try {
      Object.defineProperty(globalThis, key, { get: () => window[key], configurable: true });
    } catch {
      // 无法定义的属性跳过
    }
  }

  const essentials = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    matchMedia: mediaQueryStub,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 16),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    IS_REACT_ACT_ENVIRONMENT: false,
  };

  // Node 也定义了这些名字，但它们必须来自 jsdom，否则在 DOM 节点上派发事件会类型不符
  for (const key of ['Event', 'CustomEvent', 'EventTarget', 'DOMException', 'MessageEvent']) {
    if (window[key] !== undefined) essentials[key] = window[key];
  }

  for (const [key, value] of Object.entries(essentials)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return dom;
}

async function main() {
  if (!existsSync(join(webDir, 'smoke/entry.tsx'))) {
    console.error('缺少 apps/web/smoke/entry.tsx');
    return 1;
  }
  console.log('打包冒烟入口…');
  build();

  const dom = setupDom();
  freezeClock();
  const rejections = [];
  process.on('unhandledRejection', (reason) => rejections.push(reason));

  const consoleErrors = [];
  const originalError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((item) => String(item)).join(' '));
    originalError(...args);
  };

  const module = await import(entryUrl);
  const results = await module.runSmoke();

  let failed = 0;
  for (const result of results) {
    console.log(`${result.ok ? '[PASS]' : '[FAIL]'} ${result.name}${result.detail === '' ? '' : `  ${result.detail}`}`);
    if (!result.ok) failed += 1;
  }

  if (rejections.length > 0) {
    failed += 1;
    console.error(`未处理的异步错误 ${rejections.length} 条：${rejections.map((item) => String(item)).join(' | ')}`);
  }

  const realErrors = consoleErrors.filter((line) => /Error:/.test(line));
  if (realErrors.length > 0) {
    failed += 1;
    console.error(`控制台错误 ${realErrors.length} 条：${realErrors.slice(0, 3).join(' | ')}`);
  }

  dom.window.close();
  if (failed > 0) {
    console.error(`冒烟测试未通过 ${failed} 项`);
    return 1;
  }
  console.log(`冒烟测试通过（${results.length} 项）`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
