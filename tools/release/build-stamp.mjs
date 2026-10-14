/**
 * 构建时间戳与 dev 构建版本号：
 * dev 每次构建都带 `yyyyMMddHHmm`，产物名与关于页都能区分是哪一次构建。
 * 只用内置 Date，不引入依赖。
 */

/** yyyyMMddHHmm（本地时间）。 */
export function buildStamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}`
  );
}

/** dev 渠道把构建时间戳接在版本号后面：0.1.0 -> 0.1.0.202510131430。 */
export function stampVersion(base, channel, date = new Date()) {
  return channel === 'dev' ? `${base}.${buildStamp(date)}` : base;
}

/**
 * Android versionCode：自 2024-01-01 起的分钟数，32 位内且随时间单调递增，
 * 保证 dev / beta / release 之间互相覆盖安装都不会被判成降级。
 */
export function versionCodeOf(date = new Date()) {
  const epoch = Date.UTC(2024, 0, 1);
  return Math.floor((date.getTime() - epoch) / 60_000);
}

/** 去掉构建时间戳，只留语义版本：用于更新比较，避免本地 dev 构建永远「有新版本」。 */
export function baseVersion(version) {
  const match = /^(\d+\.\d+\.\d+)(?:\.(\d{12}))?$/.exec(String(version).trim());
  return match === null ? String(version).trim() : match[1];
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/build-stamp.mjs');
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const channelIndex = args.indexOf('--channel');
  const channel = channelIndex >= 0 ? args[channelIndex + 1] : 'dev';
  const base = args.find((item) => /^\d+\.\d+\.\d+$/.test(item)) ?? '0.0.0';
  const date = new Date();
  console.log(
    JSON.stringify({
      stamp: buildStamp(date),
      version: stampVersion(base, channel, date),
      versionCode: versionCodeOf(date),
    }),
  );
}
