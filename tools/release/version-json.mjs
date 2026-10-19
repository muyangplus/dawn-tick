import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 发布产物里的更新兜底清单：客户端网络异常时直接读它，字段与 `UpdateManifest` 对齐。 */
export const VERSION_JSON_FILE = 'version.json';
export const CHANNELS = ['release', 'beta', 'dev'];

/**
 * 产物名清单：只列可直接下载的安装产物，不含自身与派生的 `.sha256`。
 * 这样同一份清单在发布页与客户端读到的「有哪些产物」保持一致。
 */
export function listArtifacts(outDir) {
  return readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== VERSION_JSON_FILE && !entry.name.endsWith('.sha256'))
    .map((entry) => entry.name)
    .sort();
}

/** 生成 version.json 的内容：版本、渠道、标签、发布说明与产物名。 */
export function buildVersionManifest({ channel, version, tag, notes, artifacts = [] }) {
  if (!CHANNELS.includes(channel)) throw new Error(`未知渠道: ${channel}`);
  if (typeof version !== 'string' || version.trim().length === 0) throw new Error('版本号不能为空');
  if (typeof tag !== 'string' || tag.trim().length === 0) throw new Error('标签不能为空');
  if (typeof notes !== 'string' || notes.trim().length === 0) throw new Error('发布说明不能为空');
  const names = [...new Set(artifacts.map((name) => String(name).trim()))]
    .filter((name) => name.length > 0)
    .sort();
  return {
    channel,
    version: version.trim(),
    tag: tag.trim(),
    notes: notes.trim(),
    artifacts: names,
  };
}

/** 写入 `<outDir>/version.json`，返回写入的内容。 */
export function writeVersionJson({ outDir = 'out', channel, version, tag, notes, artifacts = listArtifacts(outDir) }) {
  const manifest = buildVersionManifest({ channel, version, tag, notes, artifacts });
  writeFileSync(join(outDir, VERSION_JSON_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/version-json.mjs');
if (invokedDirectly) {
  const args = new Map();
  for (const raw of process.argv.slice(2)) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    args.set(key, rest.join('='));
  }
  const outDir = args.get('out') ?? 'out';
  const notesFile = args.get('notes-file');
  const notes = notesFile === undefined ? (args.get('notes') ?? '') : readFileSync(notesFile, 'utf8');
  const manifest = writeVersionJson({
    outDir,
    channel: args.get('channel') ?? '',
    version: args.get('version') ?? '',
    tag: args.get('tag') ?? '',
    notes,
  });
  process.stdout.write(`写入 ${join(outDir, VERSION_JSON_FILE)}（${manifest.artifacts.length} 个产物）\n`);
}
