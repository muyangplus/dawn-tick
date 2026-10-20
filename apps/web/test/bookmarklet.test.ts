import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  PAGE_BOOKMARKLET,
  extractTimetableFromHtml,
  parsePageDiagnostics,
  stripPageMarkers,
} from '@dawn-tick/core';
import {
  DIAGNOSTICS_INNER_PAGE,
  DIAGNOSTICS_OUTER_PAGE,
  DIAGNOSTICS_URL,
  EXPECTED_COURSE_NAMES,
  EXPECTED_DIAGNOSTICS,
  diagnosticCountsOf,
} from '../../../packages/core/test/fixtures/import-diagnostics.ts';

const OUTER_PAGE = `<!doctype html><html><head><title>个人课表查询</title></head><body>
<div class="widget-backdrop-loading"><div class="msg">加载中...</div></div>
<iframe id="iframe1" src="/jwglxt/xskb/xskb_list.do"></iframe>
</body></html>`;

const INNER_PAGE = `<!doctype html><html><body>
<table id="kbtable"><tr>
  <td id="1-1"><div class="timetable_con"><span class="title">高等数学</span><p>张老师</p><p>教三-201</p><p>1-16周</p></div></td>
  <td id="3-1"><div class="timetable_con"><span class="title">大学物理</span><p>李老师</p><p>理科楼-105</p><p>1-16周</p></div></td>
</tr></table>
</body></html>`;

async function runBookmarklet(outer: string, inner: string, url: string) {
  const dom = new JSDOM(outer, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const frame = window.document.querySelector('iframe');
  if (frame?.contentDocument != null && inner !== '') {
    frame.contentDocument.write(inner);
    frame.contentDocument.close();
  }

  let captured = '';
  let alerted = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (text: string) => {
      captured = text;
    } },
    configurable: true,
  });
  (window as unknown as { alert: (message: string) => void }).alert = (message: string) => {
    alerted = message;
  };

  window.eval(PAGE_BOOKMARKLET.replace(/^javascript:/, ''));
  for (let attempt = 0; attempt < 200 && captured === ''; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // 让 writeText 之后的 alert 回调先执行
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { captured, alerted, window };
}

test('书签在「课表位于 iframe」时回传完整内容', async () => {
  const { captured, alerted } = await runBookmarklet(
    OUTER_PAGE,
    INNER_PAGE,
    'https://jw.example.edu.cn/jwglxt/xskb/xskb_list.do',
  );

  assert.ok(captured.includes('<<<DAWNTICK>>>'), '应写入剪贴板');
  assert.match(alerted, /疑似课表/, '弹窗应报告疑似课表数量');

  const diagnostics = parsePageDiagnostics(captured);
  assert.ok(diagnostics !== null, '应带回诊断信息');
  assert.equal(diagnostics?.frames, 2, '主文档与 iframe 都应收集');
  assert.ok((diagnostics?.kbTables ?? 0) >= 1, '应统计到疑似课表表格');
  assert.equal(diagnostics?.title, '个人课表查询');
  assert.ok(diagnostics?.url?.includes('xskb_list') === true);

  const result = extractTimetableFromHtml(captured, { totalWeeks: 20 });
  assert.equal(result.shape, 'grid', '应命中正方日-节网格');
  assert.equal(result.schedules.length, 2);
  assert.equal(result.schedules[0]?.courseName, '高等数学');
  assert.equal(result.schedules[0]?.room, '教三-201');
  assert.equal(result.schedules[1]?.dayOfWeek, 3);
});

test('书签与注入脚本共用同一组诊断样例', async () => {
  const { captured } = await runBookmarklet(
    DIAGNOSTICS_OUTER_PAGE,
    DIAGNOSTICS_INNER_PAGE,
    DIAGNOSTICS_URL,
  );
  const diagnostics = parsePageDiagnostics(captured);
  assert.ok(diagnostics !== null, '应带回诊断信息');
  assert.deepEqual(diagnosticCountsOf(diagnostics ?? {}), EXPECTED_DIAGNOSTICS);
  assert.equal(diagnostics?.loading, false, '样例页面不在加载中');
  assert.equal(diagnostics?.title, '个人课表查询');
  assert.equal(diagnostics?.url, DIAGNOSTICS_URL);
  assert.equal(typeof diagnostics?.ready, 'string', 'ready 是 document.readyState，具体值随执行时机变化');

  const result = extractTimetableFromHtml(captured, { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.deepEqual(
    result.schedules.map((item) => item.courseName).sort(),
    [...EXPECTED_COURSE_NAMES].sort(),
  );
});

test('剥离诊断头后剩余的才是页面内容', async () => {
  const { captured } = await runBookmarklet(OUTER_PAGE, INNER_PAGE, 'https://jw.example.edu.cn/');
  const body = stripPageMarkers(captured);
  assert.ok(!body.includes('"kbTables"'), '诊断 JSON 不应留在页面内容里');
  assert.ok(body.includes('<html'), '页面内容应保留');
  assert.ok(body.includes('kbtable'), 'iframe 内容应保留');
});

test('课表未加载完时给出可读提示', async () => {
  const { captured } = await runBookmarklet(OUTER_PAGE, '', 'https://jw.example.edu.cn/');
  const diagnostics = parsePageDiagnostics(captured);
  assert.equal(diagnostics?.loading, true, '应识别出「加载中」');

  const result = extractTimetableFromHtml(captured, { totalWeeks: 20 });
  assert.equal(result.schedules.length, 0);
  assert.match(result.warnings.join('；'), /页面仍在加载|未在页面里找到课表/);
});
