export type Channel = 'dev' | 'beta' | 'release';

declare const __DT_CHANNEL__: string | undefined;

function injectedChannel(): string {
  return typeof __DT_CHANNEL__ === 'string' ? __DT_CHANNEL__ : 'dev';
}

export const CHANNEL: Channel = (() => {
  const raw = injectedChannel();
  return raw === 'beta' || raw === 'release' ? raw : 'dev';
})();

export const CHANNEL_LABEL: Record<Channel, string> = {
  dev: '开发版',
  beta: '公测版',
  release: '正式版',
};

/** 渠道独占功能：未列出的渠道隐藏对应入口。 */
export const FEATURES = {
  /** 日志导出与诊断信息 */
  diagnostics: ['dev', 'beta'],
} as const satisfies Record<string, readonly Channel[]>;

export type FeatureId = keyof typeof FEATURES;

export function featureVisible(id: FeatureId, channel: Channel = CHANNEL): boolean {
  return (FEATURES[id] as readonly Channel[]).includes(channel);
}

export function appVersion(): string {
  return typeof __DT_VERSION__ === 'string' ? __DT_VERSION__ : '0.0.0';
}
