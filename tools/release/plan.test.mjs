import test from 'node:test';
import assert from 'node:assert/strict';
import { DEV_ROLLING_TAG, nextBetaNumber, planRelease } from './plan.mjs';

const V = '0.1.0';

test('dev 渠道使用固定滚动标签', () => {
  const plan = planRelease({ ref: 'refs/heads/dev', version: V, dispatchChannel: 'dev', runNumber: 9 });
  assert.equal(plan.channel, 'dev');
  assert.equal(plan.tag, DEV_ROLLING_TAG);
  assert.equal(plan.buildRef, 'dev');
  assert.equal(plan.rolling, true);
  assert.equal(plan.prerelease, true);
});

test('定时任务发 dev 渠道', () => {
  const plan = planRelease({ ref: 'refs/heads/main', eventName: 'schedule', version: V });
  assert.equal(plan.channel, 'dev');
  assert.equal(plan.tag, DEV_ROLLING_TAG);
  assert.equal(plan.buildRef, 'dev');
});

test('beta 渠道在 main 上发版，标签按既有标签续号', () => {
  const plan = planRelease({
    ref: 'refs/heads/main',
    version: V,
    dispatchChannel: 'beta',
    existingTags: ['v0.1.0-beta.1', 'v0.1.0-beta.3', 'v0.0.9-beta.7'],
  });
  assert.equal(plan.tag, 'v0.1.0-beta.4');
  assert.equal(plan.buildRef, 'main');
  assert.equal(plan.rolling, false);
  assert.equal(plan.prerelease, true);
});

test('beta 分支已移除：dev 之外的普通分支按 dev 处理', () => {
  const plan = planRelease({ ref: 'refs/heads/beta', version: V });
  assert.equal(plan.channel, 'dev');
  assert.equal(plan.buildRef, 'dev');
});

test('版本号变化后 beta 从 1 重新开始', () => {
  assert.equal(nextBetaNumber(['v0.1.0-beta.5'], '0.2.0'), 1);
  assert.equal(nextBetaNumber([], '0.2.0'), 1);
});

test('打标签触发正式发布', () => {
  const plan = planRelease({ ref: 'refs/tags/v0.2.0', version: '0.2.0' });
  assert.equal(plan.channel, 'release');
  assert.equal(plan.tag, 'v0.2.0');
  assert.equal(plan.buildRef, 'v0.2.0');
  assert.equal(plan.prerelease, false);
  assert.equal(plan.title, '晓刻 v0.2.0');
});

test('打 beta 标签沿用该标签', () => {
  const plan = planRelease({ ref: 'refs/tags/v0.2.0-beta.1', version: '0.2.0' });
  assert.equal(plan.channel, 'beta');
  assert.equal(plan.tag, 'v0.2.0-beta.1');
  assert.equal(plan.prerelease, true);
});

test('手动触发 release 渠道使用 main', () => {
  const plan = planRelease({ ref: 'refs/heads/dev', version: '0.2.0', dispatchChannel: 'release' });
  assert.equal(plan.channel, 'release');
  assert.equal(plan.tag, 'v0.2.0');
  assert.equal(plan.buildRef, 'main');
  assert.equal(plan.prerelease, false);
});

test('非法渠道与版本被拒绝', () => {
  assert.throws(() => planRelease({ ref: 'refs/heads/dev', version: V, dispatchChannel: 'nightly' }), /未知渠道/);
  assert.throws(() => planRelease({ ref: 'refs/heads/dev', version: '1.0' }), /版本号格式不正确/);
});
