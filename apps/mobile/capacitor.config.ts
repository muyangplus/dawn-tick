import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dawntick.app',
  appName: '晓刻 DawnTick',
  webDir: '../web/dist',
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    // 接管 fetch：教务抓取走原生请求，绕过 WebView 的同源策略
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
