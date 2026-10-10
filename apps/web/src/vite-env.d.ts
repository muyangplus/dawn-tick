/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

/** 构建时注入的渠道与版本，见 vite.config.ts */
declare const __DT_CHANNEL__: string;
declare const __DT_VERSION__: string;
