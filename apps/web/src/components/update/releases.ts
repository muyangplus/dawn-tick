/** 发布页地址：渠道提示与更新弹窗的下载入口共用（原在 `app-dialogs.tsx`，拆分后放这里避免循环引用）。 */
export const RELEASES_URL = 'https://github.com/muyangplus/dawn-tick/releases';

/** 渠道提示的 id：开发版可能频繁更新、测试版可能不稳定 */
export const NOTICE_DEV = 'dev-frequent-updates';
export const NOTICE_BETA = 'beta-unstable';
