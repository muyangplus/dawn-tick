import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { BOOKMARKLET_VERSION, extractTimetableFromHtml, parsePageDiagnostics } from '@dawn-tick/core';

const injectionSource = readFileSync(
  fileURLToPath(new URL('../../desktop/src-tauri/src/import-injection.js', import.meta.url)),
  'utf8',
);

const PAGE = `<!doctype html><html><head><title>个人课表查询</title></head><body>
<table id="kbgrid_table_0"><tbody>
  <tr><td><span class="time">节次</span></td><td><span class="time">星期一</span></td><td><span class="time">星期二</span></td><td><span class="time">星期三</span></td></tr>
  <tr><td><span class="festival">1</span></td>
    <td rowspan="2" id="1-1" class="td_wrap"><div class="timetable_con"><span class="title"><font color="blue">固体废物处理与处置</font></span><p><font color="blue"> (1-2节)1-15周</font></p><p><font color="blue"> 石湖  石C6-403</font></p><p><font color="blue"> 何欣,金伟</font></p></div></td>
    <td rowspan="1" id="2-1" class="td_wrap"></td><td rowspan="1" id="3-1" class="td_wrap"></td></tr>
  <tr><td><span class="festival">2</span></td><td rowspan="1" id="2-2" class="td_wrap"></td><td rowspan="1" id="3-2" class="td_wrap"></td></tr>
</tbody></table>
</body></html>`;

async function runInjection(options: { fail?: boolean } = {}) {
  const dom = new JSDOM(PAGE, {
    url: 'https://jw.example.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let posted: string | null = null;

  (window as unknown as { fetch: unknown }).fetch = async (_url: string, init: { body: string }) => {
    posted = init.body;
    if (options.fail === true) throw new Error('blocked by CSP');
    return { ok: true, status: 200 };
  };

  window.eval(injectionSource);
  if (window.document.getElementById('dt-import-button') === null) {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  const button = window.document.getElementById('dt-import-button');
  assert.ok(button instanceof window.HTMLButtonElement, '应注入导入按钮');
  button.click();
  // 固定等待若干轮，让回调链跑完（失败分支里 posted 也会被赋值）
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const panel = window.document.getElementById('dt-import-fallback');
  const box = panel?.querySelector('textarea');
  return { posted, fallback: box instanceof window.HTMLTextAreaElement ? box.value : null, panel, button, window };
}

test('注入脚本挂出按钮并回传页面内容', async () => {
  const { posted, button } = await runInjection();
  assert.ok(posted !== null, '应通过自定义协议回传');
  assert.ok(posted?.includes('<<<DAWNTICK>>>'));
  assert.match(button.textContent ?? '', /已发送到晓刻/);

  const diagnostics = parsePageDiagnostics(posted ?? '');
  assert.ok(diagnostics !== null, '应带回诊断信息');
  assert.equal(diagnostics?.v, BOOKMARKLET_VERSION);
  assert.equal(diagnostics?.title, '个人课表查询');

  const result = extractTimetableFromHtml(posted ?? '', { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.equal(result.schedules.length, 1);
  assert.equal(result.schedules[0]?.courseName, '固体废物处理与处置');
  assert.equal(result.schedules[0]?.periodStart, 1);
  assert.equal(result.schedules[0]?.periodEnd, 2, 'rowspan 连堂应合并');
  assert.equal(result.schedules[0]?.room, '石湖 石C6-403');
  assert.equal(result.schedules[0]?.teacher, '何欣,金伟');
});

test('回传被页面策略拦截时退回手动复制', async () => {
  const { fallback, panel, button } = await runInjection({ fail: true });
  assert.ok(panel !== null && panel !== undefined, '应显示可复制的面板');
  assert.ok(fallback?.includes('<<<DAWNTICK>>>'), '面板里应给出可复制的内容');
  assert.match(button.textContent ?? '', /请手动复制/);
});

test('重复注入不会挂出两个按钮', async () => {
  const dom = new JSDOM(PAGE, { url: 'https://jw.example.edu.cn/', runScripts: 'outside-only' });
  const { window } = dom;
  (window as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200 });
  window.eval(injectionSource);
  window.eval(injectionSource);
  assert.equal(window.document.querySelectorAll('#dt-import-button').length, 1);
});
