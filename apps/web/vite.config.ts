import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * 本地开发用的 HTTP 转发：请求由开发服务器发出，浏览器侧不再受同源策略限制。
 * 仅 dev 生效，生产 Web 与服务端构建都不包含。
 */
function devHttpBridge(): Plugin {
  return {
    name: 'dawn-tick-dev-http-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/http', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        let raw = '';
        request.on('data', (chunk) => {
          raw += chunk;
        });
        request.on('end', () => {
          void (async () => {
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            try {
              const payload = JSON.parse(raw) as {
                url?: string;
                method?: string;
                headers?: Record<string, string>;
                body?: string | null;
              };
              const target = payload.url ?? '';
              if (!/^https?:\/\//i.test(target)) throw new Error('仅支持 http 与 https 地址');
              const upstream = await fetch(target, {
                method: payload.method ?? 'GET',
                ...(payload.headers === undefined ? {} : { headers: payload.headers }),
                ...(payload.body === null || payload.body === undefined ? {} : { body: payload.body }),
              });
              const setCookie =
                typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
              response.end(
                JSON.stringify({ status: upstream.status, text: await upstream.text(), setCookie }),
              );
            } catch (error) {
              response.statusCode = 502;
              response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devHttpBridge()],
  build: {
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        mini: `${root}mini.html`,
      },
    },
  },
});
