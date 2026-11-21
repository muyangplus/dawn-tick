import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { changelogSection } from './src/lib/changelog-section.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 当前版本在 CHANGELOG.md 里的那一段：更新后弹「新版本内容」用，离线也能看。 */
function releaseNotes(version: string): string {
  try {
    return changelogSection(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'), version);
  } catch {
    return '';
  }
}

const version = process.env.DT_VERSION ?? appVersion();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __DT_CHANNEL__: JSON.stringify(process.env.DT_CHANNEL ?? 'dev'),
    __DT_VERSION__: JSON.stringify(version),
    __DT_RELEASE_NOTES__: JSON.stringify(releaseNotes(version)),
  },
  build: {
    rollupOptions: {
      // exceljs 只在导入表格时动态加载；按包名显式拆成独立 chunk，主包与它分开缓存。
      output: {
        manualChunks(id) {
          const path = id.replaceAll('\\', '/');
          return path.includes('/node_modules/exceljs/') ? 'exceljs' : undefined;
        },
      },
      input: {
        main: `${root}index.html`,
        mini: `${root}mini.html`,
        submit: `${root}import-submit.html`,
      },
    },
  },
});
