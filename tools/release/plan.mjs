import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStamp, stampVersion, versionCodeOf } from './build-stamp.mjs';

export const CHANNELS = ['release', 'beta', 'dev'];
export const DEV_ROLLING_TAG = 'dev-latest';

export function nextBetaNumber(existingTags, version) {
  const pattern = new RegExp(`^v${version.replace(/\./g, '\\.')}-beta\\.(\\d+)$`);
  let max = 0;
  for (const tag of existingTags) {
    const match = pattern.exec(tag.trim());
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/**
 * 渠道与标签规则：
 * - dev：固定标签 dev-latest，滚动覆盖；由手动触发或定时任务发布，构建自 dev 分支
 * - beta：手动触发时默认用纯版本号 `v<version>` 发预发布；也可指定序号拼 `-beta.<n>`；
 *   构建自 main，保留历史
 * - release：标签 v<version>；构建自 main，打标签触发自动发布
 * beta 与 release 都从 main 发版：改动在 dev 上做，经 PR 合入 main 后再打标签。
 */
export function planRelease({
  ref,
  eventName = 'push',
  runNumber = 0,
  version,
  dispatchChannel = '',
  /** beta 渠道的版本后缀：默认 'plain' 不带序号（`v<version>`）；可填序号拼 `-beta.<n>` */
  betaSuffix = 'plain',
  existingTags = [],
}) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`版本号格式不正确: ${version}`);
  }

  const isTagPush = typeof ref === 'string' && ref.startsWith('refs/tags/');
  let channel;

  if (eventName === 'schedule') {
    channel = 'dev';
  } else if (isTagPush) {
    const name = ref.slice('refs/tags/'.length);
    // 测试版标签允许不带序号（`vX.Y.Z-beta`）或带序号（`vX.Y.Z-beta.N`）
    if (/-beta(\.|$)/.test(name)) channel = 'beta';
    else if (/-dev\./.test(name)) channel = 'dev';
    else channel = 'release';
  } else if (typeof dispatchChannel === 'string' && dispatchChannel.length > 0) {
    if (!CHANNELS.includes(dispatchChannel)) throw new Error(`未知渠道: ${dispatchChannel}`);
    channel = dispatchChannel;
  } else if (ref === 'refs/heads/main') {
    channel = 'release';
  } else {
    channel = 'dev';
  }

  let tag;
  let buildRef;

  if (channel === 'dev') {
    tag = DEV_ROLLING_TAG;
    buildRef = 'dev';
  } else if (channel === 'beta') {
    // 手动触发时可指定后缀：plain 不带序号，其余按序号拼 `-beta.<n>`；默认 1
    const suffix = typeof betaSuffix === 'string' ? betaSuffix.trim() : '';
    const suffixTag = suffix === '' || suffix === 'plain' ? '' : `-beta.${suffix}`;
    tag = isTagPush ? ref.slice('refs/tags/'.length) : `v${version}${suffixTag}`;
    buildRef = isTagPush ? tag : 'main';
  } else {
    tag = isTagPush ? ref.slice('refs/tags/'.length) : `v${version}`;
    buildRef = isTagPush ? tag : 'main';
  }

  // dev 每次构建都带构建时间戳：产物名与关于页能区分是哪一次构建
  const stamp = buildStamp();
  const appVersion = stampVersion(version, channel, new Date());

  return {
    channel,
    version,
    appVersion,
    stamp,
    versionCode: versionCodeOf(),
    tag,
    buildRef,
    rolling: channel === 'dev',
    prerelease: channel !== 'release',
    title: `晓刻 ${tag}`,
    runNumber,
  };
}

export function currentVersion(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/plan.mjs');
if (invokedDirectly) {
  const args = new Map();
  for (const raw of process.argv.slice(2)) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    args.set(key, rest.join('='));
  }
  const plan = planRelease({
    ref: args.get('ref') ?? process.env.GITHUB_REF ?? '',
    eventName: args.get('event') ?? process.env.GITHUB_EVENT_NAME ?? 'push',
    runNumber: Number(args.get('run') ?? process.env.GITHUB_RUN_NUMBER ?? 0),
    version: args.get('version') ?? currentVersion(),
    dispatchChannel: args.get('channel') ?? '',
    betaSuffix: args.get('beta-suffix') ?? 'plain',
    existingTags: (args.get('existing-tags') ?? '').split(',').filter((item) => item.trim().length > 0),
  });

  if (args.has('github-output')) {
    const lines = [
      'channel',
      'version',
      'appVersion',
      'stamp',
      'versionCode',
      'tag',
      'buildRef',
      'rolling',
      'prerelease',
      'title',
    ]
      .map((key) => `${key}=${String(plan[key])}`)
      .join('\n');
    process.stdout.write(`${lines}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
}
