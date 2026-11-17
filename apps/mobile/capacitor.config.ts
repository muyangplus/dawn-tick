import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dawntick.app',
  appName: '晓刻 DawnTick',
  webDir: '../web/dist',
  android: {
    allowMixedContent: false,
    // 只有 dev 渠道允许 chrome://inspect 调试 WebView；beta / release 关掉，页面里的数据不对外暴露
    webContentsDebuggingEnabled: (process.env.DT_CHANNEL ?? 'dev') === 'dev',
  },
  plugins: {
    // 接管 fetch：教务抓取走原生请求，绕过 WebView 的同源策略
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
