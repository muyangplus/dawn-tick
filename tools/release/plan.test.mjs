import test from 'node:test';
import assert from 'node:assert/strict';
import { planRelease } from './plan.mjs';

const V = '0.1.0';

test('main 分支发正式版', () => {
  const plan = planRelease({ ref: 'refs/heads/main', runNumber: 7, version: V });
  assert.equal(plan.channel, 'release');
  assert.equal(plan.tag, 'v0.1.0');
  assert.equal(plan.prerelease, false);
  assert.equal(plan.title, '晓刻 v0.1.0');
});

test('beta 与 dev 分支发预发布', () => {
  const beta = planRelease({ ref: 'refs/heads/beta', runNumber: 12, version: V });
  assert.equal(beta.channel, 'beta');
  assert.equal(beta.tag, 'v0.1.0-beta.12');
  assert.equal(beta.prerelease, true);

  const dev = planRelease({ ref: 'refs/heads/dev', runNumber: 34, version: V });
  assert.equal(dev.channel, 'dev');
  assert.equal(dev.tag, 'v0.1.0-dev.34');
  assert.equal(dev.prerelease, true);
});

test('标签推送沿用既有标签', () => {
  assert.equal(planRelease({ ref: 'refs/tags/v0.2.0', version: V }).tag, 'v0.2.0');
  assert.equal(planRelease({ ref: 'refs/tags/v0.2.0', version: V }).channel, 'release');

  const beta = planRelease({ ref: 'refs/tags/v0.2.0-beta.3', version: V });
  assert.equal(beta.channel, 'beta');
  assert.equal(beta.tag, 'v0.2.0-beta.3');
  assert.equal(beta.prerelease, true);

  const dev = planRelease({ ref: 'refs/tags/v0.2.0-dev.9', version: V });
  assert.equal(dev.channel, 'dev');
  assert.equal(dev.tag, 'v0.2.0-dev.9');
});

test('手动指定渠道覆盖分支推断', () => {
  const plan = planRelease({ ref: 'refs/heads/dev', runNumber: 5, version: V, dispatchChannel: 'release' });
  assert.equal(plan.channel, 'release');
  assert.equal(plan.tag, 'v0.1.0');
  assert.equal(plan.prerelease, false);
});

test('未知渠道与非法版本被拒绝', () => {
  assert.throws(() => planRelease({ ref: 'refs/heads/dev', version: V, dispatchChannel: 'nightly' }), /未知渠道/);
  assert.throws(() => planRelease({ ref: 'refs/heads/main', version: '1.0' }), /版本号格式不正确/);
});

test('未知分支按 dev 处理', () => {
  const plan = planRelease({ ref: 'refs/heads/feature/x', runNumber: 3, version: V });
  assert.equal(plan.channel, 'dev');
  assert.equal(plan.tag, 'v0.1.0-dev.3');
});
