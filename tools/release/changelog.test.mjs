import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkChangelog,
  extractSection,
  extractUnreleased,
  releasedVersions,
} from './changelog.mjs';

const SAMPLE = `# 变更日志

## [未发布]

### 新增

- 窗口从今天开始

## [0.2.0] - 2026-10-15

### 修复

- 回到今天不生效

## [0.1.0] - 2026-10-14

### 变更

- 首个正式版
`;

test('按版本取段：只取该版本正文，遇到下一个标题就停', () => {
  const body = extractSection(SAMPLE, '0.2.0');
  assert.equal(body, '### 修复\n\n- 回到今天不生效');
  assert.equal(extractSection(SAMPLE, '0.1.0'), '### 变更\n\n- 首个正式版');
});

test('未发布段可单独取，版本号带方括号与日期都能识别', () => {
  assert.equal(extractUnreleased(SAMPLE), '### 新增\n\n- 窗口从今天开始');
  assert.equal(extractSection(SAMPLE, '0.2.0')?.includes('未发布'), false);
  assert.equal(extractSection(SAMPLE, '0.9.9'), null, '没有的版本返回 null，交给调用方回退');
});

test('列出已发布版本（不含未发布）', () => {
  assert.deepEqual(releasedVersions(SAMPLE), ['0.2.0', '0.1.0']);
});

test('结构自检：缺标题、缺未发布段、已发布版本缺日期都会报出来', () => {
  assert.deepEqual(checkChangelog(SAMPLE), []);
  const problems = checkChangelog('## [0.1.0]\n\n- 没有日期也没有标题\n');
  assert.equal(problems.some((item) => item.includes('缺少一级标题')), true);
  assert.equal(problems.some((item) => item.includes('未发布')), true);
  assert.equal(problems.some((item) => item.includes('缺少发布日期')), true);
});

test('发版后留空的「未发布」段仍算结构正常', () => {
  const text = '# 变更日志\n\n## [未发布]\n\n## [0.2.0] - 2026-10-17\n\n- 首个正式版\n';
  assert.deepEqual(checkChangelog(text), []);
  assert.equal(extractUnreleased(text), null, '空段落交给调用方回退自动生成');
});

test('预发布版本号也能取段', () => {
  const text = '## [0.1.0-beta.1] - 2026-10-14\n\n- 首个测试版\n';
  assert.equal(extractSection(text, '0.1.0-beta.1'), '- 首个测试版');
});
