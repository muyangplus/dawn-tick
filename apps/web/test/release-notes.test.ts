import test from 'node:test';
import assert from 'node:assert/strict';
import { baseVersion, changelogSection, releaseNotesAction } from '../src/lib/release-notes.ts';

const CHANGELOG = `# 变更日志

## [未发布]

### 修复

- 未发布的改动

## [0.8.0] - 2026-11-18

### 新增

- 课表分享

### 变更

- 新图标

## [0.7.0] - 2026-11-17

- 旧内容

[未发布]: https://example.com/compare/v0.8.0...dev
[0.8.0]: https://example.com/compare/v0.7.0...v0.8.0
`;

test('baseVersion 去掉 v 前缀、测试版后缀与构建号', () => {
  assert.equal(baseVersion('0.8.0'), '0.8.0');
  assert.equal(baseVersion('v0.8.0-beta.2'), '0.8.0');
  assert.equal(baseVersion('0.8.0+dev.20261118'), '0.8.0');
  assert.equal(baseVersion('dev'), null);
});

test('changelogSection 取当前版本那一段，不含标题、下一版本与链接定义', () => {
  assert.equal(changelogSection(CHANGELOG, '0.8.0'), '### 新增\n\n- 课表分享\n\n### 变更\n\n- 新图标');
  assert.equal(changelogSection(CHANGELOG, '0.8.0-beta.1'), changelogSection(CHANGELOG, '0.8.0'));
  assert.equal(changelogSection(CHANGELOG, '0.7.0'), '- 旧内容');
  assert.equal(changelogSection(CHANGELOG, '0.9.0'), '');
  assert.equal(changelogSection('## [0.8.0] - 2026-11-18\r\n\r\n- CRLF\r\n', '0.8.0'), '- CRLF');
});

test('首次安装只记版本，不弹', () => {
  assert.equal(releaseNotesAction({ lastVersion: null, currentVersion: '0.8.0', enabled: true, notes: '- a' }), 'record');
});

test('升级后弹一次；版本没变不再弹', () => {
  assert.equal(releaseNotesAction({ lastVersion: '0.7.0', currentVersion: '0.8.0', enabled: true, notes: '- a' }), 'show');
  assert.equal(releaseNotesAction({ lastVersion: '0.8.0', currentVersion: '0.8.0', enabled: true, notes: '- a' }), 'none');
  assert.equal(
    releaseNotesAction({ lastVersion: '0.8.0-beta.1', currentVersion: '0.8.0', enabled: true, notes: '- a' }),
    'none',
    '同号测试版升正式版内容相同，不重复弹',
  );
});

test('开关关闭或没有说明时升级只记版本；降级也记版本', () => {
  assert.equal(releaseNotesAction({ lastVersion: '0.7.0', currentVersion: '0.8.0', enabled: false, notes: '- a' }), 'record');
  assert.equal(releaseNotesAction({ lastVersion: '0.7.0', currentVersion: '0.8.0', enabled: true, notes: '  ' }), 'record');
  assert.equal(releaseNotesAction({ lastVersion: '0.9.0', currentVersion: '0.8.0', enabled: true, notes: '- a' }), 'record');
});

test('当前版本号不合法时不动', () => {
  assert.equal(releaseNotesAction({ lastVersion: '0.7.0', currentVersion: 'dev', enabled: true, notes: '- a' }), 'none');
});
