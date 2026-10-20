import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  BOOKMARKLET_VERSION,
  PAGE_DIAGNOSTICS_FIELDS,
  extractTimetableFromHtml,
  parsePageDiagnostics,
} from '@dawn-tick/core';
import {
  DIAGNOSTICS_INNER_PAGE,
  DIAGNOSTICS_OUTER_PAGE,
  DIAGNOSTICS_URL,
  EXPECTED_COURSE_NAMES,
  EXPECTED_DIAGNOSTICS,
  diagnosticCountsOf,
} from '../../../packages/core/test/fixtures/import-diagnostics.ts';

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

async function runInjection(
  options: { block?: boolean; outer?: string; inner?: string; url?: string } = {},
) {
  const dom = new JSDOM(options.outer ?? PAGE, {
    url: options.url ?? 'https://jw.example.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  if (options.inner !== undefined) {
    const frame = window.document.querySelector('iframe');
    if (frame?.contentDocument != null) {
      frame.contentDocument.write(options.inner);
      frame.contentDocument.close();
    }
  }
  let target: string | null = null;

  window.eval(injectionSource);
  if (window.document.getElementById('dt-import-button') === null) {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  (window as unknown as { __dtImportSubmit: (url: string) => void }).__dtImportSubmit = (url: string) => {
    if (options.block === true) throw new Error('blocked');
    target = url;
  };

  const button = window.document.getElementById('dt-import-button');
  assert.ok(button instanceof window.HTMLButtonElement, '应注入导入按钮');
  button.click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const encoded = target === null ? null : new URLSearchParams(String(target).split('#')[1]).get('d');
  let payload: string | null = null;
  if (encoded !== null) {
    payload = new TextDecoder().decode(Buffer.from(encoded, 'base64url'));
  }
  const panel = window.document.getElementById('dt-import-fallback');
  const box = panel?.querySelector('textarea');
  return {
    target,
    payload,
    fallback: box instanceof window.HTMLTextAreaElement ? box.value : null,
    panel,
    button,
    window,
  };
}

test('注入脚本挂出按钮并带回页面内容', async () => {
  const { target, payload, button } = await runInjection();
  assert.ok(target !== null, '应跳转到应用自身页面');
  assert.match(String(target), /^http:\/\/tauri\.localhost\/import-submit\.html#d=/);
  assert.ok(payload?.includes('<<<DAWNTICK>>>'));
  assert.match(button.textContent ?? '', /已交给晓刻/);

  const diagnostics = parsePageDiagnostics(payload ?? '');
  assert.ok(diagnostics !== null, '应带回诊断信息');
  assert.equal(diagnostics?.v, BOOKMARKLET_VERSION);
  assert.equal(diagnostics?.title, '个人课表查询');

  const result = extractTimetableFromHtml(payload ?? '', { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.equal(result.schedules.length, 1);
  assert.equal(result.schedules[0]?.courseName, '固体废物处理与处置');
  assert.equal(result.schedules[0]?.periodStart, 1);
  assert.equal(result.schedules[0]?.periodEnd, 2, 'rowspan 连堂应合并');
  assert.equal(result.schedules[0]?.room, '石湖 石C6-403');
  assert.equal(result.schedules[0]?.teacher, '何欣,金伟');
});

test('跳转不可用时退回手动复制', async () => {
  const { fallback, panel, button, target } = await runInjection({ block: true });
  assert.equal(target, null);
  assert.ok(panel !== null && panel !== undefined, '应显示可复制的面板');
  assert.ok(fallback?.includes('<<<DAWNTICK>>>'), '面板里应给出可复制的内容');
  assert.match(button.textContent ?? '', /请手动复制/);
});

test('注入脚本与书签共用同一组诊断样例', async () => {
  const { payload } = await runInjection({
    outer: DIAGNOSTICS_OUTER_PAGE,
    inner: DIAGNOSTICS_INNER_PAGE,
    url: DIAGNOSTICS_URL,
  });
  const diagnostics = parsePageDiagnostics(payload ?? '');
  assert.ok(diagnostics !== null, '应带回诊断信息');
  // 字段清单来自 core 的 PAGE_DIAGNOSTICS_FIELDS：注入脚本少一个字段，这里的循环就会失败
  for (const field of PAGE_DIAGNOSTICS_FIELDS) {
    assert.ok(field in diagnostics, `注入脚本缺少诊断字段 ${field}`);
  }
  assert.equal(diagnostics?.v, BOOKMARKLET_VERSION, '诊断版本应与 BOOKMARKLET_VERSION 一致');
  assert.deepEqual(diagnosticCountsOf(diagnostics ?? {}), EXPECTED_DIAGNOSTICS);
  assert.equal(diagnostics?.loading, false, '样例页面不在加载中');
  assert.equal(diagnostics?.url, DIAGNOSTICS_URL);
  assert.equal(diagnostics?.title, '个人课表查询');

  const result = extractTimetableFromHtml(payload ?? '', { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.deepEqual(
    result.schedules.map((item) => item.courseName).sort(),
    [...EXPECTED_COURSE_NAMES].sort(),
  );
});

test('注入脚本不发起任何网络请求', async () => {
  const dom = new JSDOM(PAGE, { url: 'https://jw.example.edu.cn/', runScripts: 'outside-only' });
  const { window } = dom;
  const fetched: string[] = [];
  const requested: string[] = [];
  (window as unknown as { fetch: unknown }).fetch = async (url: string) => {
    fetched.push(String(url));
    return { ok: true };
  };
  (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = class {
    open(_method: string, url: string): void {
      requested.push(url);
    }
    send(): void {
      requested.push('send');
    }
  };
  window.eval(injectionSource);
  if (window.document.getElementById('dt-import-button') === null) {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  (window as unknown as { __dtImportSubmit: (url: string) => void }).__dtImportSubmit = () => {};
  window.document.getElementById('dt-import-button')?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(fetched, [], '不应调用 fetch');
  assert.deepEqual(requested, [], '不应发起 XHR');
});

test('重复注入不会挂出两个按钮', async () => {
  const dom = new JSDOM(PAGE, { url: 'https://jw.example.edu.cn/', runScripts: 'outside-only' });
  const { window } = dom;
  (window as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200 });
  window.eval(injectionSource);
  window.eval(injectionSource);
  assert.equal(window.document.querySelectorAll('#dt-import-button').length, 1);
});
