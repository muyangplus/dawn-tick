import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecentUpdates, releaseTagUrl } from '../src/lib/recent-updates.ts';

const CHANGELOG = `# 变更日志

## [未发布]

### 变更

- 未发布的东西不该出现在近期更新里

## [0.7.0] - 2026-11-01

### 新增

- 新功能 A

## [0.6.3] - 2026-10-23

### 修复

- 修复 B
- 修复 C

## [0.6.2] - 2026-10-23

### 变更

- 变更 D
`;

test('parseRecentUpdates：跳过未发布段，按版本倒序取前 N 条', () => {
  const updates = parseRecentUpdates(CHANGELOG, 2);
  assert.deepEqual(updates.map((item) => item.version), ['0.7.0', '0.6.3']);
  assert.equal(updates[0]?.date, '2026-11-01');
  assert.match(updates[0]?.body ?? '', /新功能 A/);
  assert.match(updates[1]?.body ?? '', /修复 B[\s\S]*修复 C/);
});

test('parseRecentUpdates：未发布内容不会混进第一条', () => {
  const updates = parseRecentUpdates(CHANGELOG, 6);
  assert.equal(updates.length, 3);
  assert.ok(!(updates[0]?.body ?? '').includes('未发布的东西'));
});

test('parseRecentUpdates：limit 为 0 或负值返回空数组', () => {
  assert.deepEqual(parseRecentUpdates(CHANGELOG, 0), []);
  assert.deepEqual(parseRecentUpdates(CHANGELOG, -1), []);
});

test('parseRecentUpdates：没有版本标题时返回空数组', () => {
  assert.deepEqual(parseRecentUpdates('# 变更日志\n\n随便写点东西\n', 5), []);
});

test('releaseTagUrl：补 v 前缀并指向对应 Release', () => {
  assert.equal(
    releaseTagUrl('0.6.3'),
    'https://github.com/muyangplus/dawn-tick/releases/tag/v0.6.3',
  );
  assert.equal(
    releaseTagUrl('v0.6.2'),
    'https://github.com/muyangplus/dawn-tick/releases/tag/v0.6.2',
  );
});
