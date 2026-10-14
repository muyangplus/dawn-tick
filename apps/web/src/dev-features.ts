declare const __DT_CHANNEL__: string | undefined;

/**
 * 开发者特性开关：dev 渠道默认开启，可在设置里关掉，让 dev 构建按正式版特性运行。
 * 只影响界面与日志行为，不改更新渠道。
 */
const CHANNEL = typeof __DT_CHANNEL__ === 'string' ? __DT_CHANNEL__ : 'dev';

let enabled = CHANNEL === 'dev';
const listeners = new Set<(value: boolean) => void>();

export function channelOf(): string {
  return CHANNEL;
}

/** 当前是否启用开发者特性（非 dev 渠道恒为 false）。 */
export function devFeaturesOn(): boolean {
  return enabled;
}

/** 设置里切开关时调用；同时通知已注册的监听方（日志、右键菜单等）。 */
export function applyDevFeatures(value: boolean): void {
  const next = CHANNEL === 'dev' ? value : false;
  if (next === enabled) return;
  enabled = next;
  for (const listener of listeners) listener(next);
}

export function onDevFeaturesChange(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
