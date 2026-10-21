import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLUGIN_METHODS, PLUGIN_NAMES } from '../src/lib/plugins.ts';

/**
 * Capacitor 插件是跨语言手写同构：TS 侧改名或 Android 侧改名都不会编译报错，
 * 只会在运行时静默拿到 undefined。这里做静态核对，Android 编译仍在打包机上跑。
 */
const ANDROID_ROOT = new URL('../../mobile/android/app/src/main/java/com/dawntick/app/', import.meta.url);
const CONTRACT_DOC = new URL('../../mobile/docs/plugins.contract.md', import.meta.url);

const SOURCES = [
  { name: PLUGIN_NAMES.systemActions, file: 'system/SystemActionsPlugin.java' },
  { name: PLUGIN_NAMES.schoolWindow, file: 'school/SchoolWindowPlugin.kt' },
  { name: PLUGIN_NAMES.widgetPin, file: 'widget/WidgetPinPlugin.kt' },
  { name: PLUGIN_NAMES.widgetRefresh, file: 'widget/WidgetRefreshPlugin.kt' },
  { name: PLUGIN_NAMES.apkInstaller, file: 'install/ApkInstallerPlugin.kt' },
  { name: PLUGIN_NAMES.fileShare, file: 'share/FileSharePlugin.kt' },
] as const;

function readAndroid(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, ANDROID_ROOT)), 'utf8');
}

test('Capacitor 插件方法名与 Android 实现、契约文档一致', () => {
  const doc = readFileSync(fileURLToPath(CONTRACT_DOC), 'utf8');
  for (const item of SOURCES) {
    const source = readAndroid(item.file);
    assert.match(
      source,
      new RegExp(`@CapacitorPlugin\\(name = "${item.name}"\\)`),
      `${item.file} 的插件名与 PLUGIN_NAMES.${item.name} 不一致`,
    );
    assert.ok(doc.includes(item.name), `契约文档缺少插件 ${item.name}`);
    assert.ok(doc.includes(item.file), `契约文档缺少实现文件 ${item.file}`);

    const methods = PLUGIN_METHODS[item.name];
    assert.ok(methods.length > 0, `${item.name} 没有登记方法`);
    for (const method of methods) {
      assert.match(
        source,
        new RegExp(`(?:fun|void)\\s+${method}\\s*\\(`),
        `${item.file} 缺少 @PluginMethod ${method}（或已改名）`,
      );
      assert.ok(doc.includes(method), `契约文档缺少方法 ${method}`);
    }
  }
});

test('插件名与加载入口集中在 lib/plugins.ts', () => {
  assert.deepEqual(Object.values(PLUGIN_NAMES).toSorted(), [
    'ApkInstaller',
    'DawnTickWidget',
    'FileShare',
    'SchoolWindow',
    'SystemActions',
    'WidgetRefresh',
  ]);
  // 每个插件名都要有方法清单，避免只登记插件名不登记方法
  assert.deepEqual(Object.keys(PLUGIN_METHODS).toSorted(), Object.values(PLUGIN_NAMES).toSorted());
});
