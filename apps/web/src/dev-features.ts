declare const __DT_CHANNEL__: string | undefined;

/** 开发者特性开关：dev 渠道默认开启，设置里可关；只影响界面与日志，不改更新渠道。 */
const CHANNEL = typeof __DT_CHANNEL__ === 'string' ? __DT_CHANNEL__ : 'dev';

let enabled = CHANNEL === 'dev';

/** 当前是否启用开发者特性（非 dev 渠道恒为 false）。 */
export function devFeaturesOn(): boolean {
  return enabled;
}

/** 设置里切开关时调用。 */
export function applyDevFeatures(value: boolean): void {
  const next = CHANNEL === 'dev' ? value : false;
  enabled = next;
}

