import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const TARGETS = {
  root: 'package.json',
  web: 'apps/web/package.json',
  tauri: 'apps/desktop/src-tauri/tauri.conf.json',
  cargo: 'apps/desktop/src-tauri/Cargo.toml',
  gradle: 'apps/mobile/android/app/build.gradle',
};

export function semverToVersionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) throw new Error(`版本号格式不正确: ${version}`);
  const [, major, minor, patch] = match;
  return Number(major) * 10000 + Number(minor) * 100 + Number(patch);
}

export function normalize(version) {
  const match = /^(\d+\.\d+\.\d+)(?:[-+].*)?$/.exec(version.trim());
  if (match === null) throw new Error(`版本号格式不正确: ${version}`);
  return match[1];
}

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

export function currentVersion() {
  return readJson(TARGETS.root).version;
}

export function readAll() {
  const cargo = readFileSync(join(ROOT, TARGETS.cargo), 'utf8');
  const cargoVersion = /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/.exec(cargo)?.[1];
  const gradle = readFileSync(join(ROOT, TARGETS.gradle), 'utf8');
  const gradleName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
  const gradleCode = /versionCode\s+(\d+)/.exec(gradle)?.[1];

  return {
    root: readJson(TARGETS.root).version,
    web: readJson(TARGETS.web).version,
    tauri: readJson(TARGETS.tauri).version,
    cargo: cargoVersion,
    gradleName,
    gradleCode: gradleCode === undefined ? undefined : Number(gradleCode),
  };
}

function replaceOnce(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`未找到待替换内容: ${label}`);
  return content.replace(pattern, replacement);
}

export function setVersion(input) {
  const version = normalize(input);
  const versionCode = semverToVersionCode(version);

  for (const path of [TARGETS.root, TARGETS.web]) {
    const json = readJson(path);
    json.version = version;
    writeFileSync(join(ROOT, path), `${JSON.stringify(json, null, 2)}\n`);
  }

  const tauriPath = join(ROOT, TARGETS.tauri);
  const tauri = readFileSync(tauriPath, 'utf8');
  writeFileSync(tauriPath, replaceOnce(tauri, /"version":\s*"[^"]+"/, `"version": "${version}"`, 'tauri.conf.json'));

  const cargoPath = join(ROOT, TARGETS.cargo);
  const cargo = readFileSync(cargoPath, 'utf8');
  writeFileSync(
    cargoPath,
    replaceOnce(cargo, /(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/, `$1"${version}"`, 'Cargo.toml'),
  );

  const gradlePath = join(ROOT, TARGETS.gradle);
  let gradle = readFileSync(gradlePath, 'utf8');
  gradle = replaceOnce(gradle, /versionCode\s+\d+/, `versionCode ${versionCode}`, 'versionCode');
  gradle = replaceOnce(gradle, /versionName\s+"[^"]+"/, `versionName "${version}"`, 'versionName');
  writeFileSync(gradlePath, gradle);

  return { version, versionCode };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/release/version.mjs');
if (invokedDirectly) {
  const arg = process.argv[2];
  if (arg === undefined || arg === '--current') {
    console.log(currentVersion());
  } else if (arg === '--check') {
    const all = readAll();
    const expectedCode = semverToVersionCode(normalize(all.root));
    const mismatched = Object.entries(all).filter(
      ([key, value]) => key !== 'gradleCode' && normalize(String(value)) !== normalize(all.root),
    );
    const codeOk = all.gradleCode === expectedCode;
    if (mismatched.length > 0 || !codeOk) {
      console.error(`版本号不一致: ${JSON.stringify(all)}`);
      process.exit(1);
    }
    console.log(`${normalize(all.root)} (versionCode ${all.gradleCode})`);
  } else {
    const result = setVersion(arg);
    console.log(`已设置为 ${result.version} (versionCode ${result.versionCode})`);
  }
}
