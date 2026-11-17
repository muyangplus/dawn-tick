import test from 'node:test';
import assert from 'node:assert/strict';
import type { UpdatePlan } from '../src/lib/update-download.ts';
import { IDLE_UPDATE_TASK, type UpdateTask } from '../src/lib/update-task.ts';
import {
  INSTALLING_TEXT,
  PORTABLE_INSTALL_LABEL,
  describeUpdateDialog,
} from '../src/components/update/update-dialog-model.ts';

/** 弹窗只查表渲染：这里直接验证「状态 → 主按钮/可见动作/状态行」的映射。 */

const PLAN: UpdatePlan = {
  kind: 'download',
  target: {
    platform: 'windows',
    kind: 'installer',
    url: 'https://example.com/DawnTick-setup.exe',
    fileName: 'DawnTick-update.exe',
    size: 16,
    assetName: 'DawnTick-0.8.0-windows-x64-setup.exe',
    checksumsUrl: 'https://example.com/SHA256SUMS.txt',
    sha256: null,
  },
};

const PORTABLE_PLAN: UpdatePlan = {
  kind: 'download',
  target: { ...PLAN.target, kind: 'portable', fileName: 'DawnTick-update.zip' },
};

function task(patch: Partial<UpdateTask>): UpdateTask {
  return { ...IDLE_UPDATE_TASK, version: '0.8.0', updatedAt: 1, ...patch };
}

test('空闲 + 可下载：主操作固定「立即更新」，下载后会自称自动安装', () => {
  const view = describeUpdateDialog({ plan: PLAN, task: null });
  assert.equal(view.primaryKind, 'update');
  assert.equal(view.primaryLabel, '立即更新');
  assert.equal(view.primaryDisabled, false);
  assert.equal(view.showMore, true);
  assert.equal(view.showLater, true);
  assert.match(view.statusText, /自动开始安装/);
});

test('便携版空闲：仍是一个「立即更新」，但说明会退出替换', () => {
  const view = describeUpdateDialog({ plan: PORTABLE_PLAN, task: null });
  assert.equal(view.primaryLabel, '立即更新');
  assert.match(view.statusText, /退出应用完成替换/);
});

test('下载中：不显示主按钮，只留小的取消与更多菜单', () => {
  const view = describeUpdateDialog({
    plan: PLAN,
    task: task({ status: 'downloading', progress: { received: 8, total: 16, percent: 0.5, speedBytesPerSec: 4, etaSeconds: 2 } }),
  });
  assert.equal(view.primaryKind, 'none');
  assert.equal(view.showCancel, true);
  assert.equal(view.showBackground, true);
  assert.equal(view.showProgress, true);
  assert.equal(view.showLater, false);
});

test('校验中：状态行给出可读说明', () => {
  const view = describeUpdateDialog({ plan: PLAN, task: task({ status: 'verifying', message: '正在校验安装包…' }) });
  assert.equal(view.primaryKind, 'none');
  assert.equal(view.showCancel, true);
  assert.equal(view.statusText, '正在校验安装包…');
});

test('已下载（来自后台任务）：主操作变为安装，失败重试不在主按钮上', () => {
  const view = describeUpdateDialog({ plan: PLAN, task: task({ status: 'ready', message: '安装包已就绪' }) });
  assert.equal(view.primaryKind, 'install');
  assert.equal(view.primaryLabel, '安装更新');
  assert.equal(view.showRetry, false);
  assert.equal(view.showProgress, false);
  assert.equal(view.statusText, '安装包已就绪');
});

test('便携版已下载：主操作说明会退出替换', () => {
  const view = describeUpdateDialog({
    plan: PORTABLE_PLAN,
    task: task({ status: 'ready', target: { ...IDLE_UPDATE_TASK.target, platform: 'windows', version: '0.8.0', kind: 'portable', fileName: 'DawnTick-update.zip', path: 'C:\\Temp\\DawnTick-update.zip', installerLabel: 'Windows 便携包（退出后替换）' } }),
  });
  assert.equal(view.primaryLabel, PORTABLE_INSTALL_LABEL);
});

test('自动安装进行中：只显示「正在安装」，不再给按钮', () => {
  const view = describeUpdateDialog({ plan: PLAN, task: task({ status: 'ready' }), installing: true });
  assert.equal(view.primaryKind, 'none');
  assert.equal(view.showMore, false);
  assert.equal(view.showLater, false);
  assert.equal(view.statusText, INSTALLING_TEXT);
});

test('失败：错误直接显示，重试收在更多菜单里', () => {
  const view = describeUpdateDialog({ plan: PLAN, task: task({ status: 'failed', error: 'offline' }) });
  assert.equal(view.primaryKind, 'update');
  assert.equal(view.showRetry, true);
  assert.equal(view.tone, 'danger');
  assert.equal(view.showProgress, false);
  assert.match(view.statusText, /下载更新失败/);
  assert.match(view.statusText, /offline/);
});

test('Web：有 web 包时直接下载，没有则刷新页面', () => {
  const refreshOnly = describeUpdateDialog({ plan: { kind: 'refresh' }, task: null });
  assert.equal(refreshOnly.primaryKind, 'refresh');
  assert.equal(refreshOnly.primaryLabel, '立即更新');
  const withPackage = describeUpdateDialog({
    plan: { kind: 'refresh' },
    task: null,
    webAssetUrl: 'https://example.com/DawnTick-0.8.0-web.zip',
  });
  assert.equal(withPackage.primaryKind, 'download-web');
  assert.match(withPackage.statusText, /下载 Web 版安装包/);
});

test('没有可安装资产：主按钮禁用并保留原因入口', () => {
  const view = describeUpdateDialog({ plan: { kind: 'unavailable', reason: '没有提供 Windows 安装包' }, task: null });
  assert.equal(view.primaryDisabled, true);
  assert.equal(view.showBackground, false);
});
