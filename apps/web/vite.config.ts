import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __DT_CHANNEL__: JSON.stringify(process.env.DT_CHANNEL ?? 'dev'),
    __DT_VERSION__: JSON.stringify(process.env.DT_VERSION ?? appVersion()),
  },
  build: {
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        mini: `${root}mini.html`,
        submit: `${root}import-submit.html`,
      },
    },
  },
});
