import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHANNELS = ['release', 'beta', 'dev'];

/**
 * 渠道与标签规则：
 * - refs/heads/main → release，标签 v<version>
 * - refs/heads/beta → beta，标签 v<version>-beta.<run>
 * - refs/heads/dev  → dev，标签 v<version>-dev.<run>
 * - tag vX.Y.Z           → release，沿用该标签
 * - tag vX.Y.Z-beta.N    → beta，沿用该标签
 * - tag vX.Y.Z-dev.N     → dev，沿用该标签
 */
export function planRelease({ ref, runNumber = 0, version, dispatchChannel }) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`版本号格式不正确: ${version}`);
  }

  let channel;
  let tag;

  if (typeof ref === 'string' && ref.startsWith('refs/tags/')) {
    const name = ref.slice('refs/tags/'.length);
    if (name.endsWith('.zip')) throw new Error(`非法标签: ${name}`);
    if (/-beta\./.test(name)) channel = 'beta';
    else if (/-dev\./.test(name)) channel = 'dev';
    else channel = 'release';
    tag = name;
  } else {
    if (ref === 'refs/heads/main') channel = 'release';
    else if (ref === 'refs/heads/beta') channel = 'beta';
    else channel = 'dev';

    if (tag === undefined) {
      if (channel === 'release') tag = `v${version}`;
      else tag = `v${version}-${channel}.${runNumber}`;
    }
  }

  if (typeof dispatchChannel === 'string' && dispatchChannel.length > 0) {
    if (!CHANNELS.includes(dispatchChannel)) throw new Error(`未知渠道: ${dispatchChannel}`);
    channel = dispatchChannel;
    tag = channel === 'release' ? `v${version}` : `v${version}-${channel}.${runNumber}`;
  }

  return {
    channel,
    version,
    tag,
    prerelease: channel !== 'release',
    title: `晓刻 ${tag}`,
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
    runNumber: Number(args.get('run') ?? process.env.GITHUB_RUN_NUMBER ?? 0),
    version: args.get('version') ?? currentVersion(),
    dispatchChannel: args.get('channel') ?? '',
  });

  if (args.has('github-output')) {
    const lines = Object.entries(plan).map(([key, value]) => `${key}=${value}`).join('\n');
    process.stdout.write(`${lines}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
}
