import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBranches } from './sync-gitee-assets.mjs';

test('parseBranches：默认同步三条渠道分支', () => {
  assert.deepEqual(parseBranches(undefined), ['dev', 'beta', 'release']);
  assert.deepEqual(parseBranches(''), ['dev', 'beta', 'release']);
});

test('parseBranches：过滤未知分支并保留顺序', () => {
  assert.deepEqual(parseBranches('beta,release'), ['beta', 'release']);
  assert.deepEqual(parseBranches('main, dev , nope,beta'), ['dev', 'beta']);
});
